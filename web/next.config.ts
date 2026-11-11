import path from "node:path";
import type { NextConfig } from "next";

// `.env` lives at the repo root (README "Setup"), shared with the checker
// and the scripts. Next reads `.env` from `web/` only, so `npm run dev` had no
// CHECKER_URL or model keys. `process.loadEnvFile` never overrides a variable
// that is already set, so a deployment's own settings win. In Docker there is
// no root `.env`, and this does nothing.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "..", ".env"));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Docker image (task 32): .next/standalone holds server.js and only the
  // node_modules files the server needs.
  output: "standalone",
  // pdf.js loads its worker code with a dynamic import at run time. Keep it
  // out of the server bundle so Node resolves it from node_modules.
  // playwright-core (PDF export) is on Next's default list; named here so the
  // Docker build doesn't depend on that list.
  serverExternalPackages: ["pdfjs-dist", "playwright-core"],
  // Files the standalone trace misses because they are loaded at run time:
  // pdf.js's fake worker (a dynamic import; PDF text extraction fails without
  // it) and playwright-core's data files such as browsers.json (PDF export
  // fails without them; the package is about 14 MB, so all of it is included).
  outputFileTracingIncludes: {
    "/api/extract": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/api/export": ["./node_modules/playwright-core/**/*"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
