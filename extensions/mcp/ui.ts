/**
 * MCP UI Components
 *
 * Help screen and server list screen rendered via ctx.ui.custom().
 * The server list uses a custom component (not SettingsList) so that:
 *   - Enter toggles connected/disconnected
 *   - Space toggles enabled/disabled
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Key, truncateToWidth } from "@mariozechner/pi-tui";
import { loadConfig } from "./config.js";
import type { ServerManager, StatusItem } from "./servers.js";
import type { McpServerConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Show the /mcp help screen. */
export async function showHelpScreen(ctx: ExtensionContext): Promise<void> {
	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(
			new (class {
				render(_width: number) {
					return [
						theme.fg("accent", theme.bold("MCP Extension Help")),
						"",
						theme.bold("Usage:"),
						"  /mcp                          Show server status and manage connections",
						"  /mcp help                     Show this help",
						"  /mcp <name>                   Reconnect to a specific server",
						"  /mcp enable <name>            Enable and connect a server",
						"  /mcp disable <name>           Disable a server (prevents auto-connect)",
						"  /mcp connect <name>           Connect to a server",
						"  /mcp disconnect <name>        Disconnect from a server",
						"",
						theme.bold("Status UI Controls:"),
						"  ↑/k  ↑↓/j  Navigate",
						"  Enter       Toggle connected/disconnected",
						"  Space       Toggle enabled/disabled",
						"  Esc         Close",
						"",
						theme.bold("Config Files:"),
						"  .pi/mcp.json              Project-local (takes precedence)",
						"  ~/.pi/agent/mcp.json      Global",
						"",
						theme.bold("State File:"),
						"  ~/.pi/agent/mcp-state.json  Disabled server preferences",
						"",
						theme.bold("Examples:"),
						"  /mcp                  Open status UI",
						"  /mcp jina             Reconnect the 'jina' server",
						"  /mcp disable jina     Disable the 'jina' server",
						"  /mcp enable jina      Re-enable the 'jina' server",
						"",
						"Press any key to close.",
					];
				}
				invalidate() {}
			})(),
		);

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
}

/** Show the /mcp status screen with the interactive server list. */
export async function showStatusScreen(ctx: ExtensionContext, mgr: ServerManager): Promise<void> {
	await ctx.ui.custom((tui, theme, _kb, done) => {
		const header = new (class {
			constructor(private serverCount: number) {}
			render(_width: number) {
				return [
					theme.fg("accent", theme.bold("MCP Server Status")),
					"",
					`Config: .pi/mcp.json or ~/.pi/agent/mcp.json`,
					`Servers: ${this.serverCount}`,
					theme.fg("dim", "Enter: connect/disconnect • Space: enable/disable • Esc: close"),
					"",
				];
			}
			invalidate() {}
			setCount(n: number) { this.serverCount = n; }
		})(mgr.servers.size);

		const list = new ServerList(theme, mgr, ctx);

		list.onDone = () => done(undefined);

		const container = new Container();
		container.addChild(header);
		container.addChild(list);

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

// ---------------------------------------------------------------------------
// ServerList — custom component
// ---------------------------------------------------------------------------

class ServerList {
	private selected = 0;
	private items: StatusItem[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];

	/** Fired when the user presses Esc. */
	onDone?: () => void;

	constructor(
		private theme: any,
		private mgr: ServerManager,
		private ctx: ExtensionContext,
	) {
		this.refresh();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.up) || data === "k") {
			if (this.selected > 0) this.selected--;
			this.invalidate();
		} else if (matchesKey(data, Key.down) || data === "j") {
			if (this.selected < this.items.length - 1) this.selected++;
			this.invalidate();
		} else if (matchesKey(data, Key.enter)) {
			this.toggleConnected();
		} else if (matchesKey(data, Key.space)) {
			this.toggleEnabled();
		} else if (matchesKey(data, Key.escape)) {
			this.onDone?.();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		if (this.items.length === 0) {
			this.cachedWidth = width;
			this.cachedLines = ["No MCP servers configured.", ""];
			return this.cachedLines;
		}

		this.cachedLines = this.items.map((item, i) => {
			const prefix = i === this.selected ? "▸ " : "  ";
			const statusTag = this.formatStatus(item);
			const line = `${prefix}${item.name}  ${statusTag}`;
			return truncateToWidth(line, width);
		});

		this.cachedWidth = width;
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	// --- Actions ---

	/** Enter: toggle connected/disconnected. */
	private async toggleConnected(): Promise<void> {
		const item = this.items[this.selected];
		if (!item) return;

		const configs = await loadConfig(this.ctx);
		const config = configs[item.name];
		if (!config) {
			this.ctx.ui.notify(`Server ${item.name} not found in config`, "error");
			return;
		}

		if (item.status === "connected") {
			await this.mgr.disconnect(item.name);
			this.ctx.ui.notify(`Disconnected from ${item.name}`, "info");
		} else {
			// Not connected — try to connect (enables first if disabled)
			if (item.status === "disabled") {
				await this.mgr.enable(item.name, config, this.ctx);
			} else {
				const result = await this.mgr.connect(item.name, config);
				if (result.success) {
					this.ctx.ui.notify(`Connected to ${item.name} (${result.toolCount} tools)`, "info");
				} else {
					this.ctx.ui.notify(`Failed to connect to ${item.name}: ${result.error}`, "error");
				}
			}
		}
		this.refresh();
	}

	/** Space: toggle enabled/disabled. */
	private async toggleEnabled(): Promise<void> {
		const item = this.items[this.selected];
		if (!item) return;

		const configs = await loadConfig(this.ctx);
		const config = configs[item.name];
		if (!config) {
			this.ctx.ui.notify(`Server ${item.name} not found in config`, "error");
			return;
		}

		if (item.status === "disabled") {
			await this.mgr.enable(item.name, config, this.ctx);
		} else {
			await this.mgr.disable(item.name, config, this.ctx);
		}
		this.refresh();
	}

	// --- Helpers ---

	private refresh(): void {
		this.items = this.mgr.buildStatusItems();
		if (this.selected >= this.items.length) {
			this.selected = Math.max(0, this.items.length - 1);
		}
		this.invalidate();
	}

	private formatStatus(item: StatusItem): string {
		const t = this.theme;
		if (item.status === "connected") {
			return t.fg("success", `connected (${item.toolCount} tools)`);
		}
		if (item.status === "disabled") {
			return t.fg("dim", "disabled");
		}
		if (item.status === "failed") {
			return t.fg("error", `failed: ${item.error ?? "unknown"}`);
		}
		return t.fg("muted", "pending");
	}
}
