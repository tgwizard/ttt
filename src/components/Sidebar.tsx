import { useEffect, useRef } from "react";
import type { Invocation, StepLog } from "../lib/agent.ts";

// The right-hand log of model invocations.
export function Sidebar({
  invocations,
  onClear,
  onResize,
}: {
  invocations: Invocation[];
  onClear: () => void;
  onResize: (width: number) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = invocations.at(-1);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [invocations.length, last?.steps.length, last?.status]);

  return (
    <aside className="sidebar">
      <div
        className="resize-handle"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault();
          const handle = e.currentTarget;
          handle.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => onResize(window.innerWidth - ev.clientX);
          const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            document.body.classList.remove("resizing");
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up);
          document.body.classList.add("resizing");
        }}
      />
      <header>
        <span>Invocations</span>
        {invocations.length > 0 && (
          <button className="ghost small" onClick={onClear}>
            Clear
          </button>
        )}
      </header>
      <div className="inv-list">
        {invocations.length === 0 && <p className="muted">Model calls show up here.</p>}
        {invocations.map((inv) => (
          <InvocationCard key={inv.id} inv={inv} />
        ))}
        <div ref={endRef} />
      </div>
    </aside>
  );
}

function InvocationCard({ inv }: { inv: Invocation }) {
  const ms = (inv.endedAt ?? Date.now()) - inv.startedAt;
  const tokensIn = sum(inv.steps, (s) => s.usage?.prompt_tokens);
  const tokensOut = sum(inv.steps, (s) => s.usage?.completion_tokens);
  const reasoning = sum(inv.steps, (s) => s.usage?.completion_tokens_details?.reasoning_tokens);
  const cached = sum(inv.steps, (s) => s.usage?.prompt_tokens_details?.cached_tokens);
  const time = new Date(inv.startedAt).toLocaleTimeString([], { hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <section className={`inv ${inv.status}`}>
      <div className="inv-meta">
        <span>#{inv.id}</span>
        <span>{time}</span>
        {inv.status === "running" ? <span className="spinner tiny" /> : <span>{(ms / 1000).toFixed(1)}s</span>}
        <span title="steps">{inv.steps.length}×</span>
        {tokensIn > 0 && (
          <span title={`prompt tokens (cached) → completion tokens (reasoning)`}>
            {tokensIn}
            {cached ? <span className="cached">({cached})</span> : null}→{tokensOut}
            {reasoning ? `(${reasoning}r)` : ""}
          </span>
        )}
        <span className="inv-model" title={`${inv.model} · reasoning: ${inv.reasoningEffort || "default"}`}>
          {inv.model.replace(/^muse-/, "")}/{inv.reasoningEffort || "default"}
        </span>
      </div>
      <div className="inv-speech">
        {inv.speech.map((s, i) => (
          <div key={i}>“{s}”</div>
        ))}
      </div>
      {inv.steps.map((step, i) => (
        <Step key={i} step={step} />
      ))}
      {inv.status === "done" && !inv.edited && !inv.asked && <div className="inv-wait">no edit — waiting for more</div>}
      {inv.error && <div className="inv-error">{inv.error}</div>}
    </section>
  );
}

function Step({ step }: { step: StepLog }) {
  return (
    <div className="step">
      {step.toolCalls.map((c) => (
        <div key={c.id} className={`call ${c.ok ? "ok" : "fail"}`}>
          <div>
            <b>{c.name}</b>
            <span className="muted"> · {c.result}</span>
          </div>
          {typeof c.args === "string" ? (
            <pre>{c.args}</pre>
          ) : (
            Object.entries(c.args).map(([k, v]) => (
              <div key={k} className="arg">
                <span className="arg-k">{k}</span>
                <pre>{typeof v === "string" ? v : JSON.stringify(v)}</pre>
              </div>
            ))
          )}
        </div>
      ))}
      {step.content && <div className="step-text">{step.content}</div>}
      <details>
        <summary>
          raw · {step.latencyMs}ms{step.finishReason ? ` · ${step.finishReason}` : ""}
        </summary>
        <pre className="raw">{JSON.stringify({ request: step.request, response: step.response }, null, 2)}</pre>
      </details>
    </div>
  );
}

function sum<T>(xs: T[], f: (x: T) => number | undefined) {
  return xs.reduce((acc, x) => acc + (f(x) ?? 0), 0);
}
