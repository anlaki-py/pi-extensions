/**
 * Plan extraction from assistant messages.
 */

import { PLAN_HEADER_RE, STEP_RE } from "./constants.js";
import type { ParsedStep } from "./types.js";

function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractPlanSteps(message: string): ParsedStep[] {
	const items: ParsedStep[] = [];
	const headerMatch = message.match(PLAN_HEADER_RE);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*?\*?([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const rawText = match[2].trim().replace(/\*{1,2}$/, "").trim();
		if (rawText.length > 5 && !rawText.startsWith("`") && !rawText.startsWith("/") && !rawText.startsWith("-")) {
			const cleaned = cleanStepText(rawText);
			if (cleaned.length > 3) {
				items.push({ number: items.length + 1, text: cleaned });
			}
		}
	}
	return items;
}

/**
 * Heuristic: scan assistant text for phrases indicating step completion.
 * Returns step numbers that appear to be marked done in prose.
 */
export function detectDoneMentions(text: string): number[] {
	const steps = new Set<number>();

	for (const match of text.matchAll(DONE_MENTION_RE)) {
		const n = Number(match[1]);
		if (Number.isFinite(n) && n > 0) steps.add(n);
	}

	for (const match of text.matchAll(ALT_DONE_RE)) {
		const n = Number(match[1]);
		if (Number.isFinite(n) && n > 0) steps.add(n);
	}

	return Array.from(steps).sort((a, b) => a - b);
}
