import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const web = fileURLToPath(new URL("../web", import.meta.url));

// SILK_PACKAGES=<SilkUI>/modules/js/packages builds against a SilkUI checkout instead of the
// npm packages, as @silkui/react's README describes, for a host built from that checkout.
const local = process.env.SILK_PACKAGES;
const source = (file: string) => resolve(local ?? "", file);
// apps/web's modules import the renderer through JSX, but only this package depends on it.
const installed = createRequire(import.meta.url).resolve;
const entries = {
  "@silkui/core": "core/src/index.js",
  "@silkui/react": "react/src/index.js",
  "@silkui/react/jsx-runtime": "react/src/jsx-runtime.js",
  "@silkui/react/jsx-dev-runtime": "react/src/jsx-dev-runtime.js",
  "@silkui/react/dom": "react/src/dom.js",
};
const load = async <T>(npm: string, file: string): Promise<T> =>
  (await import(local ? pathToFileURL(source(file)).href : npm)).default as T;

type PluginFactory = (options?: Record<string, unknown>) => Plugin | Plugin[];
const silk = await load<PluginFactory>("@silkui/vite", "vite/src/index.js");
const react = await load<PluginFactory>("@silkui/react/vite", "react/src/vite.js");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${web}/src/` },
      ...Object.entries(entries).map(([id, file]) => ({
        find: new RegExp(`^${id.replaceAll("/", "\\/")}$`),
        replacement: local ? source(file) : installed(id),
      })),
    ],
    dedupe: ["react", "react-reconciler", "scheduler"],
  },
  plugins: [
    tanstackRouter({
      autoCodeSplitting: false,
      routesDirectory: `${web}/src/routes`,
      generatedRouteTree: `${web}/src/routeTree.gen.ts`,
    }),
    tailwindcss(),
    silk({ entry: "src/main.tsx", node: true }),
    react(),
  ],
});
