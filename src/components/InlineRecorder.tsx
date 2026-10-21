import { useState } from "react";
import type { RecorderProps } from "./Recorder.tsx";

// The "inline" design: a small mic dot in the corner, and what you're saying appears as
// ghost text at the end of the document until the model has written it in.
export function InlineRecorder(props: RecorderProps) {
  const { state, partial, utterances, level, busy } = props;
  const [typed, setTyped] = useState("");
  const active = state !== "idle";
  const ghosts = utterances.filter((u) => u.status !== "handled").slice(-4);

  const status =
    state === "connecting"
      ? "connecting…"
      : state === "stopping"
        ? "finishing…"
        : busy
          ? "writing…"
          : state === "recording"
            ? "listening"
            : "space to talk";

  return (
    <>
      <div className="inline-control">
        <button
          className={`dot ${state}`}
          onClick={active ? props.onStop : props.onStart}
          disabled={state === "connecting" || state === "stopping"}
          title={active ? "Stop (space)" : "Start talking (space)"}
          style={{ ["--level" as string]: Math.min(1, level * 8).toFixed(2) }}
        />
        <span className={`inline-status ${busy ? "busy" : ""}`}>{status}</span>
        {props.canUndo && !busy && (
          <button className="ghost small" onClick={props.onUndo} title="Undo last change (⌘Z)">
            undo
          </button>
        )}
        {props.error && <span className="inline-error">{props.error}</span>}
      </div>

      <div className="ghost-text">
        {ghosts.map((u) => (
          <span key={u.id} className={u.status}>
            {u.text}{" "}
          </span>
        ))}
        {partial && <span className="partial">{partial}</span>}
        {active && <span className="caret" />}
        {!active && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim()) return;
              props.onType(typed.trim());
              setTyped("");
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="…or type an instruction" />
          </form>
        )}
      </div>
    </>
  );
}
