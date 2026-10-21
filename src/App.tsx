import { useCallback, useEffect, useRef, useState } from "react";
import { runAgent, type Invocation, type Settings, type Utterance } from "./lib/agent.ts";
import { Transcriber } from "./lib/asr.ts";
import { provider } from "./lib/providers.ts";
import { areKeysRemembered, load, loadKeys, save, saveKeys, type Keys } from "./lib/storage.ts";
import { DocView } from "./components/DocView.tsx";
import { Recorder, type RecState, type RecorderProps } from "./components/Recorder.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";

// Older versions stored { model, reasoningEffort } for Meta only.
function loadSettings(): Settings {
  const s = load<Partial<Settings> & { reasoningEffort?: string }>("settings", {});
  const p = provider(s.provider ?? "meta");
  return { provider: p.id, model: s.model || p.defaultModel, effort: s.effort ?? s.reasoningEffort ?? p.defaultEffort };
}
const LOG_LIMIT = 50;

const clampSidebar = (w: number) => Math.round(Math.max(280, Math.min(w, window.innerWidth * 0.7)));

export function App() {
  const [keys, setKeys] = useState<Keys>(loadKeys);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const apiKey = keys[settings.provider] ?? "";
  const asrKey = keys.meta ?? "";
  const [doc, setDocState] = useState<string>(() => load("doc", ""));
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => load("sidebar", window.innerWidth > 900));
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => clampSidebar(load("sidebarWidth", 400)));
  const [settingsOpen, setSettingsOpen] = useState(!apiKey || !asrKey);
  const [rec, setRecState] = useState<RecState>("idle");
  // Updated synchronously so a quick second keypress sees the new state before React re-renders.
  const recRef = useRef<RecState>("idle");
  const setRec = (s: RecState) => {
    recRef.current = s;
    setRecState(s);
  };
  const [recError, setRecError] = useState<string>();
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<string>();
  // The session transcript, persisted with the doc. Speech that never reached the model (reload mid-run) comes back as pending.
  const [utterances, setUtterances] = useState<Utterance[]>(() =>
    load<Utterance[]>("transcript", []).map((u) => (u.status === "new" ? { ...u, status: "pending" } : u)),
  );
  const [, setTick] = useState(0);

  const docRef = useRef(doc);
  const undoRef = useRef<string[]>([]);
  const utterancesRef = useRef(utterances);
  const invocationsRef = useRef<Invocation[]>(load("log", []));
  const runningRef = useRef(false);
  const transcriberRef = useRef<Transcriber>(undefined);
  const settingsRef = useRef(settings);
  const keyRef = useRef(apiKey);
  settingsRef.current = settings;
  keyRef.current = apiKey;

  const rerender = useCallback(() => setTick((t) => t + 1), []);

  const setDoc = useCallback((next: string) => {
    docRef.current = next;
    setDocState(next);
    save("doc", next);
  }, []);

  const commitUtterances = (next: Utterance[]) => {
    utterancesRef.current = next;
    setUtterances(next);
    save("transcript", next);
  };

  // Run the agent until every new utterance has been seen. Speech that arrives mid-run triggers another pass.
  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      while (utterancesRef.current.some((u) => u.status === "new")) {
        const active = utterancesRef.current.filter((u) => u.status !== "handled");
        const before = docRef.current;
        const inv: Invocation = {
          id: (invocationsRef.current.at(-1)?.id ?? 0) + 1,
          startedAt: Date.now(),
          provider: settingsRef.current.provider,
          model: settingsRef.current.model,
          reasoningEffort: settingsRef.current.effort,
          speech: active.map((u) => (u.status === "pending" ? `[pending] ${u.text}` : u.text)),
          steps: [],
          status: "running",
          edited: false,
        };
        invocationsRef.current = [...invocationsRef.current, inv].slice(-LOG_LIMIT);
        rerender();
        try {
          await runAgent({
            apiKey: keyRef.current,
            settings: settingsRef.current,
            utterances: utterancesRef.current.map((u) => ({ ...u })),
            getDoc: () => docRef.current,
            setDoc,
            invocation: inv,
            onUpdate: rerender,
          });
          inv.status = "done";
        } catch (e) {
          inv.status = "error";
          inv.error = e instanceof Error ? e.message : String(e);
        }
        inv.endedAt = Date.now();
        if (inv.edited) undoRef.current.push(before);
        const ids = new Set(active.map((u) => u.id));
        const acted = inv.edited || !!inv.asked;
        let next = utterancesRef.current.map((u) => (ids.has(u.id) ? { ...u, status: acted ? ("handled" as const) : ("pending" as const) } : u));
        if (inv.asked) {
          next = [...next, { id: (next.at(-1)?.id ?? 0) + 1, text: inv.asked, at: Date.now(), status: "handled", role: "assistant" }];
          setQuestion(inv.asked);
        }
        commitUtterances(next);
        save("log", invocationsRef.current);
        rerender();
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [rerender, setDoc]);

  const addUtterance = useCallback(
    (text: string) => {
      const last = utterancesRef.current.at(-1);
      setQuestion(undefined);
      commitUtterances([...utterancesRef.current, { id: (last?.id ?? 0) + 1, text, at: Date.now(), status: "new" }]);
      void pump();
    },
    [pump],
  );

  const startRecording = async () => {
    if (!asrKey || !apiKey) return setSettingsOpen(true);
    setRecError(undefined);
    setRec("connecting");
    const t = new Transcriber({
      onPartial: setPartial,
      onTurn: addUtterance,
      onLevel: setLevel,
      onReady: () => setRec("recording"),
      onClose: (error) => {
        transcriberRef.current = undefined;
        setRec("idle");
        setPartial("");
        setLevel(0);
        if (error) setRecError(error);
      },
    });
    transcriberRef.current = t;
    try {
      await t.start(asrKey);
    } catch (e) {
      transcriberRef.current = undefined;
      setRec("idle");
      setRecError(e instanceof Error ? e.message : String(e));
      void t.stop();
    }
  };

  const stopRecording = async () => {
    setRec("stopping");
    await transcriberRef.current?.stop();
  };

  const toggleRecording = () => {
    if (recRef.current === "idle") void startRecording();
    else if (recRef.current === "recording" || recRef.current === "connecting") void stopRecording();
  };
  const toggleRef = useRef(toggleRecording);
  toggleRef.current = toggleRecording;

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (prev !== undefined) setDoc(prev);
  }, [setDoc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, select, button, .backdrop")) return;
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
        e.preventDefault();
        toggleRef.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  useEffect(() => {
    save("sidebar", sidebarOpen);
  }, [sidebarOpen]);
  useEffect(() => {
    save("sidebarWidth", sidebarWidth);
  }, [sidebarWidth]);

  const recorderProps: RecorderProps = {
    state: rec,
    error: recError,
    partial,
    utterances,
    level,
    busy,
    canUndo: undoRef.current.length > 0,
    question,
    onDismissQuestion: () => setQuestion(undefined),
    onStart: startRecording,
    onStop: stopRecording,
    onType: addUtterance,
    onUndo: undo,
  };

  return (
    <div
      className={`app ${sidebarOpen ? "with-sidebar" : ""}`}
      style={{ ["--sidebar" as string]: `${sidebarWidth}px` }}
    >
      <main className="page">
        <DocView
          doc={doc}
          onEdit={(next) => {
            undoRef.current.push(docRef.current);
            setDoc(next);
          }}
        />
      </main>

      <div className="corner">
        <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
        </button>
        <button
          className={`icon-button ${sidebarOpen ? "active" : ""}`}
          onClick={() => setSidebarOpen((o) => !o)}
          title={sidebarOpen ? "Hide log" : "Show log"}
          aria-label="Toggle log"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M15 4v16" />
          </svg>
        </button>
      </div>

      <Recorder {...recorderProps} />

      {sidebarOpen && (
        <Sidebar
          invocations={invocationsRef.current}
          onClear={() => {
            invocationsRef.current = [];
            save("log", []);
            rerender();
          }}
          onResize={(w) => setSidebarWidth(clampSidebar(w))}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          keys={keys}
          remembered={areKeysRemembered()}
          settings={settings}
          onSave={(nextKeys, remember, next) => {
            saveKeys(nextKeys, remember);
            setKeys(nextKeys);
            setSettings(next);
            save("settings", next);
            setSettingsOpen(false);
          }}
          onClearDoc={() => {
            undoRef.current.push(docRef.current);
            setDoc("");
            commitUtterances([]);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
