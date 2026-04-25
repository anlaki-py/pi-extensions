/**
 * Plan Mode Extension For Pi
 *
 * Coordinates all plan-mode subsystems: safety, parsing, state, UI,
 * execution tracking, and session lifecycle.
 *
 * Improvements over original:
 * - Structured plan_step_complete tool instead of regex-parsing [DONE:n]
 * - System-prompt injection instead of polluting message history
 * - ASCII-only UI (no emojis)
 * - Scoped session resume via planId + execute markers
 * - Per-step file change tracking with rollback reporting
 * - Collaborative refinement commands work during execution
 * - Heuristic completion detection as fallback
 * - Extracted into focused modules (no god file)
 */

import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Key } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	CMD,
	FLAG_NAME,
	TOOLS,
	PLAN_SYSTEM_PROMPT_APPENDIX,
	EXEC_SYSTEM_PROMPT_APPENDIX,
} from "./constants.js";
import type { PlanState } from "./types.js";
import type { PlanStepCompleteInput } from "./constants.js";
import { isAssistantMessage, getTextContent } from "./types.js";
import { isSafeCommand } from "./safety.js";
import { extractPlanSteps } from "./parser.js";
import {
	createEmptyPlanState,
	createPlanFromSteps,
	getCurrentStep,
	isPlanComplete,
	hasFailedSteps,
	loadPersistedState,
	persistState,
	resetPlan,
	markStepComplete,
	markStepFailed,
	skipStep,
	retryStep,
	addStep,
	appendExecuteMarker,
	rebuildStateFromSession,
} from "./state.js";
import { updatePlanUI, notifyPlanComplete, formatPlanForDisplay } from "./ui.js";
import {
	startExecution,
	detectHeuristicCompletion,
	trackFileChange,
	buildRollbackReport,
} from "./execution.js";

