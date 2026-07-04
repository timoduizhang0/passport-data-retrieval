import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// 注入打包日期（格式：YYYY-MM-DD）
const buildDate = new Date().toISOString().split("T")[0];

export default defineConfig({
  clearScreen: false,
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
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
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});