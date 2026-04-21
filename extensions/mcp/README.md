# MCP Extension for pi

This extension provides [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server integration for pi. It connects to MCP servers and exposes their tools as pi tools.

## Installation

Copy this directory to `~/.pi/agent/extensions/mcp/` or your project's `.pi/extensions/mcp/`.

## Configuration

Create `mcp.json` in one of these locations:
- `.pi/mcp.json` (project-local, takes precedence)
- `~/.pi/agent/mcp.json` (global)

### Example Configuration

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "."]
    },
    "github": {
      "type": "http",
      "url": "https://mcp.github.com/v1",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Transport Types

### stdio (Local Process)

For local MCP servers that run as subprocesses:

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "/path/to/files"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      }
    }
  }
}
```

### HTTP (Streamable HTTP)

For remote servers supporting MCP Streamable HTTP:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

### SSE (Server-Sent Events)

For legacy HTTP servers using SSE:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "sse",
      "url": "https://example.com/sse"
    }
  }
}
```

## Environment Variables

Use `${VAR_NAME}` syntax to expand environment variables:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Tool Naming

MCP tools are namespaced as `mcp__<server>__<tool>`.

For example, a server named `github` with tool `create_issue` becomes:
```
mcp__github__create_issue
```

## Commands

- `/mcp` - Show server status and manage connections
- `/mcp help` - Show help for MCP commands and features
- `/mcp <server>` - Reconnect to a specific server

### Via `/mcp` Status UI

Run `/mcp` to open the interactive server list:

- **Enter** - Toggle connected/disconnected
- **Space** - Toggle enabled/disabled
- **↑/↓** or **j/k** - Navigate
- **Esc** - Close

### Via Command Line

## Enabling/Disabling Servers

Servers can be disabled to prevent them from auto-connecting on startup:

- **Disable**: Disconnects the server and prevents auto-connect on future sessions
- **Enable**: Re-enables auto-connect and connects immediately

Disabled servers are persisted in `~/.pi/agent/mcp-state.json`.

### Via `/mcp` Command

Run `/mcp help` for full usage details.

## Example MCP Servers

### Filesystem (stdio)

```json
{
  "mcpServers": {
    "fs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "."]
    }
  }
}
```

### GitHub (HTTP)

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://mcp.github.com/v1",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Puppeteer (stdio)

```json
{
  "mcpServers": {
    "browser": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-puppeteer"]
    }
  }
}
```

## How It Works

1. On session start, the extension loads configuration from `mcp.json`
2. It loads disabled server state from `~/.pi/agent/mcp-state.json`
3. It connects to all non-disabled configured MCP servers
4. Tools from each server are discovered and registered as pi tools
5. When you call an MCP tool, the request is forwarded to the MCP server
6. Results are converted and returned to pi

## Troubleshooting

### Server Not Connecting

Check console output for error messages. Common issues:
- Server not installed (`npx` package missing)
- Environment variables not set
- Network connectivity issues

### Tool Not Found

Ensure:
1. Server is connected (check `/mcp` command output)
2. Tool name is namespaced correctly (`mcp__server__tool`)

## Implementation Status

This extension implements Phase 1 of MCP support:

- [x] stdio transport
- [x] HTTP transport (Streamable HTTP)
- [x] SSE transport
- [x] Tool discovery and registration
- [x] Tool execution proxying
- [x] Enable/disable servers (persisted across sessions)
- [ ] WebSocket transport
- [ ] Server instructions in system prompt
- [ ] Resource support
- [ ] Prompt support
- [ ] Sampling (server → LLM)
- [ ] Elicitation (server → user)