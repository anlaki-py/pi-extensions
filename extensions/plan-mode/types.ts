/**
 * Core types for the Plan Mode extension.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";

export type PlanMode = "disabled" | "planning" | "executing";

export interface PlanStep {
	id: string;
	number: number;
	text: string;
	completed: boolean;
	failed: boolean;
	skipped: boolean;
	filesModified: string[];
	startedAt?: number;
	completedAt?: number;
}

export interface PlanState {
	planId: string;
	mode: PlanMode;
	steps: PlanStep[];
	currentStepIndex: number;
	createdAt: number;
	startedExecutionAt?: number;
	completedAt?: number;
}

export interface PersistedPlanState {
	planId: string;
	mode: PlanMode;
	steps: PlanStep[];
	currentStepIndex: number;
	createdAt: number;
	startedExecutionAt?: number;
	completedAt?: number;
}

export interface ExecuteMarker {
	planId: string;
	timestamp: number;
}

export interface ParsedStep {
	number: number;
	text: string;
}

export function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

export function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}
