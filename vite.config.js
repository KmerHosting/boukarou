import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://127.0.0.1:3260", ws: true } },
  },
});
