/**
 * All model calls go through our proxy. The Anthropic key lives on the proxy,
 * never in the app bundle — a desktop binary is readable by anyone who buys it.
 *
 * The proxy checks the seat token, forwards to /v1/messages, and meters tokens.
 */
const API = import.meta.env.VITE_ZERAPH_API as string;

export interface GenerateOptions {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}

export async function generate(opts: GenerateOptions, seatToken: string): Promise<string> {
  const res = await fetch(`${API}/v1/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${seatToken}` },
    body: JSON.stringify({
      system: opts.system,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 1200,
    }),
  });

  if (!res.ok) {
    throw new Error(`Draft failed (${res.status}). Check your connection and try again.`);
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

/** Ask for JSON and get JSON. Strips fences the model sometimes adds anyway. */
export async function generateJSON<T>(opts: GenerateOptions, seatToken: string): Promise<T> {
  const raw = await generate(opts, seatToken);
  const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned) as T;
}
