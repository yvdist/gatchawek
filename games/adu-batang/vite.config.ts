import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One Worker serves both the SPA (Workers Static Assets) and the API/DOs.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
