// Solana devnet: the company wallet pays vendors that accept solana_devnet, with
// a memo carrying the request id so the receipt is verifiable on-chain.
// Demo pricing: SOLANA_SOL_PER_USD converts invoice dollars into a small SOL amount.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  address,
  createClient,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  getBase58Encoder,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signer } from "@solana/kit-plugin-signer";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferSolInstruction } from "@solana-program/system";
import { env, required } from "../env.ts";

export const rpc = () => createSolanaRpc(env.solana.rpcUrl);

/** Accepts a solana-keygen JSON byte array or a base58 string. */
function secretKeyBytes(raw: string): Uint8Array {
  if (raw.startsWith("[")) return new Uint8Array(JSON.parse(raw) as number[]);
  return new Uint8Array(getBase58Encoder().encode(raw));
}

let walletSigner: Promise<KeyPairSigner> | undefined;

export function wallet(): Promise<KeyPairSigner> {
  walletSigner ??= createKeyPairSignerFromBytes(secretKeyBytes(required("SOLANA_SECRET_KEY")));
  return walletSigner;
}

/** Wallet balance in SOL. */
export async function balanceSol(): Promise<number> {
  const { address: addr } = await wallet();
  const { value } = await rpc().getBalance(addr).send();
  return Number(value) / 1e9;
}

// Fictional vendors get a stable devnet address each (we only keep the public key).
const walletsFile = fileURLToPath(new URL("../../logs/vendor-wallets.json", import.meta.url));
const vendorWallets: Record<string, string> = existsSync(walletsFile) ? JSON.parse(readFileSync(walletsFile, "utf8")) : {};

export async function vendorAddress(vendorId: string): Promise<Address> {
  vendorWallets[vendorId] ??= (await generateKeyPairSigner()).address;
  writeFileSync(walletsFile, JSON.stringify(vendorWallets, null, 1));
  return address(vendorWallets[vendorId]);
}

export const explorerUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** USD invoice -> lamports at the demo rate, floored above rent-exemption for new accounts. */
export function usdToLamports(usd: number): bigint {
  const sol = Math.max(usd * env.solana.solPerUsd, 0.001);
  return BigInt(Math.round(sol * 1e9));
}

export async function payVendor(vendorId: string, amountUsd: number, memo: string) {
  const payer = await wallet();
  const client = createClient()
    .use(signer(payer))
    // v0, not v1: devnet rejects v1 transfers with MaxLoadedAccountsDataSizeExceeded (checked by simulation).
    .use(solanaRpc({ rpcUrl: env.solana.rpcUrl, transactionConfig: { version: 0 } }));

  const amount = lamports(usdToLamports(amountUsd));
  const destination = await vendorAddress(vendorId);
  const result = await client.sendTransaction([
    getTransferSolInstruction({ source: payer, destination, amount }),
    getAddMemoInstruction({ memo: memo.slice(0, 180) }),
  ]);
  const signature = result.context.signature;
  return { signature, explorer_url: explorerUrl(signature), sol: Number(amount) / 1e9, to: destination };
}
