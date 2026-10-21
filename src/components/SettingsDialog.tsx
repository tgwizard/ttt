import { useEffect, useState } from "react";
import type { Settings } from "../lib/agent.ts";
import { listModels } from "../lib/llm.ts";
import { PROVIDERS, provider as getProvider, type ProviderId } from "../lib/providers.ts";
import type { Keys } from "../lib/storage.ts";

// The last model/effort picked per provider, so switching back and forth is cheap.
type Choices = Partial<Record<ProviderId, { model: string; effort: string }>>;
const CHOICES_KEY = "ttt.choices";
function loadChoices(): Choices {
  try {
    return JSON.parse(localStorage.getItem(CHOICES_KEY) ?? "{}") as Choices;
  } catch {
    return {};
  }
}
function saveChoices(c: Choices) {
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(c));
  } catch {
    // Not important enough to surface.
  }
}

export function SettingsDialog(props: {
  keys: Keys;
  remembered: boolean;
  settings: Settings;
  onSave: (keys: Keys, remember: boolean, settings: Settings) => void;
  onClearDoc: () => void;
  onClose: () => void;
}) {
  const [keys, setKeys] = useState<Keys>(props.keys);
  const [remember, setRemember] = useState(props.remembered);
  const [settings, setSettings] = useState(props.settings);
  const [choices, setChoices] = useState<Choices>(loadChoices);
  const [live, setLive] = useState<{ provider: ProviderId; models: string[] } | { provider: ProviderId; error: string }>();
  const p = getProvider(settings.provider);
  const providerKey = keys[p.id] ?? "";
  const canClose = !!props.keys.meta && !!props.keys[props.settings.provider];
  const canSave = !!keys.meta?.trim() && !!providerKey.trim() && !!settings.model;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && canClose && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, props]);

  // Fetch the provider's live model list once there's a plausible key.
  useEffect(() => {
    const key = providerKey.trim();
    if (key.length < 8 && p.id !== "openrouter" && p.id !== "opencode") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      listModels(p.id, key).then(
        (models) => !cancelled && setLive({ provider: p.id, models }),
        (e: unknown) => !cancelled && setLive({ provider: p.id, error: e instanceof Error ? e.message : String(e) }),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [p.id, providerKey]);

  const liveHere = live?.provider === p.id ? live : undefined;
  const suggestions = [...new Set([...p.models, ...(liveHere && "models" in liveHere ? liveHere.models : [])])];

  const switchProvider = (id: ProviderId) => {
    const next = { ...choices, [settings.provider]: { model: settings.model, effort: settings.effort } };
    setChoices(next);
    const np = getProvider(id);
    const prev = next[id];
    setSettings({ provider: id, model: prev?.model ?? np.defaultModel, effort: prev?.effort ?? np.defaultEffort });
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && canClose && props.onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          saveChoices({ ...choices, [settings.provider]: { model: settings.model, effort: settings.effort } });
          props.onSave(
            Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v?.trim()])),
            remember,
            settings,
          );
        }}
      >
        <header>
          <h2>Talk to type</h2>
          {canClose && (
            <button type="button" className="icon-button" onClick={props.onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          )}
        </header>
        <p className="lede">You talk, a model writes. Runs in your browser; each key is only sent to its provider.</p>

        <div className="field">
          <label htmlFor="key-meta">
            Meta Model API key <span className="label-note">transcription{p.id === "meta" ? " + writing" : ""}</span>
          </label>
          <input
            id="key-meta"
            type="password"
            value={keys.meta ?? ""}
            onChange={(e) => setKeys({ ...keys, meta: e.target.value })}
            placeholder="Paste your key"
            autoFocus={!props.keys.meta}
            autoComplete="off"
          />
          {!keys.meta && (
            <a className="field-hint" href="https://dev.meta.ai/" target="_blank" rel="noreferrer">
              Get a key at dev.meta.ai ↗
            </a>
          )}
        </div>

        <div className="field">
          <label htmlFor="provider">Writing model</label>
          <div className="segmented" id="provider" role="radiogroup">
            {PROVIDERS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={x.id === p.id}
                className={x.id === p.id ? "on" : ""}
                onClick={() => switchProvider(x.id)}
              >
                {x.name}
                {keys[x.id] ? <i className="has-key" title="Key set" /> : null}
              </button>
            ))}
          </div>
        </div>

        {p.id !== "meta" && (
          <div className="field">
            <label htmlFor="key-provider">{p.name} API key</label>
            <input
              id="key-provider"
              type="password"
              value={providerKey}
              onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
              placeholder="Paste your key"
              autoComplete="off"
            />
            <span className="field-hint">
              {p.keyHint}{" "}
              <a href={p.keyUrl} target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            </span>
          </div>
        )}

        <div className="fields">
          <div className="field">
            <label htmlFor="model">
              Model{" "}
              {liveHere && (
                <span className="label-note">
                  {"models" in liveHere ? `${liveHere.models.length} available` : `couldn't list models (${liveHere.error})`}
                </span>
              )}
            </label>
            <input
              id="model"
              list="ttt-models"
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value.trim() })}
              placeholder="model id"
              spellCheck={false}
            />
            <datalist id="ttt-models">
              {suggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="effort">Reasoning</label>
            <select id="effort" value={settings.effort} onChange={(e) => setSettings({ ...settings, effort: e.target.value })}>
              {[...new Set([...p.efforts, settings.effort])].map((m) => (
                <option key={m} value={m}>
                  {m || "default"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember keys on this device
        </label>

        <footer>
          <button
            type="button"
            className="text-button danger"
            onClick={() => {
              props.onClearDoc();
              props.onClose();
            }}
          >
            Clear document
          </button>
          <span className="spacer" />
          <button type="submit" className="primary" disabled={!canSave}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}
