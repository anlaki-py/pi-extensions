/**
 * Constants for the Plan Mode extension.
 * All magic strings, regexes, and tool lists live here.
 */

import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Tool sets
// ---------------------------------------------------------------------------
export const TOOLS = {
	PLAN: ["read", "bash", "grep", "find", "ls", "questionnaire"],
	NORMAL: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	EXECUTION: ["read", "bash", "edit", "write", "grep", "find", "ls", "plan_step_complete"],
} as const;

// ---------------------------------------------------------------------------
// Custom entry / message types
// ---------------------------------------------------------------------------
export const ENTRY_TYPE = "plan-mode-v2";
export const EXECUTE_MARKER_TYPE = "plan-execute-marker";

// ---------------------------------------------------------------------------
// UI identifiers
// ---------------------------------------------------------------------------
export const WIDGET_ID = "plan-progress";
export const STATUS_ID = "plan-mode";

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------
export const FLAG_NAME = "plan";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
export const CMD = {
	PLAN: "plan",
	STATUS: "plan-status",
	SKIP: "plan-skip",
	ADD: "plan-add",
	INSERT: "plan-insert",
	DONE: "plan-done",
	RETRY: "plan-retry",
	RESET: "plan-reset",
	ROLLBACK: "plan-rollback",
} as const;

// ---------------------------------------------------------------------------
// System prompt fragments (injected via before_agent_start)
// ---------------------------------------------------------------------------
export const PLAN_SYSTEM_PROMPT_APPENDIX = `
=== PLAN MODE ===
You are in a read-only exploration mode for safe code analysis.

RESTRICTIONS:
- Available tools: read, bash, grep, find, ls, questionnaire
- UNAVAILABLE tools: edit, write (file modifications disabled)
- Bash restricted to read-only allowlist
- Do NOT modify any files

INSTRUCTIONS:
- Ask clarifying questions via questionnaire if needed
- Create a detailed numbered plan under a "Plan:" header
- Use simple format: "1. Description" (one per line)
- Avoid sub-lists, code blocks, or heavy markdown inside the plan

Plan:
1. First step description
2. Second step description
...
=== END PLAN MODE ===`;

export const EXEC_SYSTEM_PROMPT_APPENDIX = `
=== PLAN EXECUTION ===
You are executing a planned sequence of steps with full tool access.

INSTRUCTIONS:
- Focus on the CURRENT step only
- After completing the CURRENT step, call the plan_step_complete tool
- Do NOT proceed to the next step until plan_step_complete is called
- If a step cannot be completed, call plan_step_complete with status=failed and explain why
=== END PLAN EXECUTION ===`;

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------
export const PLAN_HEADER_RE = /\*?\*?Plan:\*?\*?\s*\n/i;
export const STEP_RE = /^\s*(\d+)[.)]\s+(.*)$/gm;

// Heuristic completion detection (fallback when tool isn't used)
export const DONE_MENTION_RE = /(?:step\s+)?#?(\d+)\s+(?:is\s+)?(?:complete|done|finished|completed)/gi;
export const ALT_DONE_RE = /(?:done|finished)\s+(?:with\s+)?(?:step\s+)?#?(\d+)/gi;

// ---------------------------------------------------------------------------
// Custom tool schemas
// ---------------------------------------------------------------------------
export const PlanStepCompleteSchema = Type.Object({
	step_number: Type.Number({ description: "Step number to mark" }),
	status: StringEnum(["complete", "failed", "skipped"] as const),
	reason: Type.Optional(Type.String({ description: "Reason if failed or skipped" })),
});

export type PlanStepCompleteInput = {
	step_number: number;
	status: "complete" | "failed" | "skipped";
	reason?: string;
};
