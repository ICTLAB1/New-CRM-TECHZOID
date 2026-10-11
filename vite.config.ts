import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    /* THE CRM AS AN APP. Installable from the browser on iPhone and Android
       (Add to Home Screen / Install app), opens full-screen with its own
       icon, and opens with no network: the service worker keeps the app
       itself, and src/data/offline.ts keeps the data and the changes made
       while offline. The API is never cached here — data goes through the
       offline layer, which knows what is safe to show. */
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "TechZoid CRM",
        short_name: "TechZoid",
        description: "TechZoid sales, quotations, orders and invoices.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#EEF1F6",
        theme_color: "#0176D3",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
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
