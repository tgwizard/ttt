import { useState } from "react";
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

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.apiKey && props.onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSave(key.trim(), remember, settings);
        }}
      >
        <h2>Talk to type</h2>
        <p className="muted">
          You talk; Muse Spark edits the document. Everything runs in your browser and calls the{" "}
          <a href="https://dev.meta.ai/" target="_blank" rel="noreferrer">
            Meta Model API
          </a>{" "}
          directly with your key.
        </p>
        <label>
          API key
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your Model API key" autoFocus={!props.apiKey} />
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device (otherwise kept for this tab only)
        </label>
        <div className="row">
          <label>
            Model
            <input
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
          </label>
          <label>
            Reasoning effort
            <select value={settings.reasoningEffort} onChange={(e) => setSettings({ ...settings, reasoningEffort: e.target.value })}>
              {EFFORTS.map((m) => (
                <option key={m} value={m}>
                  {m || "default"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row end">
          <button
            type="button"
            className="ghost danger"
            onClick={() => {
              props.onClearDoc();
              props.onClose();
            }}
          >
            Clear document
          </button>
          <span className="spacer" />
          {props.apiKey && (
            <button type="button" className="ghost" onClick={props.onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="primary" disabled={!key.trim() || !settings.model}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
