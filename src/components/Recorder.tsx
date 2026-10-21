import { useLayoutEffect, useRef, useState } from "react";
import type { Utterance } from "../lib/agent.ts";

export type RecState = "idle" | "connecting" | "recording" | "stopping";

// The floating pill: record button, a ticker of what you've said, and agent status.
export function Recorder(props: {
  state: RecState;
  error?: string;
  partial: string;
  utterances: Utterance[];
  level: number;
  busy: boolean;
  canUndo: boolean;
  onStart: () => void;
  onStop: () => void;
  onType: (text: string) => void;
  onUndo: () => void;
}) {
  const { state, partial, utterances, level, busy } = props;
  const [typed, setTyped] = useState("");
  const tickerRef = useRef<HTMLDivElement>(null);
  const active = state !== "idle";

  useLayoutEffect(() => {
    const el = tickerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [partial, utterances]);

  const recent = utterances.slice(-6);

  return (
    <div className="recorder">
      {props.error && <div className="rec-error">{props.error}</div>}
      <div className="pill">
        <button
          className={`mic ${state}`}
          onClick={active ? props.onStop : props.onStart}
          disabled={state === "connecting" || state === "stopping"}
          title={active ? "Stop" : "Start talking"}
          style={{ ["--level" as string]: Math.min(1, level * 8).toFixed(2) }}
        >
          {active ? <span className="stop-icon" /> : <MicIcon />}
        </button>

        {active ? (
          <div className="ticker" ref={tickerRef}>
            <div className="ticker-inner">
              {recent.map((u) => (
                <span key={u.id} className={`said ${u.status}`}>
                  {u.text}{" "}
                </span>
              ))}
              <span className="partial">{partial || (state === "connecting" ? "connecting…" : recent.length ? "" : "listening…")}</span>
            </div>
          </div>
        ) : (
          <form
            className="type"
            onSubmit={(e) => {
              e.preventDefault();
              if (!typed.trim()) return;
              props.onType(typed.trim());
              setTyped("");
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Talk, or type an instruction…" />
          </form>
        )}

        <div className="pill-end">
          {busy && <span className="spinner" title="Thinking" />}
          {props.canUndo && !busy && (
            <button className="ghost small" onClick={props.onUndo} title="Undo last change (⌘Z)">
              Undo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
