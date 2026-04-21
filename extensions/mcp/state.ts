/**
 * MCP Extension State Management
 *
 * Persists user preferences (disabled servers) across sessions.
 * State file: ~/.pi/agent/mcp-state.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Get the global agent directory path.
 * Mirrors the logic from getAgentDir() in core.
 */
export function getStateDir(): string {
	const agentDir = process.env.PI_AGENT_DIR;
	if (agentDir) return agentDir;
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	if (!homeDir) throw new Error("Could not determine home directory");
	return join(homeDir, ".pi", "agent");
}

/**
 * State file format.
 */
interface McpState {
	disabledServers: string[];
}

/**
 * Load the set of disabled server names.
 */
export function loadDisabledServers(): Set<string> {
	const statePath = join(getStateDir(), "mcp-state.json");

	if (!existsSync(statePath)) {
		return new Set();
	}

	try {
		const content = readFileSync(statePath, "utf-8");
		const state = JSON.parse(content) as McpState;
		return new Set(state.disabledServers ?? []);
	} catch {
		console.warn("[mcp] Failed to load state file, starting fresh");
		return new Set();
	}
}

/**
 * Save the set of disabled server names.
 */
export function saveDisabledServers(servers: Set<string>): void {
	const stateDir = getStateDir();
	const statePath = join(stateDir, "mcp-state.json");

	// Ensure directory exists
	if (!existsSync(stateDir)) {
		mkdirSync(stateDir, { recursive: true });
	}

	const state: McpState = {
		disabledServers: Array.from(servers),
	};

	try {
		writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
	} catch (error) {
		console.error("[mcp] Failed to save state file:", error);
	}
}

/**
 * Add a server to the disabled list.
 */
export function disableServer(name: string): void {
	const disabled = loadDisabledServers();
	disabled.add(name);
	saveDisabledServers(disabled);
}

/**
 * Remove a server from the disabled list.
 */
export function enableServer(name: string): void {
	const disabled = loadDisabledServers();
	disabled.delete(name);
	saveDisabledServers(disabled);
}