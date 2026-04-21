/**
 * MCP Extension Configuration
 *
 * Loads MCP server configs from:
 * 1. ~/.pi/agent/mcp.json (global)
 * 2. .pi/mcp.json (project-local, overrides global)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { McpJsonConfig, McpServerConfig } from "./types.js";

/**
 * Get the global agent directory path.
 * Mirrors the logic from getAgentDir() in core.
 */
function getAgentDir(): string {
	const agentDir = process.env.PI_AGENT_DIR;
	if (agentDir) return agentDir;
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	if (!homeDir) throw new Error("Could not determine home directory");
	return join(homeDir, ".pi", "agent");
}

/**
 * Load and merge MCP server configs.
 */
export async function loadConfig(ctx: ExtensionContext): Promise<Record<string, McpServerConfig>> {
	const servers: Record<string, McpServerConfig> = {};
	const configPaths = [
		join(ctx.cwd, ".pi", "mcp.json"),
		join(getAgentDir(), "mcp.json"),
	];

	// Load from both locations (project-local overrides global)
	for (const configPath of configPaths) {
		if (existsSync(configPath)) {
			try {
				const content = readFileSync(configPath, "utf-8");
				const config = JSON.parse(content) as McpJsonConfig;
				if (config.mcpServers) {
					Object.assign(servers, config.mcpServers);
				}
			} catch (error) {
				console.error(`Failed to load MCP config from ${configPath}: ${error}`);
			}
		}
	}

	return servers;
}
