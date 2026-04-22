# Pi Extensions

Extensions for **[Pi](https://github.com/badlogic/pi-mono)** — the AI-powered coding agent harness.

Extensions add new capabilities to Pi by hooking into its lifecycle and APIs. They can register custom tools, add commands, modify the UI, integrate with external services, and more.

## Installation

Extensions are auto-discovered by Pi when placed in:

- **Global:** `~/.pi/agent/extensions/<extension>/`
- **Project-local:** `.pi/extensions/<extension>/`

Or run directly:

```bash
pi -e ./path/to/extension/index.ts
```

## Development

Extensions are written in TypeScript and implement the Pi Extension API:

```typescript
import type { Extension } from "pi";

const extension: Extension = {
  onLoad: async (context) => {
    // Initialize on session start
  },
};

export default extension;
```

See the [Pi Extension docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) for the full API reference.

## License

MIT
