/**
 * MCP Tool Registration
 *
 * Converts MCP tools to pi tools and handles tool call proxying.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type TSchema } from "@sinclair/typebox";
import { callTool } from "./client.js";
import type { ConnectedMCPServer, MCPTool } from "./types.js";

/**
 * Generate a namespaced tool name for pi.
 * Format: mcp__<server>__<tool>
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
	const normalizedServer = serverName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
	const normalizedTool = toolName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
	return `mcp__${normalizedServer}__${normalizedTool}`;
}

/**
 * Parse server and tool name from a namespaced tool name.
 */
export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
	const match = /^mcp__([^_]+)__(.+)$/.exec(fullName);
	if (!match) return null;
	return { serverName: match[1], toolName: match[2] };
}

/**
 * Convert MCP input schema to TypeBox schema.
 * Preserves type information and required/optional status for proper parameter handling.
 */
function mcpSchemaToTypeBox(inputSchema: MCPTool["inputSchema"]): ReturnType<typeof Type.Object> {
	const props: Record<string, TSchema> = {};
	const required = new Set(inputSchema.required ?? []);

	if (inputSchema.properties) {
		for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
			const schema = propSchema as { type?: string | string[]; items?: unknown };
			const typeBox = jsonSchemaToTypeBox(schema);
			// Mark as optional if not in required array
			props[key] = required.has(key) ? typeBox : Type.Optional(typeBox);
		}
	}

	return Type.Object(props);
}

/**
 * Convert a JSON Schema property to TypeBox type.
 */
function jsonSchemaToTypeBox(schema: { type?: string | string[]; items?: unknown }): TSchema {
	const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

	// Handle union types (e.g., ["string", "null"])
	if (types.length > 1) {
		const typeBoxTypes = types.map((t) => primitiveToTypeBox(t, schema));
		return Type.Union(typeBoxTypes);
	}

	// Single type or no type (default to Any)
	const type = types[0];
	if (!type) return Type.Any();

	return primitiveToTypeBox(type, schema);
}

/**
 * Convert a primitive JSON Schema type to TypeBox.
 */
function primitiveToTypeBox(type: string, schema: { items?: unknown }): TSchema {
	switch (type) {
		case "string":
			return Type.String();
		case "number":
			return Type.Number();
		case "integer":
			return Type.Integer();
		case "boolean":
			return Type.Boolean();
		case "array":
			return Type.Array(
				schema.items
					? jsonSchemaToTypeBox(schema.items as { type?: string | string[]; items?: unknown })
					: Type.Any(),
			);
		case "object":
			return Type.Record(Type.String(), Type.Any());
		case "null":
			return Type.Null();
		default:
			return Type.Any();
	}
}

// Track registered tools
const registeredTools = new Map<string, { serverName: string; toolName: string }>();

// Track connected servers
const connectedServers = new Map<string, ConnectedMCPServer>();

/**
 * Register a connected server.
 */
export function registerServer(name: string, server: ConnectedMCPServer): void {
	connectedServers.set(name, server);
}

/**
 * Unregister a server.
 */
export function unregisterServer(name: string): void {
	connectedServers.delete(name);
	// Remove tools for this server
	for (const [toolName, info] of registeredTools.entries()) {
		if (info.serverName === name) {
			registeredTools.delete(toolName);
		}
	}
}

/**
 * Get a connected server by name.
 */
export function getServer(name: string): ConnectedMCPServer | undefined {
	return connectedServers.get(name);
}

/**
 * Clear all registered tools and servers.
 */
export function clearAll(): void {
	registeredTools.clear();
	connectedServers.clear();
}

/**
 * Register MCP tools as pi tools.
 */
export function registerMCPTools(
	pi: ExtensionAPI,
	serverName: string,
	tools: MCPTool[],
	server: ConnectedMCPServer,
): number {
	let count = 0;

	for (const tool of tools) {
		const piToolName = buildMcpToolName(serverName, tool.name);

		// Skip if already registered
		if (registeredTools.has(piToolName)) {
			continue;
		}

		// Track this tool
		registeredTools.set(piToolName, { serverName, toolName: tool.name });

		// Convert schema
		const parameters = mcpSchemaToTypeBox(tool.inputSchema);

		// Register with pi
		pi.registerTool({
			name: piToolName,
			label: `[${serverName}] ${tool.name}`,
			description: tool.description ?? `MCP tool: ${tool.name} (from ${serverName})`,
			parameters,
			promptSnippet: tool.description ? tool.description.slice(0, 80) : undefined,
			async execute(_toolCallId, params, _onUpdate, _ctx) {
				try {
					const result = await callTool(server, tool.name, params as Record<string, unknown>);

					// Build text content from result
					const textContent = result.content
						.map((block: unknown) => {
							const b = block as Record<string, unknown>;
							if (b.type === "text") return (b as { text: string }).text;
							if (b.type === "image") return `[Image: ${(b as { mimeType?: string }).mimeType}]`;
							if (b.type === "resource") {
								const r = b as { resource?: { uri?: string } };
								return `[Resource: ${r.resource?.uri ?? "unknown"}]`;
							}
							return JSON.stringify(block);
						})
						.join("\n");

					return {
						content: [{ type: "text", text: textContent }],
						details: { server: serverName, tool: tool.name },
						isError: result.isError,
					};
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text", text: `MCP error: ${message}` }],
						details: { server: serverName, tool: tool.name, error: message },
						isError: true,
					};
				}
			},
		});

		count++;
	}

	return count;
}

/**
 * Get all registered tool info.
 */
export function getRegisteredTools(): Array<{ serverName: string; toolName: string }> {
	return Array.from(registeredTools.entries()).map(([_name, info]) => ({
		...info,
	}));
}
