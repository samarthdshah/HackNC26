"use client";
import { Suspense } from "react";
import Currents from "./Currents";

// useSearchParams (?q=) needs a Suspense boundary in Next 14.
export default function Page() {
  return <Suspense fallback={null}><Currents /></Suspense>;
}
