import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf.js loads its worker code with a dynamic import at run time. Keep it
  // out of the server bundle so Node resolves it from node_modules.
  serverExternalPackages: ["pdfjs-dist"],
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
