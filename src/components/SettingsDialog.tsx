import { useEffect, useState } from "react";
import type { Settings } from "../lib/agent.ts";

// Suggestions only: any model ID from /v1/models can be typed in.
const MODELS = [
  "muse-spark-1.3-contributor",
  "muse-spark-1.2-contributor",
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-spark-1.1",
  "muse-wonder-1.0",
];
// "" leaves reasoning_effort out of the request (the model's default).
const EFFORTS = ["", "minimal", "low", "medium", "high", "xhigh", "max"];

export function SettingsDialog(props: {
  apiKey: string;
  remembered: boolean;
  settings: Settings;
  onSave: (key: string, remember: boolean, settings: Settings) => void;
  onClearDoc: () => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState(props.apiKey);
  const [remember, setRemember] = useState(props.remembered);
  const [settings, setSettings] = useState(props.settings);
  const canClose = !!props.apiKey;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && canClose && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, props]);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && canClose && props.onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSave(key.trim(), remember, settings);
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
        <p className="lede">
          You talk, Muse writes. Runs in your browser; your key is only sent to{" "}
          <a href="https://dev.meta.ai/" target="_blank" rel="noreferrer">
            api.meta.ai
          </a>
          .
        </p>

        <div className="field">
          <label htmlFor="key">API key</label>
          <input
            id="key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your Model API key"
            autoFocus={!props.apiKey}
            autoComplete="off"
          />
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember on this device
          </label>
        </div>

        <div className="fields">
          <div className="field">
            <label htmlFor="model">Model</label>
            <input
              id="model"
              list="ttt-models"
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value.trim() })}
              spellCheck={false}
            />
            <datalist id="ttt-models">
              {MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="effort">Reasoning</label>
            <select
              id="effort"
              value={settings.reasoningEffort}
              onChange={(e) => setSettings({ ...settings, reasoningEffort: e.target.value })}
            >
              {EFFORTS.map((m) => (
                <option key={m} value={m}>
                  {m || "default"}
                </option>
              ))}
            </select>
          </div>
        </div>

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
          <button type="submit" className="primary" disabled={!key.trim() || !settings.model}>
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}
