// Server shell: reads the run-level numbers WF has no slot for (requests replayed), then the
// client scene renders wf.darwin / wf.rules from the store.
import { loadDarwinMeta } from "@/lib/wf/darwin";
import Darwin from "./Darwin";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Darwin meta={loadDarwinMeta()} />;
}
