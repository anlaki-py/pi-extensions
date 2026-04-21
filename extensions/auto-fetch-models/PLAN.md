# Auto-Fetch Models Extension - Implementation Plan

## Overview

This extension enables automatic model discovery from custom providers that expose an OpenAI-compatible `/models` endpoint. Instead of manually listing models in `models.json`, providers can specify `"models": "auto"` and the extension will fetch available models at startup.

## Extension Location

```
packages/coding-agent/examples/extensions/auto-fetch-models/
├── index.ts              # Extension entry point
├── config.ts             # Config schema and loading
├── fetch.ts              # Model fetching logic
├── types.ts              # Shared types
└── README.md             # Usage documentation
```

## Configuration Format

### Config File Location

- Global: `~/.pi/agent/auto-fetch-models.json`
- Project-local: `.pi/auto-fetch-models.json` (overrides global)

### Config Schema

```json
{
  "providers": {
    "my-ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "api": "openai-completions",
      "models": "auto"
    },
    "lm-studio": {
      "baseUrl": "http://localhost:1234/v1",
      "apiKey": "lm-studio",
      "api": "openai-completions",
      "models": "auto"
    },
    "my-proxy": {
      "baseUrl": "https://proxy.example.com/v1",
      "apiKey": "!cat ~/.api_key",
      "api": "openai-completions",
      "models": "auto",
      "headers": {
        "X-Custom-Header": "value"
      }
    }
  }
}
```

### Field Definitions

| Field | Required | Description |
|-------|----------|-------------|
| `baseUrl` | Yes | API endpoint URL (without `/models` suffix) |
| `apiKey` | Yes* | API key, env var name, or shell command (`!cmd`) |
| `api` | No | API type, defaults to `"openai-completions"` |
| `models` | Yes | Must be `"auto"` to trigger fetching |
| `headers` | No | Custom headers for requests |
| `authHeader` | No | If true, adds `Authorization: Bearer` header |

*Required unless using OAuth (not supported in this extension)

## Types

```typescript
// types.ts

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
```

## Implementation

### 1. Config Loading (config.ts)

```typescript
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { AutoFetchConfig } from "./types.js";

const CONFIG_FILE = "auto-fetch-models.json";

export function loadConfig(cwd: string): AutoFetchConfig {
  const configPaths = [
    join(cwd, ".pi", CONFIG_FILE),           // Project-local
    join(getAgentDir(), CONFIG_FILE),        // Global
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      validateConfig(config);
      return config;
    }
  }

  return { providers: {} };
}

function validateConfig(config: unknown): asserts config is AutoFetchConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid config: expected object");
  }
  
  const cfg = config as Record<string, unknown>;
  if (!cfg.providers || typeof cfg.providers !== "object") {
    throw new Error('Invalid config: missing "providers" object');
  }

  for (const [name, provider] of Object.entries(cfg.providers as Record<string, unknown>)) {
    if (!provider || typeof provider !== "object") {
      throw new Error(`Invalid config: provider "${name}" must be an object`);
    }
    
    const p = provider as Record<string, unknown>;
    
    if (typeof p.baseUrl !== "string" || !p.baseUrl) {
      throw new Error(`Provider "${name}": "baseUrl" is required`);
    }
    
    if (p.models !== "auto") {
      throw new Error(`Provider "${name}": "models" must be "auto"`);
    }
    
    // apiKey is resolved at runtime, can be env ref or shell command
    if (p.apiKey !== undefined && typeof p.apiKey !== "string") {
      throw new Error(`Provider "${name}": "apiKey" must be a string`);
    }
  }
}
```

### 2. API Key Resolution (config.ts)

```typescript
import { execSync } from "child_process";

export function resolveConfigValue(config: string): string | undefined {
  if (config.startsWith("!")) {
    // Shell command
    const command = config.slice(1);
    try {
      return execSync(command, { encoding: "utf-8" }).trim();
    } catch {
      console.warn(`[auto-fetch-models] Failed to execute: ${command}`);
      return undefined;
    }
  }
  
  // Environment variable or literal
  const envValue = process.env[config];
  return envValue || config;
}
```

### 3. Model Fetching (fetch.ts)

```typescript
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AutoFetchProviderConfig, FetchedModel } from "./types.js";
import { resolveConfigValue } from "./config.js";

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

export async function fetchModels(
  providerName: string,
  config: AutoFetchProviderConfig,
): Promise<Model<Api>[]> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const apiKey = resolveConfigValue(config.apiKey);
  
  if (!apiKey) {
    console.warn(`[auto-fetch-models] Provider "${providerName}": failed to resolve API key`);
    return [];
  }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...config.headers,
      },
    });

    if (!response.ok) {
      console.warn(
        `[auto-fetch-models] Provider "${providerName}": failed to fetch models: HTTP ${response.status}`
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
    console.warn(
      `[auto-fetch-models] Provider "${providerName}": ${error instanceof Error ? error.message : error}`
    );
    return [];
  }
}

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
  return (
    item !== null &&
    typeof item === "object" &&
    "id" in item &&
    typeof (item as FetchedModel).id === "string"
  );
}
```

