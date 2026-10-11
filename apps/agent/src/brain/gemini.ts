// Gemini wrapper: plain text, schema-checked JSON, and a function-calling loop.

import { FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { env, required } from "../env.ts";

let client: { key: string; ai: GoogleGenAI } | undefined;

export function gemini(): GoogleGenAI {
  const key = required("GEMINI_API_KEY");
  if (client?.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) };
  return client.ai;
}

/** Gemini can't be used right now (no credits, bad key, or still failing after retries). */
export class AiUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`AI unavailable: ${reason}`);
  }
}

export const isAiUnavailable = (err: unknown): err is AiUnavailableError => err instanceof AiUnavailableError;

const TRANSIENT = new Set([429, 500, 502, 503, 504]);

/** generateContent with retries on transient errors; hard failures become AiUnavailableError. */
async function generate(params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]): Promise<GenerateContentResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gemini().models.generateContent(params);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const text = err instanceof Error ? err.message : String(err);
      const credits = /credits are depleted|billing/i.test(text);
      if (status && TRANSIENT.has(status) && !credits && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * 3 ** attempt));
        continue;
      }
      if (credits) throw new AiUnavailableError("Gemini prepayment credits are depleted");
      if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(text)) {
        throw new AiUnavailableError("Gemini rejected the API key");
      }
      if (status && TRANSIENT.has(status)) throw new AiUnavailableError(`Gemini is overloaded (${status})`);
      if (!status && /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(text)) throw new AiUnavailableError("can't reach Gemini");
      throw err;
    }
  }
}

/** One-shot text completion. */
export async function ask(prompt: string, systemInstruction?: string): Promise<string> {
  const res = await generate({
    model: env.gemini.model,
    contents: prompt,
    config: { systemInstruction, temperature: 0.2 },
  });
  return res.text?.trim() ?? "";
}

/** Completion constrained to a zod schema; the result is parsed and validated. */
export async function askJson<S extends z.ZodType>(
  prompt: string,
  schema: S,
  systemInstruction?: string,
): Promise<z.infer<S>> {
  const res = await generate({
    model: env.gemini.model,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(schema),
    },
  });
  return schema.parse(JSON.parse(res.text ?? "{}"));
}

export interface LoopTool {
  name: string;
  description: string;
  parameters: z.ZodObject;
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** Gemini function-calling loop: call tools until the model answers in text. */
export async function toolLoop(
  prompt: string,
  tools: LoopTool[],
  systemInstruction: string,
  maxTurns = 6,
): Promise<{ text: string; calls: { name: string; args: unknown }[] }> {
  const declarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: z.toJSONSchema(t.parameters),
  }));
  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  const calls: { name: string; args: unknown }[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await generate({
      model: env.gemini.model,
      contents,
      config: { systemInstruction, temperature: 0.2, tools: [{ functionDeclarations: declarations }] },
    });
    const fnCalls = res.functionCalls ?? [];
    if (fnCalls.length === 0) return { text: res.text?.trim() ?? "", calls };

    contents.push(res.candidates?.[0]?.content ?? { role: "model", parts: fnCalls.map((fc) => ({ functionCall: fc })) });
    const parts = await Promise.all(
      fnCalls.map(async (fc) => {
        const tool = tools.find((t) => t.name === fc.name);
        calls.push({ name: fc.name ?? "?", args: fc.args });
        let output: unknown;
        try {
          output = tool ? await tool.run(tool.parameters.parse(fc.args ?? {})) : { error: `unknown tool ${fc.name}` };
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
          console.warn(`[tool] ${fc.name} failed: ${(output as { error: string }).error}`);
        }
        return { functionResponse: { id: fc.id, name: fc.name, response: { output } } };
      }),
    );
    contents.push({ role: "user", parts });
  }
  // Out of turns: answer from what the tools already returned rather than giving up.
  console.warn(`[gemini] tool loop hit ${maxTurns} turns, answering from results so far`, JSON.stringify(calls));
  const final = await generate({
    model: env.gemini.model,
    contents: [...contents, { role: "user", parts: [{ text: "Answer now using what you found. No more tool calls." }] }],
    config: {
      systemInstruction,
      temperature: 0.2,
      tools: [{ functionDeclarations: declarations }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
    },
  });
  return { text: final.text?.trim() || "I couldn't finish that one, can you rephrase?", calls };
}
