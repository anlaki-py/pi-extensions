import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { AutoFetchConfig } from "./types.js";

const CONFIG_FILE = "auto-fetch-models.json";

/**
 * Resolve a config value that may be:
 * - An environment variable name (resolved from process.env)
 * - A shell command prefixed with "!" (executed, stdout used)
 * - A literal value (used directly)
 */
export function resolveConfigValue(config: string): string | undefined {
	if (config.startsWith("!")) {
		const command = config.slice(1);
		try {
			return execSync(command, { encoding: "utf-8" }).trim();
		} catch {
			console.warn(`[auto-fetch-models] Failed to execute: ${command}`);
			return undefined;
		}
	}

	const envValue = process.env[config];
	return envValue || config;
}

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
 * Load config from project-local or global location.
 * Project-local (.pi/auto-fetch-models.json) takes precedence over global.
 */
export function loadConfig(cwd: string): AutoFetchConfig {
	const configPaths = [join(cwd, ".pi", CONFIG_FILE), join(getAgentDir(), CONFIG_FILE)];

	for (const configPath of configPaths) {
		if (existsSync(configPath)) {
			try {
				const content = readFileSync(configPath, "utf-8");
				const config = JSON.parse(content);
				validateConfig(config, configPath);
				return config;
			} catch (error) {
				if (error instanceof SyntaxError) {
					console.warn(`[auto-fetch-models] Failed to parse ${configPath}: ${error.message}`);
				} else {
					throw error;
				}
			}
		}
	}

	return { providers: {} };
}

function validateConfig(config: unknown, configPath: string): asserts config is AutoFetchConfig {
	if (!config || typeof config !== "object") {
		throw new Error(`[auto-fetch-models] Invalid config: expected object in ${configPath}`);
	}

	const cfg = config as Record<string, unknown>;
	if (!cfg.providers || typeof cfg.providers !== "object") {
		throw new Error(`[auto-fetch-models] Invalid config: missing "providers" object in ${configPath}`);
	}

	for (const [name, provider] of Object.entries(cfg.providers as Record<string, unknown>)) {
		if (!provider || typeof provider !== "object") {
			throw new Error(`[auto-fetch-models] Invalid config: provider "${name}" must be an object`);
		}

		const p = provider as Record<string, unknown>;

		if (typeof p.baseUrl !== "string" || !p.baseUrl) {
			throw new Error(`[auto-fetch-models] Provider "${name}": "baseUrl" is required`);
		}

		if (p.models !== "auto") {
			throw new Error(`[auto-fetch-models] Provider "${name}": "models" must be "auto"`);
		}

		// apiKey is resolved at runtime, can be env ref or shell command
		if (p.apiKey !== undefined && typeof p.apiKey !== "string") {
			throw new Error(`[auto-fetch-models] Provider "${name}": "apiKey" must be a string`);
		}

		// apiKey is required for auto-fetch
		if (!p.apiKey) {
			throw new Error(`[auto-fetch-models] Provider "${name}": "apiKey" is required for auto-fetch`);
		}

		// Validate optional fields
		if (p.api !== undefined && typeof p.api !== "string") {
			throw new Error(`[auto-fetch-models] Provider "${name}": "api" must be a string`);
		}

		if (p.headers !== undefined && typeof p.headers !== "object") {
			throw new Error(`[auto-fetch-models] Provider "${name}": "headers" must be an object`);
		}

		if (p.authHeader !== undefined && typeof p.authHeader !== "boolean") {
			throw new Error(`[auto-fetch-models] Provider "${name}": "authHeader" must be a boolean`);
		}
	}
}
