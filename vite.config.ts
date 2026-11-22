/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed port and ignores the dev server being unavailable.
//
// `host` is pinned to the IPv4 loopback on purpose. Vite's default resolves
// `localhost` through Node's verbatim DNS order, which on macOS picks `::1`
// first, so the server ends up listening on IPv6 loopback only. Chrome falls
// back to `::1` and loads, which hides the problem; the WKWebView Tauri embeds
// does not, so the window stays blank and loads forever even though the server
// is up. Binding IPv4 and pointing `devUrl` at the same literal address removes
// the resolver from the path entirely.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    environment: "node",
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "safari15",
    minify: "esbuild",
    sourcemap: false,
  },
});
