// Boots Photon Spectrum with whichever surfaces are enabled in SURFACES.
// iMessage needs PHOTON_PROJECT_ID + PHOTON_PROJECT_SECRET; terminal runs locally.

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { env } from "../env.ts";

export { imessage };

export async function startSpectrum() {
  const wantImessage = env.surfaces.includes("imessage");
  const wantTerminal = env.surfaces.includes("terminal");
  const hasPhoton = Boolean(env.photon.projectId && env.photon.projectSecret);

  if (wantImessage && !hasPhoton) {
    console.warn("[spectrum] iMessage skipped: PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET not set");
  }

  const providers = [
    ...(wantImessage && hasPhoton ? [imessage.config()] : []),
    ...(wantTerminal ? [terminal.config()] : []),
  ];
  if (providers.length === 0) {
    throw new Error("No surfaces to start. Set SURFACES and the Photon keys in .env.");
  }

  const app = hasPhoton
    ? await Spectrum({
        projectId: env.photon.projectId,
        projectSecret: env.photon.projectSecret,
        providers,
      })
    : await Spectrum({ providers });

  return { app, imessageEnabled: wantImessage && hasPhoton };
}
