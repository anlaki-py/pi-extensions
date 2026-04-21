/**
 * MCP Extension Configuration
 *
 * Loads MCP server configs from:
 * 1. ~/.pi/mcp.json (global)
 * 2. ./mcp.json (project-local, overrides global)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { McpJsonConfig, McpServerConfig } from "./types.js";

const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "mcp.json");

/**
 * Load and merge MCP server configs.
 */
export async function loadConfig(_ctx: ExtensionContext): Promise<Record<string, McpServerConfig>> {
	const servers: Record<string, McpServerConfig> = {};

	// Load global config
	if (existsSync(GLOBAL_CONFIG_PATH)) {
		try {
			const content = readFileSync(GLOBAL_CONFIG_PATH, "utf-8");
			const config = JSON.parse(content) as McpJsonConfig;
			if (config.mcpServers) {
				Object.assign(servers, config.mcpServers);
			}
		} catch (error) {
			console.error(`Failed to load global MCP config: ${error}`);
		}
	}

	// Load local config (overrides global)
	const localConfigPath = join(process.cwd(), "mcp.json");
	if (existsSync(localConfigPath)) {
		try {
			const content = readFileSync(localConfigPath, "utf-8");
			const config = JSON.parse(content) as McpJsonConfig;
			if (config.mcpServers) {
				Object.assign(servers, config.mcpServers);
			}
		} catch (error) {
			console.error(`Failed to load local MCP config: ${error}`);
		}
	}

	return servers;
}
