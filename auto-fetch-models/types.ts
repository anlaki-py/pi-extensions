import type { Api } from "@mariozechner/pi-ai";

export interface AutoFetchProviderConfig {
	baseUrl: string;
	apiKey: string;
	api?: Api;
	models: "auto";
	headers?: Record<string, string>;
	authHeader?: boolean;
}

export interface AutoFetchConfig {
	providers: Record<string, AutoFetchProviderConfig>;
}

export interface FetchedModel {
	id: string;
	name?: string;
	context_window?: number;
	max_tokens?: number;
}

export interface ModelsEndpointResponse {
	object?: string;
	data?: FetchedModel[];
}
