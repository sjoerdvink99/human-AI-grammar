import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.PORT ?? "8791";

export default defineConfig({
  plugins: [react()],
  server: { port: 5179, proxy: { "/api": `http://localhost:${apiPort}` } },
});
