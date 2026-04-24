import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

/**
 * CONFIGURATION: Add new spinners here!
 */
const SPINNER_CONFIGS = {
  half: {
    frames: ["◐", "◓", "◑", "◒"],
    intervalMs: 150,
    description: "half spinner",
  },
  arrow: {
    frames: ['←','↖','↑','↗','→','↘','↓','↙'],
    intervalMs: 120,
    description: "arrow spinner",      
  },
  slash: {
    frames: ["/", "-", "\\", "|"],
    intervalMs: 120,
    description: "slash spinner",
  },
  dot: {
    frames: ["●"],
    intervalMs: 0,
    description: "static dot",
  },
  pulse: {
    frames: ["·", "•", "●", "•"],
    intervalMs: 120,
    description: "custom pulse",
  },
  spinner: {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    intervalMs: 80,
    description: "custom spinner",
  },
  none: {
    frames: [],
    intervalMs: 0,
    description: "hidden",
  },
} as const;

type SpinnerKey = keyof typeof SPINNER_CONFIGS;

const PASTEL_RAINBOW = [
  "\x1b[38;2;255;179;186m",
  "\x1b[38;2;255;223;186m",
  "\x1b[38;2;255;255;186m",
  "\x1b[38;2;186;255;201m",
  "\x1b[38;2;186;225;255m",
  "\x1b[38;2;218;186;255m",
];
const RESET_FG = "\x1b[39m";

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET_FG}`;
}

/**
 * Transforms our config into the format Pi expects, applying rainbow colors.
 */
function getIndicatorOptions(mode: SpinnerKey | "default"): WorkingIndicatorOptions | undefined {
  if (mode === "default") return undefined;

  const config = SPINNER_CONFIGS[mode];
  return {
    frames: config.frames.map((frame, index) =>
      colorize(frame, PASTEL_RAINBOW[index % PASTEL_RAINBOW.length]!),
    ),
    intervalMs: config.intervalMs > 0 ? config.intervalMs : undefined,
  };
}

const CONFIG_PATH = join(getAgentDir(), "working-indicator.json");

function loadConfig(): SpinnerKey | "default" {
  if (!existsSync(CONFIG_PATH)) return "spinner";
  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(content) as { mode?: string };
    const mode = parsed.mode;
    if (mode === "default" || (mode && mode in SPINNER_CONFIGS)) {
      return mode as SpinnerKey | "default";
    }
  } catch {
    // ignore bad config
  }
  return "spinner";
}

function saveConfig(mode: SpinnerKey | "default") {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify({ mode }, null, 2) + "\n", "utf-8");
  } catch {
    // silently fail if we can't write
  }
}

export default function (pi: ExtensionAPI) {
  let currentMode: SpinnerKey | "default" = loadConfig();

  const applyIndicator = (ctx: ExtensionContext) => {
    const options = getIndicatorOptions(currentMode);
    const desc = currentMode === "default" ? "pi default" : SPINNER_CONFIGS[currentMode].description;
    
    ctx.ui.setWorkingIndicator(options);
    ctx.ui.setStatus("working-indicator", ctx.ui.theme.fg("dim", `Indicator: ${desc}`));
  };

  pi.on("session_start", async (_event, ctx) => {
    applyIndicator(ctx);
  });

  pi.registerCommand("working-indicator", {
    description: "Set the streaming working indicator.",
    handler: async (args, ctx) => {
      const input = args.trim().toLowerCase();
      const validKeys = Object.keys(SPINNER_CONFIGS);

      if (!input) {
        const desc = currentMode === "default" ? "pi default" : SPINNER_CONFIGS[currentMode].description;
        ctx.ui.notify(`Current indicator: ${desc}`, "info");
        return;
      }

      if (input === "reset" || input === "default") {
        currentMode = "default";
      } else if (input in SPINNER_CONFIGS) {
        currentMode = input as SpinnerKey;
      } else {
        ctx.ui.notify(`Usage: /working-indicator [${validKeys.join("|")}|reset]`, "error");
        return;
      }

      saveConfig(currentMode);
      applyIndicator(ctx);
      const newDesc = currentMode === "default" ? "pi default" : SPINNER_CONFIGS[currentMode].description;
      ctx.ui.notify(`Working indicator set to: ${newDesc}`, "info");
    },
  });
}