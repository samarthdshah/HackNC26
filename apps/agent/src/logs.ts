// Where the agent keeps its local state (bindings, checkpoints, edges, ledgers).
// WAYFINDER_LOGS_DIR lets the sim run against its own folder without touching live state.

import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)); // apps/agent/
const dir = process.env.WAYFINDER_LOGS_DIR;
export const logsDir = dir ? (isAbsolute(dir) ? dir : resolve(root, dir)) : join(root, "logs");
mkdirSync(logsDir, { recursive: true });

export const logFile = (name: string) => join(logsDir, name);
