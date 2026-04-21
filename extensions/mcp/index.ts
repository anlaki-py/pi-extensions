/**
 * MCP Extension for pi
 *
 * Provides MCP (Model Context Protocol) server integration.
 * Connects to MCP servers and exposes their tools as pi tools.
 *
 * Configuration:
 * - Global: ~/.pi/agent/mcp.json
 * - Local: .pi/mcp.json (project directory, overrides global)
 *
 * State:
 * - Disabled servers: ~/.pi/agent/mcp-state.json
 *
 * Commands:
 * - /mcp                          Show server status and manage connections
 * - /mcp help                     Show help
 * - /mcp <name>                   Reconnect to a specific server
 * - /mcp enable <name>            Enable and connect a server
 * - /mcp disable <name>           Disable a server (prevents auto-connect)
 * - /mcp connect <name>           Connect to a server
 * - /mcp disconnect <name>        Disconnect from a server
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { ServerManager } from "./servers.js";
import { showHelpScreen, showStatusScreen } from "./ui.js";

const SUBCOMMANDS = ["connect", "disconnect", "enable", "disable"] as const;

export default function mcpExtension(pi: ExtensionAPI) {
	const mgr = new ServerManager(pi);

	// /mcp command
	pi.registerCommand("mcp", {
		description: "Show MCP server status, manage connections, or get help",
		handler: async (args, ctx) => {
			const trimmed = args?.trim();

			// /mcp help
			if (trimmed === "help") {
				return showHelpScreen(ctx);
			}

			// /mcp <action> <name> or /mcp <name>
			if (trimmed) {
				const parts = trimmed.split(/\s+/);
				let action: string;
				let serverName: string;

				if (parts.length >= 2 && (SUBCOMMANDS as readonly string[]).includes(parts[0])) {
					action = parts[0];
					serverName = parts.slice(1).join(" ");
				} else {
					action = "reconnect";
					serverName = trimmed;
				}

				const configs = await loadConfig(ctx);
				const resolved = mgr.resolveName(serverName, configs, ctx);
				if (!resolved) return;

				await mgr.executeAction(action, resolved, configs[resolved], ctx);
				return;
			}

			// /mcp (no args) — status UI
			return showStatusScreen(ctx, mgr);
		},
	});

	// Auto-connect on session start
	pi.on("session_start", async (_event, ctx) => {
		const configs = await loadConfig(ctx);
		await mgr.initSession(ctx, configs);
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		await mgr.disconnectAll();
	});
}
