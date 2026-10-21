# Talk to type

You talk, and the app writes for you.

Your voice is transcribed live with [Muse Voice Transcribe](https://dev.meta.ai/docs/speech-to-text), and every time you pause, what you said goes to an LLM as instructions ([Muse Spark](https://dev.meta.ai/docs/models#muse-spark) by default; Anthropic, OpenAI, OpenRouter, Groq, Cerebras and OpenCode also work). The model edits a markdown document with three tools:

- `set(content)`: replace the whole document
- `replace(old, new, all?)`: replace an exact substring (must occur exactly once unless `all`)
- `append(text)`: add to the end

and can ask you a question with `ask_user(question)`; your next speech is the answer.

The model decides whether you're done with a thought. If you stop mid-sentence it waits, and the unfinished speech is sent again together with whatever you say next.

Everything runs in the browser. You paste a Meta Model API key (needed for transcription) plus a key for whichever provider writes, and the page calls each provider directly. OpenCode is the exception: its API has no CORS, so those calls go through a small pass-through proxy in this app's Worker (`worker/index.ts`). The document, transcript, settings and log live in `localStorage`. Keys stay in `sessionStorage` unless you tick "Remember keys on this device".

- Click the document to edit the markdown by hand; ⌘Z (outside the editor) undoes the last change
- The right sidebar logs every model call: speech in, tool calls, latency, tokens, and the raw request and response
- Settings: provider, any model ID (the live model list is fetched once a key is set) and reasoning effort
- Space starts and stops recording

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # tool unit tests
```

## Deploy

```sh
npx cf auth login  # once
npm run deploy
```

Cloudflare Workers (static assets plus the OpenCode proxy), served at ttt.tgwizard.com.

## How it works

- `src/lib/asr.ts`: mic → AudioWorklet (resample to 24 kHz PCM16, 80 ms frames) → `wss://api.meta.ai/v1/asr/realtime` in `ENDPOINTING` mode. Partials drive the ticker; each `speechComplete` is one utterance.
- `src/lib/agent.ts`: system prompt and one stateless call per pause. The prompt has the whole session transcript (speech already acted on), the full current document, then the new speech, in that order so the cached prefix stays as long as possible. The transcript is saved with the document; "Clear document" clears both. Tool calls are applied right away. The model only gets another step if a tool call fails.
- `src/lib/llm.ts`: one model call per provider format: OpenAI-compatible chat completions via `fetch`, Anthropic via `@anthropic-ai/sdk` (prompt-cache breakpoints on the system prompt and the transcript). `src/lib/providers.ts` lists providers, default models and effort levels.
- `src/lib/tools.ts`: the document tools as pure functions.
