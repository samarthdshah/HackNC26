"use client";
// Every page calls this once: marks the active page, wires the title card and tour.

import { useEffect } from "react";
import { enterPage, type PageId } from "./runtime";

export function useAeroPage(page: PageId, opts: { tourDelay?: number } = {}) {
  useEffect(() => enterPage(page, opts), [page, opts.tourDelay]);
}
