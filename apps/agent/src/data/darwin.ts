// Darwin (Lane C, services/darwin): optional routing hints from *approved* evolved
// rules. Opt-in via DARWIN_URL; any failure or slowness means "no hint".

import { env } from "../env.ts";

export interface RouteHint {
  task_type: string;
  prefer?: string | null;
  redirects: { avoid: string; use: string }[];
  rule_ids: string[];
  reason: string;
}

export async function routeHint(taskType: string, severity?: string): Promise<RouteHint | undefined> {
  if (!env.darwinUrl) return undefined;
  try {
    const url = new URL("/route-hint", env.darwinUrl);
    url.searchParams.set("task_type", taskType);
    if (severity) url.searchParams.set("severity", severity);
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return undefined;
    const hint = (await res.json()) as RouteHint;
    return hint.rule_ids.length ? hint : undefined;
  } catch {
    return undefined;
  }
}
