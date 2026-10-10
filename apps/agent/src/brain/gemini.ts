// Gemini wrapper: plain text, schema-checked JSON, and a function-calling loop.

import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { env, required } from "../env.ts";

let client: GoogleGenAI | undefined;

export function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: required("GEMINI_API_KEY") });
  return client;
}

/** One-shot text completion. */
export async function ask(prompt: string, systemInstruction?: string): Promise<string> {
  const res = await gemini().models.generateContent({
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
  const res = await gemini().models.generateContent({
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
    const res = await gemini().models.generateContent({
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
  console.warn(`[gemini] tool loop hit ${maxTurns} turns`, JSON.stringify(calls));
  return { text: "I couldn't finish that one, can you rephrase?", calls };
}
