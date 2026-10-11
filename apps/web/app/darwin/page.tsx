// Server shell: the snapshot's run-level numbers (requests replayed) and the agent's live view of
// Darwin (GET /darwin). The client scene uses the live view when Darwin is connected, else the
// snapshot in wf.darwin / wf.rules.
import { fetchDarwinView } from "@/lib/wf/agent";
import { loadDarwinMeta } from "@/lib/wf/darwin";
import Darwin from "./Darwin";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <Darwin meta={loadDarwinMeta()} initial={await fetchDarwinView()} />;
}
