// The app is static; this Worker only proxies OpenCode, whose inference API doesn't allow browser (CORS) calls.
// /proxy/opencode/<path> → https://opencode.ai/inference/<path>. The user's key passes through and is never stored.

const UPSTREAM = "https://opencode.ai/inference/";
const FORWARD_HEADERS = ["authorization", "x-api-key", "content-type", "accept", "anthropic-version", "anthropic-beta"];

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/proxy\/opencode\//, "");
    if (path === url.pathname || !/^(openai|anthropic)\/v1\/[a-z/_-]+$/.test(path)) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST" && request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const headers = new Headers();
    for (const h of FORWARD_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const upstream = await fetch(UPSTREAM + path + url.search, {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
    });
    const out = new Headers(upstream.headers);
    out.delete("set-cookie");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
