import { useLayoutEffect, useRef, useState } from "react";
import type { Utterance } from "../lib/agent.ts";

export type RecState = "idle" | "connecting" | "recording" | "stopping";

export type RecorderProps = {
  state: RecState;
  error?: string;
  partial: string;
  utterances: Utterance[];
  level: number;
  busy: boolean;
  canUndo: boolean;
  question?: string;
  onDismissQuestion: () => void;
  onStart: () => void;
  onStop: () => void;
  onType: (text: string) => void;
  onUndo: () => void;
};

// The floating pill: record button, a ticker of what you've said, and agent status.
export function Recorder(props: RecorderProps) {
  const { state, partial, utterances, level, busy } = props;
  const [typed, setTyped] = useState("");
  const tickerRef = useRef<HTMLDivElement>(null);
  const active = state !== "idle";

  useLayoutEffect(() => {
    const el = tickerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    el.classList.toggle("overflowing", el.scrollWidth > el.clientWidth);
  }, [partial, utterances, state]);

  const recent = utterances.filter((u) => u.role !== "assistant").slice(-6);

  return (
    <div className="recorder">
      {props.question && (
        <div className="question">
          <span>{props.question}</span>
          <button className="icon-button small" onClick={props.onDismissQuestion} aria-label="Dismiss">
            <svg width="10" height="10" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>
      )}
      {props.error && <div className="rec-error">{props.error}</div>}
      <div className="pill">
        <button
          className={`mic ${state}`}
          onClick={active ? props.onStop : props.onStart}
          disabled={state === "stopping"}
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
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Talk, or type an instruction" />
          </form>
        )}

        <div className="pill-end">
          {busy && (
            <span className="thinking" title="Writing…">
              <i />
              <i />
              <i />
            </span>
          )}
          {props.canUndo && !busy && (
            <button className="icon-button" onClick={props.onUndo} title="Undo last change (⌘Z)" aria-label="Undo">
              <UndoIcon />
            </button>
          )}
          {!active && !busy && !typed && <kbd title="Press space to start talking">space</kbd>}
        </div>
      </div>
    </div>
  );
}

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
