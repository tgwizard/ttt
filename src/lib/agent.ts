// The agent: given the user's speech and the current document, call the model and apply its tool calls.
// Each invocation is stateless: the prompt carries the session's speech (with what happened to it) and the full document.

import { callModel, ModelError, type Conversation, type ToolSpec, type Usage } from "./llm.ts";
import type { ProviderId } from "./providers.ts";
import { applyTool, ASK_USER_TOOL, TOOL_DEFINITIONS } from "./tools.ts";

export const MAX_STEPS = 6;
// Routes requests to backends that already hold the system prompt + tools prefix (where supported).
const PROMPT_CACHE_KEY = "ttt-agent";

export type UtteranceStatus = "new" | "pending" | "handled";
// role "assistant" marks a question the model asked (via ask_user), kept in the transcript for context.
export type Utterance = { id: number; text: string; at: number; status: UtteranceStatus; role?: "assistant" };

export type Settings = { provider: ProviderId; model: string; effort: string };

export type ToolCallLog = { id: string; name: string; args: Record<string, unknown> | string; ok: boolean; result: string };
export type StepLog = {
  latencyMs: number;
  content: string | null;
  toolCalls: ToolCallLog[];
  usage?: Usage;
  finishReason?: string;
  request: unknown;
  response: unknown;
};
export type Invocation = {
  id: number;
  startedAt: number;
  endedAt?: number;
  provider?: ProviderId; // absent on log entries from before providers existed (Meta)
  model: string;
  reasoningEffort: string;
  speech: string[]; // the new/pending speech this invocation acts on
  steps: StepLog[];
  status: "running" | "done" | "error";
  edited: boolean;
  asked?: string;
  error?: string;
};

export const SYSTEM_PROMPT = `You are the hands of "Talk to type", a voice-driven writing app. The user speaks out loud; their speech is transcribed live and sent to you whenever they pause. You edit a single markdown document for them using tools.

Reading the speech:
- Speech is a mix of instructions ("make the title shorter", "add a bullet about X", "delete the last paragraph") and dictation (the words they want written). Tell them apart from context. When dictating, write what they meant, cleaned up: punctuation, capitalization, no filler words (um, uh, like, you know), no false starts, and apply self-corrections ("on Monday, no wait, Tuesday" → "on Tuesday").
- Transcription is imperfect. Interpret misheard words and homophones sensibly given the document.
- Speech arrives at every pause, so the user may be mid-thought: a chunk can stop in the middle of a sentence or instruction ("and then add a section about"). If the speech is clearly incomplete or too ambiguous to act on, do NOT edit. Reply with a few words on what you're waiting for; it will come back to you together with what they say next.
- If the intent is clear, act right away. Prefer acting over waiting: the user watches the document update live and can correct you.
- Talk not meant for the document (talking to someone else, "hmm, let me think", "okay") → do nothing.
- If you can't act without the user's input (which part they mean, details only they know), call ask_user with one short question instead of guessing. Their answer comes as the next speech. Don't ask about things you can reasonably decide yourself.
- <earlier_speech> is everything the user has said this session that you already acted on. Never apply it again; use it only as context ("the point I made earlier", "what I said about X").
- <new_speech> is what to act on now. "pending" items in it were said earlier but not acted on yet: treat them together with the rest as one message.

Editing:
- The current document is given in full and is the source of truth; the user may also edit it by hand.
- Use the smallest edit that does the job: append for adding at the end, replace for local changes (copy \`old\` exactly from the document), set for a first draft or a large rewrite.
- You may call several tools. If a tool returns an error, fix the call and retry.
- Write clean markdown: headings, lists, short paragraphs. No HTML. Don't add content they didn't ask for, and no meta text like "Here is your document".
- Write in the language the user speaks, unless asked otherwise.

Along with your tool calls, say in one short sentence what you're doing (it goes to a log, not the document). If every call succeeds that is the end of your turn, so make all the edits you need in one go.`;

// Prompt order is chosen for prefix caching: the handled transcript only grows at the end (`stable`),
// the document changes on edits, and the new speech changes every call.
export function buildUserMessage(utterances: Utterance[], doc: string): Conversation["user"] {
  const handled = utterances.filter((u) => u.status === "handled");
  const active = utterances.filter((u) => u.status !== "handled");
  const stable: string[] = [];
  if (handled.length) {
    stable.push("<earlier_speech>");
    for (const u of handled) stable.push(u.role === "assistant" ? `[you asked] ${u.text}` : `[handled] ${u.text}`);
    stable.push("</earlier_speech>", "", "");
  }
  const rest: string[] = [doc.trim() ? `<document>\n${doc}\n</document>` : "<document>\n(empty)\n</document>", ""];
  rest.push("<new_speech>");
  for (const u of active) rest.push(u.status === "pending" ? `[pending] ${u.text}` : u.text);
  rest.push("</new_speech>");
  return { stable: stable.join("\n"), rest: rest.join("\n") };
}

const TOOLS: ToolSpec[] = [...TOOL_DEFINITIONS, ASK_USER_TOOL].map((t) => t.function as unknown as ToolSpec);

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
  const convo: Conversation = { system: SYSTEM_PROMPT, user: buildUserMessage(opts.utterances, getDoc()), steps: [] };

  for (let step = 0; step < MAX_STEPS; step++) {
    const t0 = performance.now();
    let turn;
    try {
      turn = await callModel({
        providerId: settings.provider,
        model: settings.model,
        effort: settings.effort,
        apiKey,
        convo,
        tools: TOOLS,
        promptCacheKey: PROMPT_CACHE_KEY,
        signal,
      });
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      if (e instanceof ModelError) invocation.steps.push({ latencyMs, content: null, toolCalls: [], request: e.request, response: e.response });
      throw e;
    }
    const stepLog: StepLog = {
      latencyMs: Math.round(performance.now() - t0),
      content: turn.content,
      toolCalls: [],
      usage: turn.usage,
      finishReason: turn.finishReason,
      request: turn.request,
      response: turn.response,
    };
    invocation.steps.push(stepLog);

    if (!turn.toolCalls.length) {
      onUpdate();
      return;
    }

    const results: Conversation["steps"][number]["results"] = [];
    for (const call of turn.toolCalls) {
      const { args } = call;
      let result: string;
      let ok = false;
      if (typeof args === "string") {
        result = "Error: arguments were not valid JSON.";
      } else if (call.name === "ask_user") {
        ok = typeof args.question === "string" && args.question.trim() !== "";
        if (ok) invocation.asked = String(args.question).trim();
        result = ok ? "Shown to the user. Their answer will arrive as new speech." : "Error: `question` must be a non-empty string";
      } else {
        const r = applyTool(getDoc(), call.name, args);
        ok = r.ok;
        if (r.ok) {
          setDoc(r.doc);
          invocation.edited = true;
          result = r.message;
        } else {
          result = `Error: ${r.error}`;
        }
      }
      stepLog.toolCalls.push({ id: call.id, name: call.name, args, ok, result });
      results.push({ id: call.id, content: result, isError: !ok });
    }
    convo.steps.push({ replay: turn.replay, results });
    onUpdate();
    // Only go back to the model when something failed; a successful edit ends the turn.
    if (stepLog.toolCalls.every((c) => c.ok)) return;
  }
}
