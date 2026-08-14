import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT/BASE_PATH were previously required, because Replit's workflow always
// injected them. That made `vite build` impossible anywhere else — including a
// CI/CD build step on Render — so both now fall back to sensible defaults.
// PORT only affects the local dev/preview server, never the build output.
const rawPort = process.env.PORT;
const parsedPort = rawPort ? Number(rawPort) : NaN;
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 5173;

// "/" is correct when the app is served from the root of its own domain, which
// is how it's deployed outside Replit. Override BASE_PATH only if the app is
// ever hosted under a sub-path.
const basePath = process.env.BASE_PATH || "/";

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // Replit's dev-only error overlay — kept for local use but excluded from
    // production bundles so a Replit tool isn't shipped to end users.
    ...(isProduction ? [] : [runtimeErrorOverlay()]),
    ...(!isProduction &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
