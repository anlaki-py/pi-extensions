/**
 * ASCII-only UI helpers for plan mode.
 * No emojis - only plain ASCII characters.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { PlanState } from "./types.js";
import { STATUS_ID, WIDGET_ID } from "./constants.js";
import { getCurrentStep, isPlanComplete } from "./state.js";

function asciiProgressBar(current: number, total: number, width = 18): string {
	if (total === 0) return "[" + "=".repeat(width) + "]";
	const filled = Math.round((current / total) * width);
	const empty = Math.max(0, width - filled);
	return "[" + "=".repeat(filled) + "-".repeat(empty) + "]";
}

export function renderPlanWidget(state: PlanState, theme: Theme): string[] {
	if (state.steps.length === 0) return [];

	const lines: string[] = [];
	const completed = state.steps.filter((s) => s.completed).length;
	const total = state.steps.length;
	const failed = state.steps.filter((s) => s.failed).length;
	const skipped = state.steps.filter((s) => s.skipped).length;

	// Header with progress bar
	const bar = asciiProgressBar(completed, total);
	lines.push(`${bar} done:${completed} fail:${failed} skip:${skipped} total:${total}`);
	lines.push("");

	// Steps
	for (let i = 0; i < state.steps.length; i++) {
		const step = state.steps[i];
		const isCurrent = i === state.currentStepIndex && !step.completed && !step.skipped;

		let prefix: string;
		if (step.completed) {
			prefix = theme.fg("success", "[x]");
		} else if (step.failed) {
			prefix = theme.fg("error", "[!]");
		} else if (step.skipped) {
			prefix = theme.fg("muted", "[-]");
		} else if (isCurrent) {
			prefix = theme.fg("accent", "[>]");
		} else {
			prefix = theme.fg("muted", "[ ]");
		}

		let text = step.text;
		if (step.completed) {
			text = theme.strikethrough(text);
		}

		lines.push(`${prefix} ${step.number}. ${text}`);
	}

	return lines;
}

export function updatePlanUI(ctx: ExtensionContext, state: PlanState): void {
	const { ui } = ctx;

	if (state.mode === "planning") {
		ui.setStatus(STATUS_ID, ui.theme.fg("warning", "[PLAN] read-only"));
	} else if (state.mode === "executing") {
		const completed = state.steps.filter((s) => s.completed).length;
		const total = state.steps.length;
		const current = getCurrentStep(state);
		const stepLabel = current ? `step ${current.number}` : "finishing";
		ui.setStatus(STATUS_ID, ui.theme.fg("accent", `[EXEC ${completed}/${total}] ${stepLabel}`));
	} else {
		ui.setStatus(STATUS_ID, undefined);
	}

	if (state.mode !== "disabled" && state.steps.length > 0) {
		ui.setWidget(WIDGET_ID, renderPlanWidget(state, ui.theme));
	} else {
		ui.setWidget(WIDGET_ID, undefined);
	}
}

export function notifyPlanComplete(ctx: ExtensionContext, state: PlanState): void {
	const completed = state.steps.filter((s) => s.completed).length;
	const skipped = state.steps.filter((s) => s.skipped).length;
	const failed = state.steps.filter((s) => s.failed).length;

	const parts: string[] = [];
	parts.push(`Plan complete: ${completed}/${state.steps.length} done`);
	if (skipped > 0) parts.push(`${skipped} skipped`);
	if (failed > 0) parts.push(`${failed} failed`);

	ctx.ui.notify(parts.join(" | "), "info");
}

export function formatPlanForDisplay(state: PlanState): string {
	const lines: string[] = [];
	for (const step of state.steps) {
		let status: string;
		if (step.completed) status = "[x]";
		else if (step.failed) status = "[!]";
		else if (step.skipped) status = "[-]";
		else status = "[ ]";
		lines.push(`${status} ${step.number}. ${step.text}`);
	}
	return lines.join("\n");
}