export default function planModeExtension(pi: ExtensionAPI): void {
	let state: PlanState = createEmptyPlanState();

	// -------------------------------------------------------------------------
	// Flag
	// -------------------------------------------------------------------------
	pi.registerFlag(FLAG_NAME, {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	// -------------------------------------------------------------------------
	// Custom tool: plan_step_complete
	// Primary completion mechanism (replacing [DONE:n] regex parsing)
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "plan_step_complete",
		label: "Plan Step Complete",
		description:
			"Mark a plan step as complete, failed, or skipped. Call this after finishing work on a step during plan execution.",
		promptSnippet: "Mark the current plan step as done, failed, or skipped",
		promptGuidelines: [
			"Use plan_step_complete after finishing the current step during plan execution.",
			"Call plan_step_complete before starting work on the next step.",
		],
		parameters: Type.Object({
			step_number: Type.Number({ description: "Step number to mark" }),
			status: StringEnum(["complete", "failed", "skipped"] as const),
			reason: Type.Optional(Type.String({ description: "Reason if failed or skipped" })),
		}),

		async execute(_toolCallId, params: PlanStepCompleteInput, _signal, _onUpdate, ctx) {
			if (state.mode !== "executing") {
				return {
					content: [{ type: "text", text: "Error: not in execution mode. Use /plan to start executing." }],
					details: { error: "not executing" },
				};
			}

			const step = state.steps.find((s) => s.number === params.step_number);
			if (!step) {
				return {
					content: [{ type: "text", text: `Error: step ${params.step_number} not found in current plan.` }],
					details: { error: "step not found" },
				};
			}

			let changed = false;
			switch (params.status) {
				case "complete":
					changed = markStepComplete(state, params.step_number);
					break;
				case "failed":
					changed = markStepFailed(state, params.step_number);
					break;
				case "skipped":
					changed = skipStep(state, params.step_number);
					break;
			}

			persistState(pi, state);
			updatePlanUI(ctx, state);

			const next = getCurrentStep(state);
			const prefix = changed
				? `Step ${params.step_number} marked ${params.status}.`
				: `Step ${params.step_number} already ${params.status}.`;
			const suffix = next
				? ` Next: ${next.number}. ${next.text}`
				: " All remaining steps complete.";
			return {
				content: [{ type: "text", text: prefix + suffix }],
				details: { stepNumber: params.step_number, status: params.status, planId: state.planId },
			};
		},
	});

	// -------------------------------------------------------------------------
	// Commands
	// -------------------------------------------------------------------------

	pi.registerCommand(CMD.PLAN, {
		description: "Toggle plan mode or show plan options",
		handler: async (_args, ctx) => {
			if (state.mode === "disabled") {
				state = createEmptyPlanState();
				state.mode = "planning";
				pi.setActiveTools(TOOLS.PLAN);
				ctx.ui.notify("Plan mode enabled. Read-only exploration.", "info");
			} else if (state.mode === "planning") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Plan mode active. Use /plan-status to view.", "info");
					return;
				}
				const options = ["Execute plan"];
				if (state.steps.length > 0) options.push("Reset plan");
				options.push("Exit plan mode");
				const choice = await ctx.ui.select("Plan mode is active. Choose an action:", options);

				if (choice === "Execute plan") {
					startExecution(state);
					appendExecuteMarker(pi, state.planId);
					persistState(pi, state);
					pi.setActiveTools(TOOLS.EXECUTION);
					const current = getCurrentStep(state);
					ctx.ui.notify(`Executing plan: ${state.steps.length} steps`, "info");
					pi.sendMessage(
						{
							customType: "plan-execute",
							content: `Execute the plan. Start with step ${current?.number}: ${current?.text}`,
							display: true,
						},
						{ triggerTurn: true },
					);
				} else if (choice === "Reset plan") {
					resetPlan(state);
					persistState(pi, state);
					ctx.ui.notify("Plan reset. Back to planning mode.", "info");
				} else if (choice === "Exit plan mode") {
					state = createEmptyPlanState();
					pi.setActiveTools(TOOLS.NORMAL);
					ctx.ui.notify("Plan mode disabled.", "info");
				}
			} else {
				// executing
				if (!ctx.hasUI) return;
				const options = ["Pause execution", "Rollback / show changes", "Reset plan", "Exit plan mode"];
				const choice = await ctx.ui.select("Execution in progress. Choose an action:", options);
				if (choice === "Pause execution") {
					ctx.ui.notify("Execution paused. Resume with /plan when ready.", "warning");
				} else if (choice === "Rollback / show changes") {
					const report = buildRollbackReport(state);
					pi.sendMessage(
						{ customType: "plan-rollback-report", content: report, display: true },
						{ triggerTurn: false },
					);
				} else if (choice === "Reset plan") {
					resetPlan(state);
					state.mode = "planning";
					persistState(pi, state);
					pi.setActiveTools(TOOLS.PLAN);
					ctx.ui.notify("Plan reset to planning mode.", "info");
				} else if (choice === "Exit plan mode") {
					state = createEmptyPlanState();
					pi.setActiveTools(TOOLS.NORMAL);
					ctx.ui.notify("Plan mode disabled.", "info");
				}
			}
			updatePlanUI(ctx, state);
		},
	});

	pi.registerCommand(CMD.STATUS, {
		description: "Show current plan status",
		handler: async (_args, ctx) => {
			if (state.steps.length === 0) {
				ctx.ui.notify("No plan steps yet.", "info");
				return;
			}
			const display = formatPlanForDisplay(state);
			ctx.ui.notify(`Plan status:\n${display}`, "info");
		},
	});

	pi.registerCommand(CMD.SKIP, {
		description: "Skip a plan step by number: /plan-skip 2",
		handler: async (args, ctx) => {
			const n = parseStepArg(args);
			if (n === null) {
				ctx.ui.notify("Usage: /plan-skip <step-number>", "error");
				return;
			}
			if (skipStep(state, n)) {
				persistState(pi, state);
				updatePlanUI(ctx, state);
				ctx.ui.notify(`Skipped step ${n}.`, "info");
			} else {
				ctx.ui.notify(`Could not skip step ${n}.`, "error");
			}
		},
	});

	pi.registerCommand(CMD.DONE, {
		description: "Manually mark a step as done: /plan-done 2",
		handler: async (args, ctx) => {
			const n = parseStepArg(args);
			if (n === null) {
				ctx.ui.notify("Usage: /plan-done <step-number>", "error");
				return;
			}
			if (markStepComplete(state, n)) {
				persistState(pi, state);
				updatePlanUI(ctx, state);
				ctx.ui.notify(`Marked step ${n} as done.`, "info");
			} else {
				ctx.ui.notify(`Could not mark step ${n} as done.`, "error");
			}
		},
	});

	pi.registerCommand(CMD.RETRY, {
		description: "Retry a failed step: /plan-retry 2",
		handler: async (args, ctx) => {
			const n = parseStepArg(args);
			if (n === null) {
				ctx.ui.notify("Usage: /plan-retry <step-number>", "error");
				return;
			}
			if (retryStep(state, n)) {
				persistState(pi, state);
				updatePlanUI(ctx, state);
				ctx.ui.notify(`Retrying step ${n}.`, "info");
				// Trigger a turn to let the agent continue
				const current = getCurrentStep(state);
				if (current) {
					pi.sendMessage(
						{
							customType: "plan-retry",
							content: `Retry step ${current.number}: ${current.text}`,
							display: true,
						},
						{ triggerTurn: true },
					);
				}
			} else {
				ctx.ui.notify(`Could not retry step ${n}.`, "error");
			}
		},
	});

	pi.registerCommand(CMD.ADD, {
		description: "Add a step at the end: /plan-add Review tests",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /plan-add <step-description>", "error");
				return;
			}
			const step = addStep(state, text);
			persistState(pi, state);
			updatePlanUI(ctx, state);
			ctx.ui.notify(`Added step ${step.number}: ${step.text}`, "info");
		},
	});

	pi.registerCommand(CMD.INSERT, {
		description: "Insert a step after another: /plan-insert 2 Review tests",
		handler: async (args, ctx) => {
			const firstSpace = args.trim().indexOf(" ");
			if (firstSpace <= 0) {
				ctx.ui.notify("Usage: /plan-insert <after-step> <description>", "error");
				return;
			}
			const afterNum = Number(args.slice(0, firstSpace).trim());
			const text = args.slice(firstSpace + 1).trim();
			if (!Number.isFinite(afterNum) || !text) {
				ctx.ui.notify("Usage: /plan-insert <after-step> <description>", "error");
				return;
			}
			const step = addStep(state, text, afterNum);
			if (step.number === 0) {
				ctx.ui.notify(`Step ${afterNum} not found.`, "error");
				return;
			}
			persistState(pi, state);
			updatePlanUI(ctx, state);
			ctx.ui.notify(`Inserted step ${step.number}: ${step.text}`, "info");
		},
	});

	pi.registerCommand(CMD.RESET, {
		description: "Reset the plan to planning mode",
		handler: async (_args, ctx) => {
			resetPlan(state);
			persistState(pi, state);
			pi.setActiveTools(TOOLS.PLAN);
			updatePlanUI(ctx, state);
			ctx.ui.notify("Plan reset. Back to planning mode.", "info");
		},
	});

	pi.registerCommand(CMD.ROLLBACK, {
		description: "Show rollback information for executed steps",
		handler: async (_args, ctx) => {
			if (state.mode === "disabled" || state.steps.length === 0) {
				ctx.ui.notify("No plan execution to roll back.", "info");
				return;
			}
			const report = buildRollbackReport(state);
			pi.sendMessage(
				{ customType: "plan-rollback", content: report, display: true },
				{ triggerTurn: false },
			);
		},
	});

	// -------------------------------------------------------------------------
	// Shortcut
	// -------------------------------------------------------------------------
	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			if (state.mode === "disabled") {
				state = createEmptyPlanState();
				state.mode = "planning";
				pi.setActiveTools(TOOLS.PLAN);
				ctx.ui.notify("Plan mode enabled. Read-only exploration.", "info");
			} else {
				state = createEmptyPlanState();
				pi.setActiveTools(TOOLS.NORMAL);
				ctx.ui.notify("Plan mode disabled.", "info");
			}
			updatePlanUI(ctx, state);
		},
	});

	// -------------------------------------------------------------------------
	// Session lifecycle
	// -------------------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag(FLAG_NAME) === true) {
			state = createEmptyPlanState();
			state.mode = "planning";
		}

		const persisted = loadPersistedState(ctx);
		if (persisted) {
			state.planId = persisted.planId;
			state.mode = persisted.mode;
			state.steps = persisted.steps.map((s) => ({
				...s,
				filesModified: s.filesModified ?? [],
			}));
			state.currentStepIndex = persisted.currentStepIndex;
			state.createdAt = persisted.createdAt;
			state.startedExecutionAt = persisted.startedExecutionAt;
			state.completedAt = persisted.completedAt;
		}

		// Rebuild from session entries on resume
		if (state.mode === "executing") {
			rebuildStateFromSession(ctx, state);
		}

		// Activate correct tool set
		if (state.mode === "planning") {
			pi.setActiveTools(TOOLS.PLAN);
		} else if (state.mode === "executing") {
			pi.setActiveTools(TOOLS.EXECUTION);
		} else {
			pi.setActiveTools(TOOLS.NORMAL);
		}

		updatePlanUI(ctx, state);
	});

	// -------------------------------------------------------------------------
	// Bash safety gate (planning mode only)
	// -------------------------------------------------------------------------
	pi.on("tool_call", async (event) => {
		if (state.mode !== "planning" || event.toolName !== "bash") return;
		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not in allowlist). Disable plan mode with /plan to run unrestricted commands.\nCommand: ${command}`,
			};
		}
	});

	// -------------------------------------------------------------------------
	// Track file changes & tool errors during execution
	// -------------------------------------------------------------------------
	pi.on("tool_result", async (event, ctx) => {
		if (state.mode !== "executing") return;

		if (event.toolName === "write" || event.toolName === "edit") {
			const input = event.input as { path?: string };
			trackFileChange(state, event.toolName, input);
			persistState(pi, state);
			return;
		}

		// Notify on errors but do NOT auto-fail the step
		if (event.isError) {
			const current = getCurrentStep(state);
			if (current) {
				ctx.ui.notify(`Tool error during step ${current.number} (${event.toolName})`, "warning");
			}
		}
	});

	// -------------------------------------------------------------------------
	// Filter stale plan context from messages when disabled
	// -------------------------------------------------------------------------
	pi.on("context", async (event) => {
		if (state.mode !== "disabled") return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as { customType?: string; role?: string; content?: unknown };
				if (msg.customType?.startsWith("plan-")) return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE]") && !content.includes("[PLAN EXECUTION]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c: { type: string; text?: string }) =>
							c.type === "text" &&
							(c.text?.includes("[PLAN MODE]") || c.text?.includes("[PLAN EXECUTION]")),
					);
				}
				return true;
			}),
		};
	});

	// -------------------------------------------------------------------------
	// Inject plan/execution context into system prompt
	// -------------------------------------------------------------------------
	pi.on("before_agent_start", async (event) => {
		if (state.mode === "planning") {
			return {
				systemPrompt: event.systemPrompt + PLAN_SYSTEM_PROMPT_APPENDIX,
			};
		}

		if (state.mode === "executing" && state.steps.length > 0) {
			const current = getCurrentStep(state);
			const nextIdx = state.currentStepIndex + 1;
			const nextStep = state.steps[nextIdx];

			let appendix = EXEC_SYSTEM_PROMPT_APPENDIX + "\n\n";
			appendix += `CURRENT STEP: ${current ? `${current.number}. ${current.text}` : "none"}\n`;
			if (nextStep) {
				appendix += `NEXT STEP: ${nextStep.number}. ${nextStep.text}\n`;
			}
			appendix += `\nREMAINING:\n`;
			for (const s of state.steps) {
				if (!s.completed && !s.skipped) {
					appendix += `  ${s.number}. ${s.text}\n`;
				}
			}
			appendix += `\nAfter completing the current step, call plan_step_complete(step_number, status="complete").`;

			return {
				systemPrompt: event.systemPrompt + "\n\n" + appendix,
			};
		}
	});

	// -------------------------------------------------------------------------
	// Heuristic completion detection after each turn (fallback)
	// -------------------------------------------------------------------------
	pi.on("turn_end", async (event, ctx) => {
		if (state.mode !== "executing" || state.steps.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		const detected = detectHeuristicCompletion(state, text);
		let changed = false;
		for (const sn of detected) {
			if (markStepComplete(state, sn)) changed = true;
		}

		if (changed) {
			persistState(pi, state);
			updatePlanUI(ctx, state);
		}
	});

	// -------------------------------------------------------------------------
	// Agent end: handle plan extraction, execution flow, completion
	// -------------------------------------------------------------------------
	pi.on("agent_end", async (event, ctx) => {
		// --- Execution mode flow ---
		if (state.mode === "executing") {
			if (isPlanComplete(state)) {
				state.mode = "disabled";
				state.completedAt = Date.now();
				notifyPlanComplete(ctx, state);
				persistState(pi, state);
				pi.setActiveTools(TOOLS.NORMAL);
				updatePlanUI(ctx, state);
				return;
			}

			if (hasFailedSteps(state)) {
				ctx.ui.notify("A step failed. Use /plan-retry or /plan-skip to continue.", "warning");
				persistState(pi, state);
				return;
			}

			// Auto-continue remaining steps
			const current = getCurrentStep(state);
			if (current) {
				pi.sendMessage(
					{
						customType: "plan-continue",
						content: `Continue with step ${current.number}: ${current.text}`,
						display: true,
					},
					{ triggerTurn: true },
				);
			}
			return;
		}

		// --- Planning mode flow ---
		if (state.mode !== "planning" || !ctx.hasUI) return;

		// Extract plan from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const parsed = extractPlanSteps(getTextContent(lastAssistant));
			if (parsed.length > 0) {
				state = createPlanFromSteps(parsed);
				persistState(pi, state);
			}
		}

		if (state.steps.length === 0) return;

		// Preview the plan
		const display = formatPlanForDisplay(state);
		pi.sendMessage(
			{
				customType: "plan-preview",
				content: `Plan (${state.steps.length} steps):\n${display}`,
				display: true,
			},
			{ triggerTurn: false },
		);

		const choice = await ctx.ui.select("Plan created. What next?", [
			"Execute plan",
			"Stay in plan mode",
			"Refine plan",
		]);

		if (choice === "Execute plan") {
			startExecution(state);
			appendExecuteMarker(pi, state.planId);
			persistState(pi, state);
			pi.setActiveTools(TOOLS.EXECUTION);
			updatePlanUI(ctx, state);

			const current = getCurrentStep(state);
			pi.sendMessage(
				{
					customType: "plan-execute",
					content: `Execute the plan. Start with step ${current?.number}: ${current?.text}`,
					display: true,
				},
				{ triggerTurn: true },
			);
		} else if (choice === "Refine plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim());
			}
		} else {
			ctx.ui.notify("Staying in plan mode. Use /plan to execute when ready.", "info");
		}
	});
}

// -------------------------------------------------------------------------
// Local helpers
// -------------------------------------------------------------------------

function parseStepArg(args: string): number | null {
	const n = Number(args.trim());
	if (!Number.isFinite(n) || n < 1) return null;
	return n;
}
