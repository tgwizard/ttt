import { defineConfig } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

// Static site: everything runs in the browser and talks to the model APIs directly.
// The Worker only proxies providers without CORS (see worker/index.ts).
export default defineConfig({
  worker: {
    name: "ttt",
    compatibilityDate: "2026-10-01",
    entrypoint,
    // Custom domain: Cloudflare manages the DNS record and certificate.
    domains: ["ttt.tgwizard.com"],
    workersDev: false,
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/proxy/*"],
    },
  },
});
