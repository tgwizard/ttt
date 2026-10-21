// One model call, in whichever API format the provider speaks. The agent loop stays provider-neutral:
// it hands over a Conversation and gets back a ModelTurn with normalized text, tool calls and usage.

import type Anthropic from "@anthropic-ai/sdk";
import { modelsUrl, provider as getProvider, type Provider, type ProviderId } from "./providers.ts";

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> | string };
export type ToolResultMsg = { id: string; content: string; isError: boolean };

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

export type Conversation = {
  system: string;
  /** `stable` only grows at its end (cache-friendly); `rest` changes every call. */
  user: { stable: string; rest: string };
  /** Earlier steps of this invocation: the provider-native assistant message, then our tool results. */
  steps: { replay: unknown; results: ToolResultMsg[] }[];
};

export type ModelTurn = {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason?: string;
  request: unknown;
  response: unknown;
  /** The assistant message to send back on the next step, as the provider expects it. */
  replay: unknown;
};

export class ModelError extends Error {
  request: unknown;
  response: unknown;
  constructor(message: string, request: unknown, response: unknown) {
    super(message);
    this.request = request;
    this.response = response;
  }
}

export type CallOptions = {
  providerId: ProviderId;
  model: string;
  effort: string;
  apiKey: string;
  convo: Conversation;
  tools: ToolSpec[];
  /** Groups requests that share a prefix onto the same backend, where supported. */
  promptCacheKey: string;
  signal?: AbortSignal;
};

export function callModel(opts: CallOptions): Promise<ModelTurn> {
  const p = getProvider(opts.providerId);
  return p.kindFor(opts.model) === "anthropic" ? callAnthropic(p, opts) : callChatCompletions(p, opts);
}

// --- OpenAI-compatible chat completions ---

type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatResponse = {
  error?: { message?: string } | string;
  choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: ChatToolCall[] } }[];
  usage?: Usage;
};

async function callChatCompletions(p: Provider, o: CallOptions): Promise<ModelTurn> {
  const messages: unknown[] = [
    { role: "system", content: o.convo.system },
    { role: "user", content: o.convo.user.stable + o.convo.user.rest },
  ];
  for (const step of o.convo.steps) {
    messages.push(step.replay);
    for (const r of step.results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
  const body: Record<string, unknown> = {
    model: o.model,
    messages,
    tools: o.tools.map((t) => ({ type: "function", function: t })),
    tool_choice: "auto",
  };
  if (o.effort) {
    if (p.effortParam === "reasoning") body.reasoning = { effort: o.effort };
    else body.reasoning_effort = o.effort;
  }
  if (p.promptCacheKey) body.prompt_cache_key = o.promptCacheKey;

  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  const json = (await res.json().catch(() => null)) as ChatResponse | null;
  const request = structuredClone(body);
  if (!res.ok || !json?.choices) {
    const err = json?.error;
    throw new ModelError((typeof err === "string" ? err : err?.message) ?? `HTTP ${res.status}`, request, json);
  }
  const choice = json.choices[0];
  const message = choice?.message ?? {};
  const raw = message.tool_calls ?? [];
  return {
    content: message.content || null,
    toolCalls: raw.map((c) => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) })),
    usage: json.usage,
    finishReason: choice?.finish_reason,
    request,
    response: json,
    replay: { role: "assistant", content: message.content ?? null, tool_calls: raw.length ? raw : undefined },
  };
}

function parseArgs(s: string): Record<string, unknown> | string {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : s;
  } catch {
    return s;
  }
}

// --- Anthropic Messages API ---

// Models that take server-side refusal fallbacks (Claude API only).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

// Loaded on first use: most sessions never talk to an Anthropic-format endpoint.
async function anthropicClient(p: Provider, apiKey: string) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const base = p.anthropicBaseUrl ?? p.baseUrl;
  const client = new Anthropic({
    apiKey,
    baseURL: new URL(base, (globalThis as { location?: { origin: string } }).location?.origin ?? "http://localhost").toString().replace(/\/$/, ""),
    // The key is the user's own and only ever lives in their browser.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
  return { client, APIError: Anthropic.APIError };
}

async function callAnthropic(p: Provider, o: CallOptions): Promise<ModelTurn> {
  const { client, APIError } = await anthropicClient(p, o.apiKey);
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [];
  // Cache breakpoints: system (covers tools too) and the append-only transcript.
  if (o.convo.user.stable) userContent.push({ type: "text", text: o.convo.user.stable, cache_control: { type: "ephemeral" } });
  userContent.push({ type: "text", text: o.convo.user.rest });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userContent }];
  for (const step of o.convo.steps) {
    messages.push(step.replay as Anthropic.Beta.BetaMessageParam);
    messages.push({
      role: "user",
      content: step.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError })),
    });
  }
  const fallback = p.id === "anthropic" && FALLBACK_MODELS.has(o.model);
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model: o.model,
    max_tokens: 16000,
    system: [{ type: "text", text: o.convo.system, cache_control: { type: "ephemeral" } }],
    tools: o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })),
    tool_choice: { type: "auto" },
    messages,
    ...(o.effort ? { output_config: { effort: o.effort as "low" } } : {}),
    ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
  const request = structuredClone(params);

  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create(params, { signal: o.signal });
  } catch (e) {
    if (e instanceof APIError) throw new ModelError(e.message, request, e.error ?? null);
    throw e;
  }
  if (msg.stop_reason === "refusal") {
    throw new ModelError(`Refused${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}`, request, msg);
  }

  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  const toolCalls: ToolCall[] = msg.content.flatMap((b) =>
    b.type === "tool_use" ? [{ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }] : [],
  );
  const u = msg.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return {
    content: text || null,
    toolCalls,
    usage: {
      prompt_tokens: u.input_tokens + cacheRead + (u.cache_creation_input_tokens ?? 0),
      completion_tokens: u.output_tokens,
      prompt_tokens_details: { cached_tokens: cacheRead },
    },
    finishReason: msg.stop_reason ?? undefined,
    request,
    response: msg,
    // Pass every block back unchanged (thinking, fallback markers…), as the API expects.
    replay: { role: "assistant", content: msg.content },
  };
}

// --- Model lists ---

export async function listModels(id: ProviderId, apiKey: string): Promise<string[]> {
  const p = getProvider(id);
  if (p.id === "anthropic") {
    const { client } = await anthropicClient(p, apiKey);
    const page = await client.models.list({ limit: 100 });
    return page.data.map((m) => m.id);
  }
  const res = await fetch(modelsUrl(p), apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}
