// The document-editing tools the model can call. Pure: (doc, args) -> new doc or error.

export type ToolResult = { ok: true; doc: string; message: string } | { ok: false; error: string };

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "set",
      description:
        "Replace the entire document with new markdown content. Use for the first draft, or for large restructurings. Prefer replace/append for small edits.",
      parameters: {
        type: "object",
        properties: { content: { type: "string", description: "The full new document, as markdown." } },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace",
      description:
        "Replace an exact substring of the document. `old` must match the document exactly (including whitespace and punctuation) and occur exactly once, unless `all` is true, in which case every occurrence is replaced. Include enough surrounding text in `old` to make it unique. Use an empty `new` to delete.",
      parameters: {
        type: "object",
        properties: {
          old: { type: "string", description: "Exact text currently in the document." },
          new: { type: "string", description: "Text to put in its place." },
          all: { type: "boolean", description: "Replace every occurrence instead of requiring exactly one." },
        },
        required: ["old", "new"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append",
      description:
        "Append text to the end of the document. Include any leading newlines you need (e.g. \"\\n\\n\" to start a new paragraph).",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "Markdown to append." } },
        required: ["text"],
      },
    },
  },
] as const;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

export function applyTool(doc: string, name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case "set": {
      if (typeof args.content !== "string") return { ok: false, error: "`content` must be a string" };
      return { ok: true, doc: args.content, message: `Document set (${args.content.length} chars).` };
    }
    case "replace": {
      const { old, new: replacement, all } = args;
      if (typeof old !== "string" || typeof replacement !== "string")
        return { ok: false, error: "`old` and `new` must be strings" };
      if (old === "") return { ok: false, error: "`old` must not be empty" };
      const n = countOccurrences(doc, old);
      if (n === 0) return { ok: false, error: "`old` was not found in the document. Copy it exactly from the current document." };
      if (n > 1 && all !== true)
        return { ok: false, error: `\`old\` occurs ${n} times. Include more surrounding text to make it unique, or pass all: true.` };
      return { ok: true, doc: doc.split(old).join(replacement), message: `Replaced ${n} occurrence${n === 1 ? "" : "s"}.` };
    }
    case "append": {
      if (typeof args.text !== "string") return { ok: false, error: "`text` must be a string" };
      return { ok: true, doc: doc + args.text, message: `Appended ${args.text.length} chars.` };
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
