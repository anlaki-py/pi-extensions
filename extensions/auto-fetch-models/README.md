# Auto-Fetch Models Extension

Automatically discover and register models from OpenAI-compatible providers that expose a `/models` endpoint.

## Use Case

Local LLM servers like **Ollama** and **LM Studio** frequently add, remove, and update models. Instead of manually editing `models.json` every time your local models change, this extension fetches the available models from the server at startup.

## Installation

The extension is auto-discovered when placed in the extensions directory:

- **Global**: `~/.pi/agent/extensions/auto-fetch-models/index.ts`
- **Project-local**: `.pi/extensions/auto-fetch-models/index.ts`

Or run directly:

```bash
pi -e ./path/to/auto-fetch-models/index.ts
```

## Configuration

Create a config file at one of these locations (project-local takes precedence):

- `.pi/auto-fetch-models.json`
- `~/.pi/agent/auto-fetch-models.json`

### Example Configuration

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "models": "auto"
    },
    "lm-studio": {
      "baseUrl": "http://localhost:1234/v1",
      "apiKey": "lm-studio",
      "models": "auto"
    },
    "my-proxy": {
      "baseUrl": "https://proxy.example.com/v1",
      "apiKey": "!cat ~/.api_key",
      "api": "openai-completions",
      "models": "auto"
    }
  }
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `baseUrl` | API endpoint URL (without `/models` suffix) |
| `apiKey` | API key, env var name, or shell command (see below) |
| `models` | Must be `"auto"` to trigger auto-fetch |

### Optional Fields

| Field | Default | Description |
|-------|---------|-------------|
| `api` | `"openai-completions"` | API type |
| `headers` | `{}` | Custom headers for requests |
| `authHeader` | `false` | Add `Authorization: Bearer` header |

### API Key Resolution

The `apiKey` field supports multiple formats:

| Format | Example | Behavior |
|--------|---------|----------|
| Environment variable | `"OLLAMA_API_KEY"` | Resolved from `process.env` |
| Shell command | `"!cat ~/.api_key"` | Executed, stdout used |
| Literal value | `"sk-1234"` | Used directly |

## Supported Providers

Any OpenAI-compatible server with a `/models` endpoint:

- **Ollama** - `http://localhost:11434/v1`
- **LM Studio** - `http://localhost:1234/v1`
- **vLLM** - `http://localhost:8000/v1`
- **LocalAI** - `http://localhost:8080/v1`
- **OpenAI-compatible proxies** - Any server implementing the `/models` endpoint

## Response Format

The extension expects an OpenAI-compatible response:

```json
{
  "object": "list",
  "data": [
    { "id": "llama3.2" },
    { "id": "mistral", "name": "Mistral 7B" }
  ]
}
```

Or a flat array:

```json
[
  { "id": "llama3.2" },
  { "id": "mistral" }
]
```

## Default Values

Fetched models use these defaults:

| Field | Default |
|-------|---------|
| `name` | Same as `id` |
| `api` | `"openai-completions"` |
| `reasoning` | `false` |
| `input` | `["text"]` |
| `cost` | `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }` |
| `contextWindow` | `128000` |
| `maxTokens` | `16384` |

## Troubleshooting

### No models appear

1. Check the provider is running: `curl http://localhost:11434/v1/models`
2. Verify config file location: must be in `.pi/` or `~/.pi/agent/`
3. Check API key resolution: env vars must be set, shell commands must succeed

### Provider fails to register

The extension logs warnings when:
- API key cannot be resolved
- `/models` endpoint returns non-200 status
- Response cannot be parsed
- No models are returned

Check the console output for `[auto-fetch-models]` prefixed messages.

### Startup is slow

The extension fetches from all providers in parallel. Slow startup usually indicates:
- Provider server is not running (timeout)
- Network issues
- Slow provider response

## Examples

### Ollama

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

### LM Studio

```json
{
  "providers": {
    "lm-studio": {
      "baseUrl": "http://localhost:1234/v1",
      "apiKey": "lm-studio",
      "models": "auto"
    }
  }
}
```

### Custom Proxy with Auth

```json
{
  "providers": {
    "my-proxy": {
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "!op read op://vault/api-key",
      "headers": {
        "X-Custom-Header": "value"
      },
      "models": "auto"
    }
  }
}
```

## Combining with Manual Models

You can still use `models.json` for providers that don't support `/models`:

```json
// models.json - manual definitions
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "ANTHROPIC_API_KEY"
    }
  }
}

// auto-fetch-models.json - dynamic discovery
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

Both configurations are loaded at startup.