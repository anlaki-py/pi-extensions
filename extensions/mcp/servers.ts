/**
 * MCP Server Manager
 *
 * Owns the server map and provides all server lifecycle operations:
 * connect, disconnect, enable, disable, resolve names, batch connect.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { connectToServer, fetchTools } from "./client.js";
import { disableServer as saveDisabledServer, enableServer as saveEnabledServer, loadDisabledServers, saveDisabledServers } from "./state.js";
import { clearAll, getRegisteredTools, registerMCPTools, registerServer, unregisterServer } from "./tools.js";
import type { MCPServerConnection, McpServerConfig } from "./types.js";

export type ConnectResult = { success: boolean; toolCount: number; error?: string };

export type StatusItem = {
	name: string;
	status: "connected" | "failed" | "disabled" | "pending";
	error?: string;
	toolCount: number;
};

export class ServerManager {
	readonly servers = new Map<string, MCPServerConnection>();

	/** Connect to a single server (disconnects existing first). */
	async connect(name: string, config: McpServerConfig): Promise<ConnectResult> {
		if (this.servers.has(name)) {
			const existing = this.servers.get(name);
			if (existing?.type === "connected") {
				try {
					await existing.cleanup();
				} catch {
					// Server may already be closed
				}
			}
			this.servers.delete(name);
			unregisterServer(name);
		}

		const result = await connectToServer(name, config);

		if (result.type === "connected") {
			this.servers.set(name, result);
			registerServer(name, result);
			const tools = await fetchTools(result);
			registerMCPTools(this.pi, name, tools, result);
			return { success: true, toolCount: tools.length };
		}

		this.servers.set(name, result);
		return { success: false, toolCount: 0, error: result.type === "failed" ? result.error : undefined };
	}

	/** Disconnect a single server. */
	async disconnect(name: string): Promise<void> {
		const server = this.servers.get(name);
		if (server?.type === "connected") {
			try {
				await server.cleanup();
			} catch {
				// Server may already be closed
			}
		}
		this.servers.delete(name);
		unregisterServer(name);
	}

	/** Disconnect all servers and clear tool registrations. */
	async disconnectAll(): Promise<void> {
		for (const [name] of this.servers) {
			await this.disconnect(name);
		}
		clearAll();
	}

	/** Connect all non-disabled servers, notify with summary. */
	async connectAll(
		ctx: ExtensionContext,
		configs: Record<string, McpServerConfig>,
		disabledServers: Set<string>,
	): Promise<void> {
		const entries = Object.entries(configs) as [string, McpServerConfig][];

		if (entries.length === 0) {
			ctx.ui.notify("No MCP servers configured", "info");
			return;
		}

		const toConnect = entries.filter(([name]) => !disabledServers.has(name));

		if (toConnect.length === 0) {
			ctx.ui.notify(`MCP: All ${entries.length} servers disabled`, "info");
			return;
		}

		const results: string[] = [];
		for (const [name, config] of toConnect) {
			const result = await this.connect(name, config);
			if (result.success) {
				results.push(`${name} (${result.toolCount} tools)`);
			} else {
				results.push(`${name}: ${result.error}`);
			}
		}

		const successCount = results.filter((r) => !r.includes(":")).length;
		const disabledCount = entries.length - toConnect.length;
		const msg = disabledCount > 0
			? `MCP: ${successCount}/${toConnect.length} connected, ${disabledCount} disabled`
			: `MCP: ${successCount}/${toConnect.length} servers connected`;
		ctx.ui.notify(msg, successCount > 0 ? "info" : "warning");
	}

	/** Disable a server: disconnect + persist disabled state. */
	async disable(name: string, config: McpServerConfig, ctx: ExtensionContext): Promise<void> {
		await this.disconnect(name);
		this.servers.set(name, { name, type: "disabled", config });
		saveDisabledServer(name);
		ctx.ui.notify(`Disabled ${name}`, "info");
	}

	/** Enable a server: clear disabled state + connect. */
	async enable(name: string, config: McpServerConfig, ctx: ExtensionContext): Promise<void> {
		saveEnabledServer(name);
		const result = await this.connect(name, config);
		if (result.success) {
			ctx.ui.notify(`Enabled and connected to ${name} (${result.toolCount} tools)`, "info");
		} else {
			ctx.ui.notify(`Failed to connect to ${name}: ${result.error}`, "error");
		}
	}

	/** Execute a named action (connect/disconnect/enable/disable/reconnect). */
	async executeAction(action: string, name: string, config: McpServerConfig, ctx: ExtensionContext): Promise<void> {
		switch (action) {
			case "disable":
				return this.disable(name, config, ctx);
			case "enable":
				return this.enable(name, config, ctx);
			case "disconnect": {
				const server = this.servers.get(name);
				if (server?.type !== "connected") {
					ctx.ui.notify(`${name} is not connected`, "warning");
					return;
				}
				await this.disconnect(name);
				ctx.ui.notify(`Disconnected from ${name}`, "info");
				return;
			}
			default: {
				// "connect" or "reconnect"
				const result = await this.connect(name, config);
				if (result.success) {
					ctx.ui.notify(`Connected to ${name} (${result.toolCount} tools)`, "info");
				} else {
					ctx.ui.notify(`Failed to connect to ${name}: ${result.error}`, "error");
				}
			}
		}
	}

	/** Resolve a server name, supporting partial prefix matches. */
	resolveName(input: string, configs: Record<string, McpServerConfig>, ctx: ExtensionContext): string | undefined {
		if (configs[input]) return input;

		const matches = Object.keys(configs).filter((n) => n.startsWith(input));
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) {
			ctx.ui.notify(`Multiple servers match "${input}": ${matches.join(", ")}`, "error");
			return undefined;
		}
		ctx.ui.notify(`MCP server not found: ${input}`, "error");
		return undefined;
	}

	/** Build status items for the UI. */
	buildStatusItems(): StatusItem[] {
		return Array.from(this.servers.entries()).map(([name, server]) => ({
			name,
			status: server.type,
			error: server.type === "failed" ? server.error : undefined,
			toolCount: server.type === "connected"
				? getRegisteredTools().filter((t) => t.serverName === name).length
				: 0,
		}));
	}

	/** Load disabled state, clean stale entries, seed the server map, auto-connect. */
	async initSession(ctx: ExtensionContext, configs: Record<string, McpServerConfig>): Promise<void> {
		const disabledServers = loadDisabledServers();

		// Clean up disabled servers that no longer exist in config
		let changed = false;
		for (const name of disabledServers) {
			if (!configs[name]) {
				disabledServers.delete(name);
				changed = true;
			}
		}
		if (changed) saveDisabledServers(disabledServers);

		// Seed server map
		for (const [name, config] of Object.entries(configs)) {
			if (disabledServers.has(name)) {
				this.servers.set(name, { name, type: "disabled", config });
			} else {
				this.servers.set(name, { name, type: "pending", config });
			}
		}

		await this.connectAll(ctx, configs, disabledServers);
	}

	constructor(private pi: import("@mariozechner/pi-coding-agent").ExtensionAPI) {}
}
