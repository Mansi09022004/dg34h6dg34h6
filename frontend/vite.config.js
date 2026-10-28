import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, forward /api to the FastAPI server so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": process.env.API_URL || "http://localhost:8000" } },
});
