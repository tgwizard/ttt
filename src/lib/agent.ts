// The agent: given the user's speech and the current document, call the model and apply its tool calls.
// Each invocation is stateless: the prompt carries recent speech (with what happened to it) and the full document.

import { applyTool, TOOL_DEFINITIONS } from "./tools.ts";

export const API_BASE = "https://api.meta.ai/v1";
export const MAX_STEPS = 6;
// Routes our requests to backends that already hold the system prompt + tools prefix.
const PROMPT_CACHE_KEY = "ttt-agent";

export type UtteranceStatus = "new" | "pending" | "handled";
export type Utterance = { id: number; text: string; at: number; status: UtteranceStatus };

export type Settings = { model: string; reasoningEffort: string };

export type ToolCallLog = { id: string; name: string; args: Record<string, unknown> | string; ok: boolean; result: string };
export type StepLog = {
  latencyMs: number;
  content: string | null;
  toolCalls: ToolCallLog[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  finishReason?: string;
  request: unknown;
  response: unknown;
};
export type Invocation = {
  id: number;
  startedAt: number;
  endedAt?: number;
  model: string;
  reasoningEffort: string;
  speech: string[]; // the new/pending speech this invocation acts on
  steps: StepLog[];
  status: "running" | "done" | "error";
  edited: boolean;
  error?: string;
};

export const SYSTEM_PROMPT = `You are the hands of "Talk to type", a voice-driven writing app. The user speaks out loud; their speech is transcribed live and sent to you whenever they pause. You edit a single markdown document for them using tools.

Reading the speech:
- Speech is a mix of instructions ("make the title shorter", "add a bullet about X", "delete the last paragraph") and dictation (the words they want written). Tell them apart from context. When dictating, write what they meant, cleaned up: punctuation, capitalization, no filler words (um, uh, like, you know), no false starts, and apply self-corrections ("on Monday, no wait, Tuesday" → "on Tuesday").
- Transcription is imperfect. Interpret misheard words and homophones sensibly given the document.
- Speech arrives at every pause, so the user may be mid-thought: a chunk can stop in the middle of a sentence or instruction ("and then add a section about"). If the speech is clearly incomplete or too ambiguous to act on, do NOT edit. Reply with a few words on what you're waiting for; it will come back to you together with what they say next.
- If the intent is clear, act right away. Prefer acting over waiting: the user watches the document update live and can correct you.
- Talk not meant for the document (talking to someone else, "hmm, let me think", "okay") → do nothing.
- Earlier speech is shown for context. "handled" items were already applied: never apply them again. "pending" items were not acted on yet: treat them together with the new speech as one message.

Editing:
- The current document is given in full and is the source of truth; the user may also edit it by hand.
- Use the smallest edit that does the job: append for adding at the end, replace for local changes (copy \`old\` exactly from the document), set for a first draft or a large rewrite.
- You may call several tools. If a tool returns an error, fix the call and retry.
- Write clean markdown: headings, lists, short paragraphs. No HTML. Don't add content they didn't ask for, and no meta text like "Here is your document".
- Write in the language the user speaks, unless asked otherwise.

Along with your tool calls, say in one short sentence what you're doing (it goes to a log, not the document). If every call succeeds that is the end of your turn, so make all the edits you need in one go.`;

const HISTORY_LIMIT = 12;

// Document first: it changes less often than the speech, so it extends the cached prefix
// (unchanged after a "wait", and an append-only doc keeps its beginning).
export function buildUserMessage(utterances: Utterance[], doc: string): string {
  const recent = utterances.slice(-HISTORY_LIMIT);
  const earlier = recent.filter((u) => u.status === "handled");
  const active = recent.filter((u) => u.status !== "handled");
  const lines: string[] = [doc.trim() ? `<document>\n${doc}\n</document>` : "<document>\n(empty)\n</document>", ""];
  if (earlier.length) {
    lines.push("<earlier_speech>");
    for (const u of earlier) lines.push(`[handled] ${u.text}`);
    lines.push("</earlier_speech>", "");
  }
  lines.push("<new_speech>");
  for (const u of active) lines.push(u.status === "pending" ? `[pending] ${u.text}` : u.text);
  lines.push("</new_speech>");
  return lines.join("\n");
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type RawToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export async function runAgent(opts: {
  apiKey: string;
  settings: Settings;
  utterances: Utterance[];
  getDoc: () => string;
  setDoc: (doc: string) => void;
  invocation: Invocation;
  onUpdate: () => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { apiKey, settings, getDoc, setDoc, invocation, onUpdate, signal } = opts;
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(opts.utterances, getDoc()) },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const body = {
      model: settings.model,
      ...(settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      prompt_cache_key: PROMPT_CACHE_KEY,
    };
    const t0 = performance.now();
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => null);
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      invocation.steps.push({ latencyMs, content: null, toolCalls: [], request: structuredClone(body), response: json });
      throw new Error(msg);
    }

    const choice = json.choices?.[0];
    const message = choice?.message ?? {};
    const rawCalls: RawToolCall[] = message.tool_calls ?? [];
    const stepLog: StepLog = {
      latencyMs,
      content: message.content ?? null,
      toolCalls: [],
      usage: json.usage,
      finishReason: choice?.finish_reason,
      request: structuredClone(body),
      response: json,
    };
    invocation.steps.push(stepLog);
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: rawCalls.length ? rawCalls : undefined });

    if (!rawCalls.length) {
      onUpdate();
      return;
    }

    for (const call of rawCalls) {
      let args: Record<string, unknown> | string;
      let result: string;
      let ok = false;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = call.function.arguments;
      }
      if (typeof args === "string") {
        result = "Error: arguments were not valid JSON.";
      } else {
        const r = applyTool(getDoc(), call.function.name, args);
        ok = r.ok;
        if (r.ok) {
          setDoc(r.doc);
          invocation.edited = true;
          result = r.message;
        } else {
          result = `Error: ${r.error}`;
        }
      }
      stepLog.toolCalls.push({ id: call.id, name: call.function.name, args, ok, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    onUpdate();
    // Only go back to the model when something failed; a successful edit ends the turn.
    if (stepLog.toolCalls.every((c) => c.ok)) return;
  }
}
