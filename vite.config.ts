import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": "/src" },
  },
  build: {
    target: "esnext",
    // Dexie uses IndexedDB — no special polyfills needed for modern browsers
  },
});

