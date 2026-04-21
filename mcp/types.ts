/**
 * MCP Extension Types
 *
 * Type definitions for MCP server configuration and connection state.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";

// Transport types
export type Transport = "stdio" | "http" | "sse" | "ws";

// Server configurations

export interface McpStdioServerConfig {
	type: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface McpHTTPServerConfig {
	type: "http";
	url: string;
	headers?: Record<string, string>;
}

export interface McpSSEServerConfig {
	type: "sse";
	url: string;
	headers?: Record<string, string>;
}

export interface McpWebSocketServerConfig {
	type: "ws";
	url: string;
	headers?: Record<string, string>;
}

export type McpServerConfig =
	| McpStdioServerConfig
	| McpHTTPServerConfig
	| McpSSEServerConfig
	| McpWebSocketServerConfig;

// Config file format
export interface McpJsonConfig {
	mcpServers: Record<string, McpServerConfig>;
}

// Server connection states

export interface ConnectedMCPServer {
	client: Client;
	name: string;
	type: "connected";
	capabilities: ServerCapabilities;
	instructions?: string;
	config: McpServerConfig;
	cleanup: () => Promise<void>;
}

export interface FailedMCPServer {
	name: string;
	type: "failed";
	config: McpServerConfig;
	error?: string;
}

export interface PendingMCPServer {
	name: string;
	type: "pending";
	config: McpServerConfig;
}

export interface DisabledMCPServer {
	name: string;
	type: "disabled";
	config: McpServerConfig;
}

export type MCPServerConnection = ConnectedMCPServer | FailedMCPServer | PendingMCPServer | DisabledMCPServer;

// Tool definition from MCP server
export interface MCPTool {
	name: string;
	description?: string;
	inputSchema: {
		type: "object";
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

// Config file locations
export const GLOBAL_CONFIG_PATH = "~/.pi/mcp.json";
export const LOCAL_CONFIG_PATH = "./mcp.json";
