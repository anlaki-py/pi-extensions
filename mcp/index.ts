/**
 * MCP Extension for pi
 *
 * Provides MCP (Model Context Protocol) server integration.
 * Connects to MCP servers and exposes their tools as pi tools.
 *
 * Configuration:
 * - Global: ~/.pi/mcp.json
 * - Local: ./mcp.json (project directory, overrides global)
 *
 * Example config:
 * ```json
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "."]
 *     },
 *     "github": {
 *       "type": "http",
 *       "url": "https://mcp.github.com/v1",
 *       "headers": {
 *         "Authorization": "Bearer ${GITHUB_TOKEN}"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * Commands:
 * - /mcp - Show MCP server status and manage connections
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@mariozechner/pi-tui";
import { connectToServer, fetchTools } from "./client.js";
import { loadConfig } from "./config.js";
import { clearAll, getRegisteredTools, registerMCPTools, registerServer, unregisterServer } from "./tools.js";
import type { MCPServerConnection } from "./types.js";

export default function mcpExtension(pi: ExtensionAPI) {
	// Track servers
	const servers = new Map<string, MCPServerConnection>();

	/**
	 * Connect to a single MCP server.
	 */
	async function connectServer(
		name: string,
		config: MCPServerConnection extends { config: infer C } ? C : never,
	): Promise<{ success: boolean; toolCount: number; error?: string }> {
		// Disconnect existing if any
		if (servers.has(name)) {
			const existing = servers.get(name);
			if (existing?.type === "connected") {
				await existing.cleanup();
			}
			servers.delete(name);
			unregisterServer(name);
		}

		// Connect
		const result = await connectToServer(name, config);

		if (result.type === "connected") {
			servers.set(name, result);
			registerServer(name, result);

			// Fetch and register tools
			const tools = await fetchTools(result);
			registerMCPTools(pi, name, tools, result);

			return { success: true, toolCount: tools.length };
		}

		// Failed
		servers.set(name, result);
		const errorMsg = result.type === "failed" ? result.error : undefined;
		return { success: false, toolCount: 0, error: errorMsg };
	}

	/**
	 * Disconnect from a server.
	 */
	async function disconnectServer(name: string): Promise<void> {
		const server = servers.get(name);
		if (server?.type === "connected") {
			await server.cleanup();
		}
		servers.delete(name);
		unregisterServer(name);
	}

	/**
	 * Disconnect from all servers.
	 */
	async function disconnectAll(): Promise<void> {
		for (const [name] of servers) {
			await disconnectServer(name);
		}
		clearAll();
	}

	/**
	 * Connect to all configured servers.
	 */
	async function connectAllServers(ctx: ExtensionContext, configs: Record<string, unknown>): Promise<void> {
		const entries = Object.entries(configs) as [
			string,
			MCPServerConnection extends { config: infer C } ? C : never,
		][];

		if (entries.length === 0) {
			ctx.ui.notify("No MCP servers configured", "info");
			return;
		}

		const results: string[] = [];

		for (const [name, config] of entries) {
			const result = await connectServer(name, config as never);
			if (result.success) {
				results.push(`${name} (${result.toolCount} tools)`);
			} else {
				results.push(`${name}: ${result.error}`);
			}
		}

		const successCount = results.filter((r) => !r.includes(":")).length;
		ctx.ui.notify(`MCP: ${successCount}/${entries.length} servers connected`, successCount > 0 ? "info" : "warning");
	}

	/**
	 * Build status items for UI.
	 */
	function buildStatusItems(): Array<{
		name: string;
		connected: boolean;
		error?: string;
		toolCount: number;
	}> {
		return Array.from(servers.entries()).map(([name, server]) => ({
			name,
			connected: server.type === "connected",
			error: server.type === "failed" ? server.error : undefined,
			toolCount: getRegisteredTools().filter((t) => t.serverName === name).length,
		}));
	}

	// Register /mcp command
	pi.registerCommand("mcp", {
		description: "Show MCP server status or reconnect a server",
		handler: async (args, ctx) => {
			// Parse args
			const trimmed = args?.trim();
			if (trimmed) {
				// Reconnect specific server
				let serverName = trimmed;
				const configs = await loadConfig(ctx);
				const config = configs[serverName];

				if (!config) {
					// Try to match partial name
					const matches = Object.keys(configs).filter((n) => n.startsWith(serverName));
					if (matches.length === 1) {
						serverName = matches[0];
					} else if (matches.length > 1) {
						ctx.ui.notify(`Multiple servers match: ${matches.join(", ")}`, "error");
						return;
					} else {
						ctx.ui.notify(`MCP server not found: ${serverName}`, "error");
						return;
					}
				}

				// Reconnect
				const result = await connectServer(serverName, configs[serverName] as never);
				if (result.success) {
					ctx.ui.notify(`Connected to ${serverName} (${result.toolCount} tools)`, "info");
				} else {
					ctx.ui.notify(`Failed to connect to ${serverName}: ${result.error}`, "error");
				}
				return;
			}

			// Show status UI
			await ctx.ui.custom((tui, theme, _kb, done) => {
				const configs = Array.from(servers.keys());
				const items: SettingItem[] = buildStatusItems().map((s) => ({
					id: s.name,
					label: s.name,
					currentValue: s.connected
						? `connected (${s.toolCount} tools)`
						: `failed${s.error ? `: ${s.error}` : ""}`,
					values: s.connected ? ["disconnect", "reconnect"] : ["connect"],
				}));

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [
								theme.fg("accent", theme.bold("MCP Server Status")),
								"",
								`Config: ~/.pi/mcp.json or ./mcp.json`,
								`Servers: ${configs.length}`,
								"",
							];
						}
						invalidate() {}
					})(),
				);

				if (items.length === 0) {
					container.addChild(
						new (class {
							render(_width: number) {
								return ["No MCP servers configured.", ""];
							}
							invalidate() {}
						})(),
					);
				} else {
					const list = new SettingsList(
						items,
						Math.min(items.length + 2, 15),
						getSettingsListTheme(),
						async (id, action) => {
							if (action === "connect") {
								// Connect to disconnected server
							} else if (action === "disconnect") {
								await disconnectServer(id);
								ctx.ui.notify(`Disconnected from ${id}`, "info");
							} else if (action === "reconnect") {
								await disconnectServer(id);
								const configs = await loadConfig(ctx);
								const result = await connectServer(id, configs[id] as never);
								if (result.success) {
									ctx.ui.notify(`Reconnected to ${id}`, "info");
								} else {
									ctx.ui.notify(`Failed: ${result.error}`, "error");
								}
							}
						},
						() => done(undefined),
					);
					container.addChild(list);

					return {
						render(width: number) {
							return container.render(width);
						},
						invalidate() {
							container.invalidate();
						},
						handleInput(data: string) {
							list.handleInput?.(data);
							tui.requestRender();
						},
					};
				}

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(_data: string) {
						done(undefined);
					},
				};
			});
		},
	});

	// Hook into session start
	pi.on("session_start", async (_event, ctx) => {
		const configs = await loadConfig(ctx);

		// Store configs for later use
		for (const [name, config] of Object.entries(configs)) {
			servers.set(name, { name, type: "pending", config: config as never });
		}

		// Auto-connect
		await connectAllServers(ctx, configs);
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		await disconnectAll();
	});
}
