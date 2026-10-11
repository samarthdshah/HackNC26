// match (Mycelium discovery) lands in Phase 3 with the same shared signature.
// Paying and calling are handled by the treasury and voice agents (src/graph/agents/).

import type { ToolIO } from "@wayfinder/shared";

export const match = async (_: ToolIO["match"]["input"]): Promise<ToolIO["match"]["output"]> => {
  throw new Error("match is not wired up yet (Phase 3)");
};