### 4. Extension Entry Point (index.ts)

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { fetchModels } from "./fetch.js";

export default async function (pi: ExtensionAPI) {
  // Get cwd from extension context (available after initialization)
  // For now, use process.cwd()
  const cwd = process.cwd();
  
  // Load config from ~/.pi/agent/ or .pi/
  const config = loadConfig(cwd);
  
  if (Object.keys(config.providers).length === 0) {
    return; // No providers configured
  }

  // Fetch models from all providers in parallel
  const results = await Promise.all(
    Object.entries(config.providers).map(async ([name, providerConfig]) => {
      const models = await fetchModels(name, providerConfig);
      return { name, config: providerConfig, models };
    })
  );

  // Register each provider
  for (const { name, config, models } of results) {
    if (models.length === 0) {
      console.warn(`[auto-fetch-models] Provider "${name}": no models available`);
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

    console.log(`[auto-fetch-models] Registered "${name}" with ${models.length} models`);
  }
}
```

## Default Model Values

When converting fetched models to Pi's `Model` type:

| Field | Default Value |
|-------|--------------|
| `name` | Same as `id` |
| `api` | `"openai-completions"` |
| `reasoning` | `false` |
| `input` | `["text"]` |
| `cost.input` | `0` |
| `cost.output` | `0` |
| `cost.cacheRead` | `0` |
| `cost.cacheWrite` | `0` |
| `contextWindow` | `128000` |
| `maxTokens` | `16384` |

## Error Handling

1. **Config file missing**: Silently return empty config (no providers)
2. **Config parse error**: Log warning, return empty config
3. **Config validation error**: Throw with descriptive message
4. **API key resolution fails**: Log warning, skip provider
5. **Network request fails**: Log warning with HTTP status, skip provider
6. **Invalid response format**: Log warning, skip provider
7. **No models returned**: Log warning, don't register provider

## Key Design Decisions

### 1. Async Factory Function

The extension uses an async factory function (`export default async function`). Pi waits for this to complete before continuing startup, ensuring models are available immediately for:
- Initial model selection (`--model` flag)
- Model listing (`pi --list-models`)
- Session startup

### 2. Parallel Fetching

All provider endpoints are fetched in parallel using `Promise.all()` to minimize startup delay.

### 3. Graceful Degradation

If a provider's endpoint is unavailable (common for local servers like Ollama), the extension logs a warning and continues with other providers. No hard failures.

### 4. Config File Separation

Using a separate config file (`auto-fetch-models.json`) instead of modifying `models.json` because:
- Preserves user's manual model definitions
- Allows different config structure (`models: "auto"` vs explicit model list)
- Cleaner separation of concerns
- Extension-specific config can be extended independently

### 5. No OAuth Support

This extension does not support OAuth providers. Those should be registered manually in `models.json` or via a custom OAuth extension. The focus is on simple API key auth.

## Testing

### Manual Testing

1. Create `~/.pi/agent/auto-fetch-models.json`:
   ```json
   {
     "providers": {
       "ollama": {
         "baseUrl": "http://localhost:11434/v1",
         "apiKey": "ollama",
         "models": "auto"
       }
     }
   }
   ```

2. Start Ollama: `ollama serve`

3. Run: `pi --list-models`

4. Verify "ollama" provider appears with available models

### Unit Tests

Create `test.ts` for:
- Config loading and validation
- API key resolution (env vars, shell commands)
- Response parsing (OpenAI format, flat array format)
- Default value application

## Documentation

Create `README.md` with:
- Purpose and use cases
- Installation instructions
- Configuration examples
- Supported providers (Ollama, LM Studio, OpenAI-compatible proxies)
- Troubleshooting common issues

## Dependencies

- `@mariozechner/pi-ai`: Model types, Api types
- `@mariozechner/pi-coding-agent`: Extension types, `getAgentDir`
- Built-in: `fs`, `path`, `child_process`

## File Structure

```
packages/coding-agent/examples/extensions/auto-fetch-models/
├── index.ts              # Extension entry (async factory)
├── config.ts             # Config loading, validation, key resolution
├── fetch.ts              # Model fetching from /models endpoint
├── types.ts              # TypeScript interfaces
├── README.md             # User documentation
└── package.json          # Dependencies (if any)
```

## Potential Extensions

1. **Model filtering**: Allow regex pattern to include/exclude models
2. **Model renaming**: Map remote model names to local names
3. **Cost configuration**: Specify pricing per-provider or per-model
4. **Capability inference**: Detect reasoning/image support from model ID patterns
5. **Health checks**: Periodically verify endpoint availability
6. **Refresh command**: `/refresh-models` command to re-fetch without restart