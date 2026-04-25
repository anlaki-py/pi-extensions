/**
 * Plan state management, persistence, and session resume reconstruction.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { ENTRY_TYPE, EXECUTE_MARKER_TYPE } from "./constants.js";
import type { ExecuteMarker, PersistedPlanState, PlanState, PlanStep } from "./types.js";
import { getTextContent, isAssistantMessage } from "./types.js";
import { detectDoneMentions } from "./parser.js";

// ---------------------------------------------------------------------------
// Creation / helpers
// ---------------------------------------------------------------------------

export function generatePlanId(): string {
	return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyPlanState(): PlanState {
	return {
		planId: generatePlanId(),
		mode: "disabled",
		steps: [],
		currentStepIndex: 0,
		createdAt: Date.now(),
	};
}

export function createPlanFromSteps(parsed: Array<{ number: number; text: string }>): PlanState {
	return {
		planId: generatePlanId(),
		mode: "planning",
		steps: parsed.map((p) => ({
			id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			number: p.number,
			text: p.text,
			completed: false,
			failed: false,
			skipped: false,
			filesModified: [],
		})),
		currentStepIndex: 0,
		createdAt: Date.now(),
	};
}

export function getCurrentStep(state: PlanState): PlanStep | undefined {
	return state.steps[state.currentStepIndex];
}

export function getRemainingSteps(state: PlanState): PlanStep[] {
	return state.steps.filter((s) => !s.completed && !s.failed && !s.skipped);
}

export function isPlanComplete(state: PlanState): boolean {
	return state.steps.every((s) => s.completed || s.skipped);
}

export function hasFailedSteps(state: PlanState): boolean {
	return state.steps.some((s) => s.failed && !s.skipped);
}

export function advanceToNextStep(state: PlanState): void {
	while (state.currentStepIndex < state.steps.length) {
		const step = state.steps[state.currentStepIndex];
		if (!step.completed && !step.skipped) break;
		state.currentStepIndex++;
	}
}

export function resetPlan(state: PlanState): void {
	state.mode = "planning";
	state.currentStepIndex = 0;
	state.startedExecutionAt = undefined;
	state.completedAt = undefined;
	for (const step of state.steps) {
		step.completed = false;
		step.failed = false;
		step.skipped = false;
		step.filesModified = [];
		step.startedAt = undefined;
		step.completedAt = undefined;
	}
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function persistState(pi: ExtensionAPI, state: PlanState): void {
	const data: PersistedPlanState = {
		planId: state.planId,
		mode: state.mode,
		steps: state.steps,
		currentStepIndex: state.currentStepIndex,
		createdAt: state.createdAt,
		startedExecutionAt: state.startedExecutionAt,
		completedAt: state.completedAt,
	};
	pi.appendEntry(ENTRY_TYPE, data);
}

export function loadPersistedState(ctx: ExtensionContext): PersistedPlanState | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && (entry as { customType?: string }).customType === ENTRY_TYPE) {
			return (entry as { data?: PersistedPlanState }).data;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Execution marker (for scoped resume)
// ---------------------------------------------------------------------------

export function appendExecuteMarker(pi: ExtensionAPI, planId: string): void {
	const marker: ExecuteMarker = { planId, timestamp: Date.now() };
	pi.appendEntry(EXECUTE_MARKER_TYPE, marker);
}

export function findExecuteMarkerIndex(ctx: ExtensionContext, planId: string): number {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && (entry as { customType?: string }).customType === EXECUTE_MARKER_TYPE) {
			const data = (entry as { data?: ExecuteMarker }).data;
			if (data?.planId === planId) return i;
		}
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Resume reconstruction
// ---------------------------------------------------------------------------

export function rebuildStateFromSession(ctx: ExtensionContext, state: PlanState): void {
	if (state.mode !== "executing" || state.steps.length === 0) return;

	const markerIdx = findExecuteMarkerIndex(ctx, state.planId);
	const entries = ctx.sessionManager.getEntries();
	const startIdx = markerIdx >= 0 ? markerIdx : 0;

	for (let i = startIdx; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type !== "message" || !("message" in entry)) continue;

		const msg = entry.message as AgentMessage;

		// Reconstruct from plan_step_complete tool results
		if (msg.role === "toolResult" && msg.toolName === "plan_step_complete") {
			const details = msg.details as { stepNumber?: number; status?: string; planId?: string } | undefined;
			if (details?.planId === state.planId && details?.stepNumber) {
				applyToolStatus(state, details.stepNumber, details.status);
			}
			continue;
		}

		// Track file modifications from write/edit tools
		if (msg.role === "toolResult" && (msg.toolName === "write" || msg.toolName === "edit")) {
			const input = msg.input as { path?: string } | undefined;
			if (input?.path) {
				const current = state.steps[state.currentStepIndex];
				if (current && !current.filesModified.includes(input.path)) {
					current.filesModified.push(input.path);
				}
			}
			continue;
		}

		// Heuristic completion from assistant text
		if (isAssistantMessage(msg)) {
			const text = getTextContent(msg);
			const heuristics = detectDoneMentions(text);
			for (const sn of heuristics) {
				markStepComplete(state, sn);
			}
		}
	}

	advanceToNextStep(state);
}

// ---------------------------------------------------------------------------
// Step mutations
// ---------------------------------------------------------------------------

export function markStepComplete(state: PlanState, stepNumber: number): boolean {
	const step = state.steps.find((s) => s.number === stepNumber);
	if (!step || step.completed) return false;
	step.completed = true;
	step.completedAt = Date.now();
	step.failed = false;
	advanceToNextStep(state);
	return true;
}

export function markStepFailed(state: PlanState, stepNumber: number): boolean {
	const step = state.steps.find((s) => s.number === stepNumber);
	if (!step || step.completed) return false;
	step.failed = true;
	return true;
}

export function skipStep(state: PlanState, stepNumber: number): boolean {
	const step = state.steps.find((s) => s.number === stepNumber);
	if (!step || step.completed) return false;
	step.skipped = true;
	advanceToNextStep(state);
	return true;
}

export function retryStep(state: PlanState, stepNumber: number): boolean {
	const step = state.steps.find((s) => s.number === stepNumber);
	if (!step || step.completed) return false;
	step.failed = false;
	step.completed = false;
	step.skipped = false;
	step.completedAt = undefined;
	step.filesModified = [];

	// Set current step index to this step
	const idx = state.steps.findIndex((s) => s.number === stepNumber);
	if (idx >= 0) state.currentStepIndex = idx;
	return true;
}

export function addStep(state: PlanState, text: string, afterNumber?: number): PlanStep {
	const newStep: PlanStep = {
		id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		number: 0,
		text,
		completed: false,
		failed: false,
		skipped: false,
		filesModified: [],
	};

	if (afterNumber !== undefined && afterNumber > 0) {
		const idx = state.steps.findIndex((s) => s.number === afterNumber);
		if (idx >= 0) {
			state.steps.splice(idx + 1, 0, newStep);
			renumberSteps(state);
			return newStep;
		}
	}

	state.steps.push(newStep);
	renumberSteps(state);
	return newStep;
}

export function insertStepAt(state: PlanState, index: number, text: string): PlanStep | undefined {
	if (index < 0 || index > state.steps.length) return undefined;
	const newStep: PlanStep = {
		id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		number: 0,
		text,
		completed: false,
		failed: false,
		skipped: false,
		filesModified: [],
	};
	state.steps.splice(index, 0, newStep);
	renumberSteps(state);
	return newStep;
}

export function removeStep(state: PlanState, stepNumber: number): boolean {
	const idx = state.steps.findIndex((s) => s.number === stepNumber);
	if (idx < 0) return false;
	state.steps.splice(idx, 1);
	renumberSteps(state);
	advanceToNextStep(state);
	return true;
}

function renumberSteps(state: PlanState): void {
	for (let i = 0; i < state.steps.length; i++) {
		state.steps[i].number = i + 1;
	}
}

function applyToolStatus(state: PlanState, stepNumber: number, status?: string): void {
	switch (status) {
		case "complete":
			markStepComplete(state, stepNumber);
			break;
		case "failed":
			markStepFailed(state, stepNumber);
			break;
		case "skipped":
			skipStep(state, stepNumber);
			break;
	}
}
