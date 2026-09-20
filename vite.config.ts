import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// @ts-expect-error The JavaScript helper does not currently have a declaration file.
import { generateLogoComponent } from "./scripts/generate-logo.js";

function upsedLogoSync() {
  return {
    name: "upsed-logo-sync",
    buildStart() {
      generateLogoComponent();
    },
    handleHotUpdate({ file }: { file: string }) {
      if (file.endsWith("upsed.svg") || file.endsWith("upsed-dark.svg")) {
        generateLogoComponent();
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    upsedLogoSync(),
    react(),
    tailwindcss(),
    {
      name: "html-react-devtools",
      apply: "serve",
      transformIndexHtml() {
        return [
          {
            tag: "script",
            attrs: { src: "http://localhost:8097" },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
