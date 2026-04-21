# MCP Disabled Servers Persistence - Implementation Plan

## Overview

Add the ability to disable MCP servers so they:
1. Don't auto-connect on session start
2. Don't expose their tools to the LLM
3. Are remembered across sessions (persisted to disk)

## Current Architecture

### File Structure
```
mcp/
├── index.ts      # Main extension, registers /mcp command, manages servers
├── client.ts     # Connection logic (connectToServer, fetchTools, callTool)
├── config.ts     # Config loading from .pi/mcp.json and ~/.pi/agent/mcp.json
├── tools.ts      # Tool registration and tracking
└── types.ts      # Type definitions
```

### Server States
- `pending` - Config loaded but not yet connected
- `connected` - Successfully connected, tools registered
- `failed` - Connection attempt failed

### Storage Locations
- Project-local config: `.pi/mcp.json`
- Global config: `~/.pi/agent/mcp.json`

## Implementation Plan

### Step 1: Add State File for Disabled Servers

**New file:** `state.ts`

Create a module to manage disabled server state:

```typescript
// State file location: ~/.pi/agent/mcp-state.json
// Format: { "disabledServers": ["server1", "server2", ...] }

export function getStateDir(): string;
export function loadDisabledServers(): Set<string>;
export function saveDisabledServers(servers: Set<string>): void;
```

**Rationale:** Separate from config because:
- Config is user-managed (defines what servers *can* exist)
- State is extension-managed (tracks user preferences)
- State persists across all projects, not per-project

### Step 2: Update Types

**File:** `types.ts`

Already has `DisabledMCPServer` type - verify it's correct:
```typescript
export interface DisabledMCPServer {
  name: string;
  type: "disabled";
  config: McpServerConfig;
}
```

### Step 3: Update Config Loading

**File:** `config.ts`

Add function to get all configured server names:
```typescript
export async function loadConfig(ctx: ExtensionContext): Promise<Record<string, McpServerConfig>>
```

No changes needed - already returns all configured servers.

### Step 4: Update Main Extension Logic

**File:** `index.ts`

#### 4.1 Load State on Startup
```typescript
pi.on("session_start", async (_event, ctx) => {
  const configs = await loadConfig(ctx);
  const disabledServers = loadDisabledServers();
  
  // Track all servers
  for (const [name, config] of Object.entries(configs)) {
    if (disabledServers.has(name)) {
      servers.set(name, { name, type: "disabled", config });
    } else {
      servers.set(name, { name, type: "pending", config });
    }
  }
  
  // Auto-connect only non-disabled servers
  await connectAllServers(ctx, configs, disabledServers);
});
```

#### 4.2 Update `connectAllServers`
- Filter out disabled servers before connecting
- Only show "X/Y servers connected" for attempted connections

#### 4.3 Add Enable/Disable Commands
Update `/mcp` command to support:
- **Connected server actions:** `disconnect`, `reconnect`, **`disable`**
- **Disabled server actions:** **`enable`**
- **Failed server actions:** `connect`, **`disable`** (to prevent auto-retry?)

### Step 5: Implement Enable/Disable Actions

**File:** `index.ts` (in the `/mcp` command handler)

```typescript
// When user disables a connected server:
async function disableServer(name: string): Promise<void> {
  const server = servers.get(name);
  if (server?.type === "connected") {
    await server.cleanup();
  }
  servers.set(name, { name, type: "disabled", config: server.config });
  unregisterServer(name);
  
  // Persist to state file
  const disabled = loadDisabledServers();
  disabled.add(name);
  saveDisabledServers(disabled);
}

// When user enables a disabled server:
async function enableServer(name: string, ctx: ExtensionContext): Promise<void> {
  const server = servers.get(name);
  if (server?.type !== "disabled") return;
  
  // Remove from disabled set
  const disabled = loadDisabledServers();
  disabled.delete(name);
  saveDisabledServers(disabled);
  
  // Trigger connection
  const result = await connectServer(name, server.config);
  // ... handle result
}
```

### Step 6: Update UI

**File:** `index.ts` (in the `/mcp` command UI)

Update `buildStatusItems()` to include disabled servers:
```typescript
function buildStatusItems(): Array<StatusItem> {
  return Array.from(servers.entries()).map(([name, server]) => ({
    name,
    status: server.type, // "connected" | "failed" | "pending" | "disabled"
    error: server.type === "failed" ? server.error : undefined,
    toolCount: server.type === "connected" 
      ? getRegisteredTools().filter(t => t.serverName === name).length 
      : 0,
  }));
}
```

UI display:
```
MCP Server Status

Config: .pi/mcp.json or ~/.pi/agent/mcp.json
Servers: 4

  filesystem      connected (5 tools)    [disconnect, disable, reconnect]
  github          failed: API error      [connect, disable]
  puppeteer       disabled               [enable]
  slack           disabled               [enable]
```

