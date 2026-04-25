/**
 * Execution tracking, completion detection, and rollback helpers.
 */

import { DONE_MENTION_RE, ALT_DONE_RE } from "./constants.js";
import type { PlanState } from "./types.js";
import { getCurrentStep } from "./state.js";

// ---------------------------------------------------------------------------
// Step lifecycle
// ---------------------------------------------------------------------------

export function startExecution(state: PlanState): void {
	state.mode = "executing";
	state.startedExecutionAt = Date.now();
	state.currentStepIndex = 0;
	// Advance past any already-completed steps
	while (state.currentStepIndex < state.steps.length) {
		const s = state.steps[state.currentStepIndex];
		if (!s.completed && !s.skipped) break;
		state.currentStepIndex++;
	}
}

// ---------------------------------------------------------------------------
// Heuristic completion detection (fallback)
// ---------------------------------------------------------------------------

export function detectHeuristicCompletion(state: PlanState, assistantText: string): number[] {
	if (state.mode !== "executing") return [];
	const steps = new Set<number>();

	for (const match of assistantText.matchAll(DONE_MENTION_RE)) {
		const n = Number(match[1]);
		if (Number.isFinite(n) && n > 0) steps.add(n);
	}

	for (const match of assistantText.matchAll(ALT_DONE_RE)) {
		const n = Number(match[1]);
		if (Number.isFinite(n) && n > 0) steps.add(n);
	}

	// Conservative: only accept mentions that reference the current step explicitly
	const current = getCurrentStep(state);
	if (current) {
		const currentMention = new RegExp(`(?:\\bstep\\s+)?\\b${current.number}\\b`, "i");
		if (currentMention.test(assistantText) && /(?:done|complete|finished)/i.test(assistantText)) {
			steps.add(current.number);
		}
	}

	return Array.from(steps).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// File change tracking
// ---------------------------------------------------------------------------

export function trackFileChange(state: PlanState, toolName: string, input: { path?: string }): void {
	if (state.mode !== "executing") return;
	const current = state.steps[state.currentStepIndex];
	if (!current) return;
	if (toolName !== "write" && toolName !== "edit") return;

	const path = input.path;
	if (path && !current.filesModified.includes(path)) {
		current.filesModified.push(path);
	}
}

export function getAllModifiedFiles(state: PlanState): string[] {
	const files = new Set<string>();
	for (const step of state.steps) {
		for (const f of step.filesModified) files.add(f);
	}
	return Array.from(files).sort();
}

export function getModifiedFilesForStep(state: PlanState, stepNumber: number): string[] {
	const step = state.steps.find((s) => s.number === stepNumber);
	return step ? [...step.filesModified] : [];
}

// ---------------------------------------------------------------------------
// Rollback helpers
// ---------------------------------------------------------------------------

export function buildRollbackReport(state: PlanState): string {
	const lines: string[] = [];
	lines.push("Modified files during execution:");
	for (const step of state.steps) {
		if (step.filesModified.length === 0) continue;
		lines.push(`\nStep ${step.number} (${step.text}):`);
		for (const f of step.filesModified) {
			lines.push(`  ${f}`);
		}
	}
	const allFiles = getAllModifiedFiles(state);
	if (allFiles.length > 0) {
		lines.push("\nTo revert all changes (requires git):");
		lines.push(`  git checkout -- ${allFiles.join(" ")}`);
		lines.push("Or stash:");
		lines.push("  git stash push -m 'plan-mode rollback'");
	}
	return lines.join("\n");
}
