import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "netlify/**/*.test.mjs", "api/**/*.test.mjs"],
    /* `api/netlify` is a symlink to `netlify/`, so the function handlers
       resolve from inside the deployment root. Without this, every test
       under netlify/ is discovered twice — once by each path — which does
       not find a single extra bug and doubles the time it takes not to. */
    exclude: ["**/node_modules/**", "**/dist/**", "api/netlify/**"],
  },
});