### Step 7: Handle Config Changes

If user modifies config file while disabled servers exist:
- If a disabled server is removed from config, also remove from disabled state
- If new servers are added, they start enabled (not disabled)

```typescript
// In session_start, after loading config:
const config = await loadConfig(ctx);
const disabled = loadDisabledServers();

// Clean up disabled servers that no longer exist in config
for (const name of disabled) {
  if (!config[name]) {
    disabled.delete(name);
  }
}
saveDisabledServers(disabled);
```

## Files Changed

| File | Changes |
|------|---------|
| `types.ts` | Already has `DisabledMCPServer` type ✓ |
| `state.ts` | **NEW** - State file management |
| `config.ts` | No changes needed |
| `client.ts` | No changes needed |
| `tools.ts` | No changes needed |
| `index.ts` | Main changes: state loading, enable/disable logic, UI updates |
| `README.md` | Document enable/disable feature |

## Detailed File: state.ts

```typescript
/**
 * MCP Extension State Management
 * 
 * Persists user preferences (disabled servers) across sessions.
 * State file: ~/.pi/agent/mcp-state.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Get the global agent directory path.
 */
export function getStateDir(): string {
  const agentDir = process.env.PI_AGENT_DIR;
  if (agentDir) return agentDir;
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) throw new Error("Could not determine home directory");
  return join(homeDir, ".pi", "agent");
}

/**
 * State file format.
 */
interface McpState {
  disabledServers: string[];
}

/**
 * Load the set of disabled server names.
 */
export function loadDisabledServers(): Set<string> {
  const statePath = join(getStateDir(), "mcp-state.json");
  
  if (!existsSync(statePath)) {
    return new Set();
  }
  
  try {
    const content = readFileSync(statePath, "utf-8");
    const state = JSON.parse(content) as McpState;
    return new Set(state.disabledServers ?? []);
  } catch {
    console.warn("[mcp] Failed to load state file, starting fresh");
    return new Set();
  }
}

/**
 * Save the set of disabled server names.
 */
export function saveDisabledServers(servers: Set<string>): void {
  const stateDir = getStateDir();
  const statePath = join(stateDir, "mcp-state.json");
  
  // Ensure directory exists
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  
  const state: McpState = {
    disabledServers: Array.from(servers),
  };
  
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    console.error("[mcp] Failed to save state file:", error);
  }
}

/**
 * Add a server to the disabled list.
 */
export function disableServer(name: string): void {
  const disabled = loadDisabledServers();
  disabled.add(name);
  saveDisabledServers(disabled);
}

/**
 * Remove a server from the disabled list.
 */
export function enableServer(name: string): void {
  const disabled = loadDisabledServers();
  disabled.delete(name);
  saveDisabledServers(disabled);
}
```

## Testing Plan

1. **Test disable connected server:**
   - Start with connected server
   - Run `/mcp`, select server, choose "disable"
   - Verify server shows as disabled
   - Verify tools are unregistered
   - Restart pi, verify server still disabled

2. **Test enable disabled server:**
   - Run `/mcp`, select disabled server, choose "enable"
   - Verify server connects and tools appear
   - Restart pi, verify server auto-connects

3. **Test config cleanup:**
   - Disable a server
   - Remove it from mcp.json config
   - Restart, verify it's removed from disabled state

4. **Test multiple sessions:**
   - Disable server in one project
   - Open another project (same global config)
   - Verify server still disabled

## Questions/Considerations

1. **Should disabling a failed server be allowed?**
   - Yes - user might want to stop retry attempts
   - Alternative: only allow disabling connected servers
   - **Decision:** Allow disabling any server

2. **Should disconnection be separate from disabling?**
   - "disconnect" = temporary, forget until restart
   - "disable" = permanent, remembered across sessions
   - **Decision:** Keep both distinct actions

3. **State file location:**
   - Global only (`~/.pi/agent/mcp-state.json`)
   - Per-project disabled state would complicate things
   - Config can be per-project, but disabled preference is global
   - **Decision:** Global state file only

4. **What if project-local config has a server not in global config?**
   - State file is global, so disabling affects all projects
   - User might want per-project enable/disable
   - **Future consideration:** Could add project-level state later
   - **Decision:** Start with global state for simplicity

## Implementation Order

1. Create `state.ts` with state file management
2. Update `index.ts` to load disabled state on startup
3. Update `connectAllServers` to skip disabled servers
4. Add `disableServer` and `enableServer` functions
5. Update `buildStatusItems` to show disabled servers
6. Update UI action handlers for enable/disable
7. Add config cleanup logic (remove non-existent servers from disabled)
8. Update README.md with new features