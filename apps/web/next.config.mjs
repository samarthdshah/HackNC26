import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One .env at the repo root serves every lane; Next only reads its own folder by default.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: false, // page scenes own WebGL contexts; a double mount would create two
  transpilePackages: ["@wayfinder/shared"],
  env: {
    NEXT_PUBLIC_AGENT_URL: process.env.NEXT_PUBLIC_AGENT_URL ?? `http://localhost:${process.env.AGENT_PORT || 8787}`,
  },
  experimental: { serverComponentsExternalPackages: ["pg"] },
};
