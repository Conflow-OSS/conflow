import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Kept in sync with tsconfig.app.json's "paths" — TS only checks
      // types, Vite's bundler needs its own alias resolution separately.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Points at the local BFF (packages/web/server), not the backend
      // directly — dev mode exercises the real proxy + token-injection code
      // path instead of a shortcut that diverges from what actually ships.
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: false,
      },
    },
  },
});
