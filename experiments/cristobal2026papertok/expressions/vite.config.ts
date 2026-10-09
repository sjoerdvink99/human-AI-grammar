import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3001", timeout: 0, proxyTimeout: 0 }, "/media": "http://localhost:3001" },
  },
});
