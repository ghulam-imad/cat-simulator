import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The screens live in web/ and are built into dist/web, which the server serves.
// `npm run dev:web` runs Vite's dev server and forwards /api to `npm start` on port 3000.
export default defineConfig({
  root: "web",
  plugins: [react()],
  // KaTeX makes the bundle ~640 kB; fine on a home network.
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: { proxy: { "/api": "http://localhost:3000" } },
});
