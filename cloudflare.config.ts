import { defineConfig } from "cf/config";

// Static site: everything runs in the browser and talks to api.meta.ai directly.
export default defineConfig({
  worker: {
    name: "ttt",
    compatibilityDate: "2026-10-01",
    // Custom domain: Cloudflare manages the DNS record and certificate.
    domains: ["ttt.tgwizard.com"],
    workersDev: false,
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
    },
  },
});
