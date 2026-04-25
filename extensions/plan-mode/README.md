# Plan Mode Extension

Read-only exploration mode for safe code analysis, followed by tracked execution.

## Architecture

The extension is split into focused modules:

| File | Responsibility |
|------|---------------|
| `constants.ts` | Tool lists, command names, prompt fragments, regex patterns |
| `types.ts` | Shared TypeScript interfaces and message helpers |
| `safety.ts` | Bash allowlist/blocklist for read-only mode |
| `parser.ts` | Extract numbered plan steps from assistant messages |
| `state.ts` | PlanState CRUD, persistence (`appendEntry`), scoped resume reconstruction |
| `ui.ts` | ASCII-only progress bars, widgets, footer status, notifications |
| `execution.ts` | Step lifecycle, heuristic completion, file-change tracking, rollback reports |
| `index.ts` | Event handlers, commands, shortcuts, custom tool registration |

## Features

- **Read-only planning**: Only `read`, `bash`, `grep`, `find`, `ls`, `questionnaire` available. Bash restricted to an allowlist.
- **Structured completion**: The agent calls `plan_step_complete(step_number, status)` instead of emitting `[DONE:n]` tags.
- **Heuristic fallback**: If the agent forgets the tool, prose mentions like "step 2 is complete" are detected.
- **Progress tracking**: ASCII widget shows `[x]`, `[ ]`, `[>]`, `[!]`, `[-]` states with a progress bar.
- **Session resilience**: Each plan has a UUID. Resume scans only entries after the matching execution marker.
- **Collaborative refinement**: Add, insert, skip, retry, or manually mark steps during execution via commands.
- **Error handling & rollback**: Tracks which files each step modified. `/plan-rollback` shows `git checkout` suggestions.

## Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode, or show menu if active |
| `/plan-status` | Display current plan with step states |
| `/plan-skip <n>` | Skip step number n |
| `/plan-done <n>` | Manually mark step n complete |
| `/plan-retry <n>` | Retry a failed step |
| `/plan-add <text>` | Append a new step at the end |
| `/plan-insert <after> <text>` | Insert a step after step number |
| `/plan-reset` | Reset plan back to planning mode |
| `/plan-rollback` | Show modified files and suggested git commands |

## Shortcuts

- `Ctrl+Alt+P` — Toggle plan mode

## Flags

- `--plan` — Start session in plan mode

## How It Works

### Planning Phase
1. Enable plan mode with `/plan` or `--plan`.
2. The system prompt is appended with plan-mode instructions (no message pollution).
3. The agent analyzes code read-only and outputs a numbered `Plan:` section.
4. The extension parses the plan into structured steps.

### Execution Phase
1. Choose "Execute plan" from the menu or run `/plan` again.
2. Full tool access is restored, plus the `plan_step_complete` tool.
3. The system prompt shows the current step, next step, and remaining list.
4. After each step, the agent calls `plan_step_complete(step_number, "complete")`.
5. If the step fails, the agent calls `plan_step_complete(step_number, "failed", reason)`.

### Progress Tracking
- The footer shows `[EXEC 2/5] step 3`.
- The widget above the editor shows an ASCII progress bar and checkbox list.
- When all steps are done, the plan auto-completes and full access is restored.

### Session Resume
- Plan state is persisted via `appendEntry` after every mutation.
- On resume, the latest state is restored.
- If resuming in execution mode, entries are scanned from the matching execution marker forward.
- `plan_step_complete` tool results and heuristic text patterns rebuild completion state.

### Rollback
- Every `write` and `edit` during execution is tracked per-step.
- `/plan-rollback` prints a report of all modified files with suggested git commands.
