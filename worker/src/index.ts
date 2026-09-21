/**
 * The only place the Anthropic key lives. Checks a seat token, rate-limits
 * and meters per seat, forwards to /v1/messages, and returns Anthropic's
 * response verbatim — the shape src/lib/claude.ts already expects.
 */

export interface Env {
  ZERAPH_KV: KVNamespace;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  RATE_LIMIT_PER_MINUTE: string;
}

interface Seat {
  seatId: string;
  business: string;
}

interface UsageRecord {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface GenerateRequestBody {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
}

interface AnthropicMessage {
  content: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS_CEILING = 4096;
const RATE_LIMIT_TTL_SECONDS = 120;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isGenerateRequestBody(v: unknown): v is GenerateRequestBody {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.system === "string" &&
    Array.isArray(b.messages) &&
    b.messages.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>).role &&
        typeof (m as Record<string, unknown>).content === "string",
    )
  );
}

/**
 * Non-atomic read-modify-write. Fine at "a handful of customers" scale —
 * a Durable Object would be the correct fix once concurrent requests per
 * seat are actually a thing.
 */
async function checkRateLimit(env: Env, seatId: string): Promise<boolean> {
  const limit = Number(env.RATE_LIMIT_PER_MINUTE) || 20;
  const bucket = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const key = `ratelimit:${seatId}:${bucket}`;
  const current = Number((await env.ZERAPH_KV.get(key)) ?? "0");
  if (current >= limit) return false;
  await env.ZERAPH_KV.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS });
  return true;
}

async function logUsage(env: Env, seatId: string, inputTokens: number, outputTokens: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `usage:${seatId}:${day}`;
  const raw = await env.ZERAPH_KV.get(key);
  const current: UsageRecord = raw ? (JSON.parse(raw) as UsageRecord) : { requests: 0, inputTokens: 0, outputTokens: 0 };
  current.requests += 1;
  current.inputTokens += inputTokens;
  current.outputTokens += outputTokens;
  await env.ZERAPH_KV.put(key, JSON.stringify(current));
}

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) return json({ error: "Missing seat token." }, 401);

  const seatRaw = await env.ZERAPH_KV.get(`seat:${token}`);
  if (!seatRaw) return json({ error: "Unknown seat token." }, 401);
  const seat = JSON.parse(seatRaw) as Seat;

  if (!(await checkRateLimit(env, seat.seatId))) {
    return json({ error: "Rate limit exceeded. Try again in a minute." }, 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  if (!isGenerateRequestBody(body)) {
    return json({ error: "Expected { system, messages, max_tokens? }." }, 400);
  }

  const maxTokens = Math.min(Math.max(1, body.max_tokens ?? 1200), MAX_TOKENS_CEILING);

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: body.system,
      messages: body.messages,
    }),
  });

  if (!upstream.ok) {
    console.error(`Anthropic ${upstream.status} for seat ${seat.seatId}`);
    return json({ error: "Draft failed upstream. Try again." }, 502);
  }

  const data = (await upstream.json()) as AnthropicMessage;
  if (data.usage) {
    await logUsage(env, seat.seatId, data.usage.input_tokens, data.usage.output_tokens);
  }

  return json(data);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/v1/generate") {
      return handleGenerate(request, env);
    }

    return json({ error: "Not found." }, 404);
  },
};
