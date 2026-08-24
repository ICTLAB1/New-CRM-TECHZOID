import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    /* NOT in production. Source maps are 6.5MB of an 8.5MB deploy — more
       than three times the app itself — and they publish the complete
       readable TypeScript source, comments and all, at a guessable URL next
       to every bundle. Neither is something to ship to a customer-facing
       site. `npx vite build --sourcemap` still produces them when a
       production bug actually needs one. */
    sourcemap: false,
  },
  /* Test configuration lives in vitest.config.ts, which takes precedence
     over this file. Keeping a second copy here is how the two drift. */
});
