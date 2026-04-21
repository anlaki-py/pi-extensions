/**
 * MCP Client Manager
 *
 * Manages connections to MCP servers and provides a unified interface
 * for tool discovery and execution.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
	ConnectedMCPServer,
	MCPServerConnection,
	MCPTool,
	McpHTTPServerConfig,
	McpServerConfig,
	McpSSEServerConfig,
	McpStdioServerConfig,
} from "./types.js";

/**
 * Expand environment variables in a string.
 * Supports ${VAR_NAME} syntax.
 */
function expandEnvVars(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
		const envValue = process.env[varName];
		if (envValue === undefined) {
			throw new Error(`Environment variable not found: ${varName}`);
		}
		return envValue;
	});
}

/**
 * Expand environment variables in config values.
 */
function expandConfigEnvVars(config: McpServerConfig): McpServerConfig {
	if (config.type === "stdio") {
		return {
			...config,
			env: config.env
				? Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, expandEnvVars(v)]))
				: undefined,
		};
	}

	if (config.type === "http" || config.type === "sse" || config.type === "ws") {
		if (config.headers) {
			return {
				...config,
				headers: Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [k, expandEnvVars(v)])),
			};
		}
	}

	return config;
}

/**
 * Create transport based on server configuration.
 */
async function createTransport(config: McpServerConfig): Promise<Transport> {
	let transport: Transport;

	switch (config.type) {
		case "stdio": {
			const stdioConfig = config as McpStdioServerConfig;
			transport = new StdioClientTransport({
				command: stdioConfig.command,
				args: stdioConfig.args ?? [],
				env: stdioConfig.env ? ({ ...process.env, ...stdioConfig.env } as Record<string, string>) : undefined,
			});
			break;
		}

		case "http": {
			const httpConfig = config as McpHTTPServerConfig;
			transport = new StreamableHTTPClientTransport(new URL(httpConfig.url), {
				requestInit: {
					headers: httpConfig.headers as Record<string, string>,
				},
			});
			break;
		}

		case "sse": {
			const sseConfig = config as McpSSEServerConfig;
			transport = new SSEClientTransport(new URL(sseConfig.url), {
				requestInit: {
					headers: sseConfig.headers as Record<string, string>,
				},
			});
			break;
		}

		case "ws":
			// WebSocket transport is not exported directly from the SDK
			// Would need custom implementation
			throw new Error("WebSocket transport not yet supported");

		default:
			throw new Error(`Unknown transport type: ${(config as { type: string }).type}`);
	}

	return transport;
}

/**
 * Connect to an MCP server.
 */
export async function connectToServer(name: string, config: McpServerConfig): Promise<MCPServerConnection> {
	try {
		// Expand environment variables
		const expandedConfig = expandConfigEnvVars(config);

		// Create transport
		const transport = await createTransport(expandedConfig);

		// Create client
		const client = new Client({ name: "pi-mcp-extension", version: "1.0.0" }, { capabilities: {} });

		// Connect
		await client.connect(transport);

		// Get server capabilities
		const capabilities = client.getServerCapabilities() ?? {};

		// Get instructions if available
		const instructions = client.getInstructions();

		// Create cleanup function
		const cleanup = async () => {
			try {
				await client.close();
			} catch {
				// Ignore cleanup errors
			}
		};

		const connectedServer: ConnectedMCPServer = {
			client,
			name,
			type: "connected",
			capabilities,
			instructions,
			config: expandedConfig,
			cleanup,
		};

		return connectedServer;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			name,
			type: "failed",
			config,
			error: message,
		};
	}
}

/**
 * Fetch tools from a connected MCP server.
 */
export async function fetchTools(server: ConnectedMCPServer): Promise<MCPTool[]> {
	const tools: MCPTool[] = [];
	let cursor: string | undefined;

	do {
		const result = await server.client.listTools({ cursor });
		tools.push(...(result.tools as MCPTool[]));
		cursor = result.nextCursor;
	} while (cursor);

	return tools;
}

/**
 * Call a tool on an MCP server.
 */
export async function callTool(
	server: ConnectedMCPServer,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<{ content: unknown[]; isError: boolean }> {
	const result = await server.client.callTool(
		{ name: toolName, arguments: args },
		undefined,
		signal ? { signal } : undefined,
	);

	return {
		content: result.content as unknown[],
		isError: result.isError === true,
	};
}
