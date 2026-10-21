// LLM providers the agent can drive. "openai" kind = OpenAI-compatible chat completions; "anthropic" = Messages API.
// Model lists are suggestions; the settings dialog also fetches each provider's live list once a key is set.

export type ProviderId = "meta" | "anthropic" | "openai" | "openrouter" | "groq" | "cerebras" | "opencode";
export type ApiKind = "openai" | "anthropic";

export type Provider = {
  id: ProviderId;
  name: string;
  /** Chat completions base (…/v1) for "openai" kind, or the Messages API base URL for "anthropic". */
  baseUrl: string;
  /** Per-model API kind, for gateways that serve some models in Anthropic format. */
  kindFor: (model: string) => ApiKind;
  anthropicBaseUrl?: string;
  keyUrl: string;
  keyHint?: string;
  models: string[];
  defaultModel: string;
  efforts: string[]; // "" = provider default (parameter omitted)
  defaultEffort: string;
  /** How to send effort on chat completions. */
  effortParam?: "reasoning_effort" | "reasoning";
  /** Send prompt_cache_key (only providers known to accept it). */
  promptCacheKey?: boolean;
};

const openai = () => "openai" as const;

export const PROVIDERS: Provider[] = [
  {
    id: "meta",
    name: "Meta",
    baseUrl: "https://api.meta.ai/v1",
    kindFor: openai,
    keyUrl: "https://dev.meta.ai/",
    keyHint: "Also used for transcription.",
    models: ["muse-spark-1.3-contributor", "muse-spark-1.2-contributor", "muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1", "muse-wonder-1.0"],
    defaultModel: "muse-spark-1.3-contributor",
    efforts: ["", "minimal", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "minimal",
    effortParam: "reasoning_effort",
    promptCacheKey: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    kindFor: () => "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "API usage is billed separately from a Claude subscription.",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    defaultModel: "claude-opus-5-5",
    efforts: ["", "low", "medium", "high", "xhigh", "max"],
    defaultEffort: "low",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    kindFor: openai,
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "API usage is billed separately from a ChatGPT subscription.",
    models: ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-mini", "gpt-5.4-nano"],
    defaultModel: "gpt-6-luna",
    efforts: ["", "none", "minimal", "low", "medium", "high", "xhigh"],
    defaultEffort: "low",
    effortParam: "reasoning_effort",
    promptCacheKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    kindFor: openai,
    keyUrl: "https://openrouter.ai/settings/keys",
    keyHint: "One key for most models (Claude, GPT, Gemini, Kimi, Qwen…).",
    models: [
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-6-luna",
      "google/gemini-3.8-flash",
      "moonshotai/kimi-k3",
      "qwen/qwen3.8-flash",
      "deepseek/deepseek-v4.1-flash",
      "z-ai/glm-5.3-flash",
      "x-ai/grok-4.7",
      "meta/muse-spark-1.3-contributor",
    ],
    defaultModel: "google/gemini-3.8-flash",
    efforts: ["", "minimal", "low", "medium", "high"],
    defaultEffort: "",
    effortParam: "reasoning",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    kindFor: openai,
    keyUrl: "https://console.groq.com/keys",
    keyHint: "Very fast inference on open models.",
    models: [],
    defaultModel: "",
    efforts: ["", "none", "low", "medium", "high"],
    defaultEffort: "",
    effortParam: "reasoning_effort",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    kindFor: openai,
    keyUrl: "https://cloud.cerebras.ai/",
    keyHint: "Very fast inference on open models.",
    models: [],
    defaultModel: "",
    efforts: ["", "low", "medium", "high"],
    defaultEffort: "",
    effortParam: "reasoning_effort",
  },
  {
    // opencode.ai has no CORS on its inference endpoints, so calls go through this app's Worker (worker/index.ts).
    id: "opencode",
    name: "OpenCode",
    baseUrl: "/proxy/opencode/openai/v1",
    anthropicBaseUrl: "/proxy/opencode/anthropic",
    kindFor: (model) => (/^(claude-|qwen3\.\d+-(flash|plus|max)$)/.test(model) ? "anthropic" : "openai"),
    keyUrl: "https://opencode.ai/auth",
    keyHint: "Pay-as-you-go credits; free models only work inside OpenCode.",
    models: ["kimi-k3", "glm-5.3-flash", "glm-5.3", "deepseek-v4.1-flash", "minimax-m3", "qwen3.8-max", "claude-haiku-5-5", "claude-sonnet-5-5"],
    defaultModel: "kimi-k3",
    efforts: ["", "low", "medium", "high"],
    defaultEffort: "",
    effortParam: "reasoning_effort",
  },
];

export const provider = (id: ProviderId): Provider => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;

/** The model list endpoint for a provider, as an absolute or same-origin URL. */
export function modelsUrl(p: Provider): string {
  if (p.id === "anthropic") return `${p.baseUrl}/v1/models?limit=100`;
  if (p.id === "opencode") return "https://opencode.ai/inference/v1/models";
  return `${p.baseUrl}/models`;
}
