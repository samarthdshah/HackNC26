// Server entry: load raw rows (Tiger or fixtures), build WF, attach the Darwin snapshot.
// A short cache keeps a burst of live refetches from hammering Tiger. Server-only.

import type { WF } from "@wayfinder/shared";
import { buildWF } from "./build";
import { loadDarwinSnapshot } from "./darwin";
import { loadRaw } from "./tiger";

let cache: { at: number; raw: Awaited<ReturnType<typeof loadRaw>> } | undefined;
const TTL = 1000;

export async function getWF(me = "p_leo"): Promise<WF> {
  if (!cache || Date.now() - cache.at > TTL) cache = { at: Date.now(), raw: await loadRaw() };
  const wf = buildWF(cache.raw, { me });
  return { ...wf, ...loadDarwinSnapshot() };
}
