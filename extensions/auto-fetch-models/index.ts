/**
 * Auto-Fetch Models Extension
 *
 * Automatically discovers and registers models from OpenAI-compatible providers.
 *
 * Configuration file: ~/.pi/agent/auto-fetch-models.json or .pi/auto-fetch-models.json
 *
 * Example config:
 * {
 *   "providers": {
 *     "ollama": {
 *       "baseUrl": "http://localhost:11434/v1",
 *       "apiKey": "ollama",
 *       "models": "auto"
 *     },
 *     "lm-studio": {
 *       "baseUrl": "http://localhost:1234/v1",
 *       "apiKey": "lm-studio",
 *       "models": "auto"
 *     }
 *   }
 * }
 *
 * The "models": "auto" field triggers fetching from the provider's /models endpoint.
 * API keys can be:
 * - Environment variable name: "OLLAMA_API_KEY" (resolved from process.env)
 * - Shell command: "!cat ~/.api_key" (executed, stdout used)
 * - Literal value: "sk-1234" (used directly)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { fetchModels } from "./fetch.js";

export default async function (pi: ExtensionAPI): Promise<void> {
	const cwd = process.cwd();
	const config = loadConfig(cwd);

	const providerNames = Object.keys(config.providers);
	if (providerNames.length === 0) {
		return; // No providers configured
	}

	// Fetch models from all providers in parallel
	const results = await Promise.all(
		providerNames.map(async (name) => {
			const providerConfig = config.providers[name];
			const models = await fetchModels(name, providerConfig);
			return { name, config: providerConfig, models };
		}),
	);

	// Register each provider
	for (const { name, config, models } of results) {
		if (models.length === 0) {
			console.warn(`[auto-fetch-models] Provider "${name}": no models available, skipping registration`);
			continue;
		}

		pi.registerProvider(name, {
			baseUrl: config.baseUrl,
			apiKey: config.apiKey,
			api: config.api ?? "openai-completions",
			headers: config.headers,
			authHeader: config.authHeader,
			models: models.map((m) => ({
				id: m.id,
				name: m.name,
				reasoning: m.reasoning,
				input: m.input,
				cost: m.cost,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			})),
		});

		console.log(`[auto-fetch-models] Registered "${name}" with ${models.length} model(s)`);
	}
}
