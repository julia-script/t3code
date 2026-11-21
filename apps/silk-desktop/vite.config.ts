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
const load = async <T>(npm: string, file: string): Promise<T> =>
  (await import(local ? pathToFileURL(source(file)).href : npm)).default as T;

type PluginFactory = (options?: Record<string, unknown>) => Plugin | Plugin[];
const silk = await load<PluginFactory>("@silkui/vite", "vite/src/index.js");
const react = await load<PluginFactory>("@silkui/react/vite", "react/src/vite.js");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${web}/src/` },
      ...(local
        ? [
            { find: /^@silkui\/core$/, replacement: source("core/src/index.js") },
            { find: /^@silkui\/react$/, replacement: source("react/src/index.js") },
            { find: /^@silkui\/react\/jsx-runtime$/, replacement: source("react/src/jsx-runtime.js") },
            { find: /^@silkui\/react\/jsx-dev-runtime$/, replacement: source("react/src/jsx-dev-runtime.js") },
            { find: /^@silkui\/react\/dom$/, replacement: source("react/src/dom.js") },
          ]
        : []),
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
