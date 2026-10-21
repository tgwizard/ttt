import DOMPurify from "dompurify";
import { marked } from "marked";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

// The document: rendered markdown, click to edit the source.
export function DocView({ doc, onEdit }: { doc: string; onEdit: (doc: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc);
  const ref = useRef<HTMLTextAreaElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(doc, { async: false, gfm: true, breaks: true })), [doc]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="doc-source"
        value={draft}
        autoFocus
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        onBlur={() => {
          setEditing(false);
          if (draft !== doc) onEdit(draft);
        }}
      />
    );
  }

  return (
    <article
      className={`doc ${doc.trim() ? "" : "empty"}`}
      title="Click to edit"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        setDraft(doc);
        setEditing(true);
      }}
      dangerouslySetInnerHTML={{ __html: doc.trim() ? html : "<p>Press space and start talking.</p>" }}
    />
  );
}
