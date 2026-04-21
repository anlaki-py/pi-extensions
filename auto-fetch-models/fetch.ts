import type { Api, Model } from "@mariozechner/pi-ai";
import { resolveConfigValue } from "./config.js";
import type { AutoFetchProviderConfig, FetchedModel } from "./types.js";

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

/**
 * Fetch models from a provider's /models endpoint.
 * Returns an empty array on failure (logs warning).
 */
export async function fetchModels(providerName: string, config: AutoFetchProviderConfig): Promise<Model<Api>[]> {
	const baseUrl = config.baseUrl.replace(/\/$/, "");
	const apiKey = resolveConfigValue(config.apiKey);

	if (!apiKey) {
		console.warn(`[auto-fetch-models] Provider "${providerName}": failed to resolve API key`);
		return [];
	}

	try {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${apiKey}`,
			...config.headers,
		};

		const response = await fetch(`${baseUrl}/models`, {
			headers,
		});

		if (!response.ok) {
			console.warn(
				`[auto-fetch-models] Provider "${providerName}": failed to fetch models: HTTP ${response.status} ${response.statusText}`,
			);
			return [];
		}

		const data = await response.json();
		const modelList = parseModelsResponse(data);
		const api = (config.api ?? "openai-completions") as Api;

		return modelList.map((m) => ({
			id: m.id,
			name: m.name ?? m.id,
			api,
			provider: providerName,
			baseUrl,
			reasoning: false,
			input: ["text"] as const,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
			maxTokens: m.max_tokens ?? DEFAULT_MAX_TOKENS,
			headers: undefined,
			compat: undefined,
		}));
	} catch (error) {
		console.warn(`[auto-fetch-models] Provider "${providerName}": ${error instanceof Error ? error.message : error}`);
		return [];
	}
}

/**
 * Parse OpenAI-compatible /models response.
 * Supports both { object: "list", data: [...] } and flat array formats.
 */
function parseModelsResponse(data: unknown): FetchedModel[] {
	// OpenAI format: { object: "list", data: [...] }
	if (data && typeof data === "object" && "data" in data) {
		const obj = data as { data: unknown[] };
		if (Array.isArray(obj.data)) {
			return obj.data.filter(isValidModel);
		}
	}

	// Flat array format: [...]
	if (Array.isArray(data)) {
		return data.filter(isValidModel);
	}

	return [];
}

function isValidModel(item: unknown): item is FetchedModel {
	return item !== null && typeof item === "object" && "id" in item && typeof (item as FetchedModel).id === "string";
}
