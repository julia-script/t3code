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
  "@silkui/core/globals": "core/src/globals.js",
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

// apps/web's browser panel imports its Electron <webview> host relatively; use the Silk UI one.
const hostedWebview = resolve(web, "src/browser/HostedBrowserWebview.tsx");
const silkWebview = fileURLToPath(new URL("src/browser/HostedBrowserWebview.tsx", import.meta.url));
const browserHost: Plugin = {
  name: "silk-desktop-browser-host",
  enforce: "pre",
  async resolveId(id, importer, options) {
    // The copy keeps apps/web's dependencies, so they resolve from apps/web.
    if (importer === silkWebview && !id.startsWith(".") && !id.startsWith("~/") && !id.startsWith("@silkui/")) {
      return this.resolve(id, hostedWebview, { ...options, skipSelf: true });
    }
    if (!importer?.startsWith(resolve(web, "src")) || !/HostedBrowserWebview(\.tsx)?$/.test(id)) return null;
    const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
    return resolved?.id === hostedWebview ? silkWebview : null;
  },
};

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${web}/src/` },
      // gt-react's default export condition is its server entry, which refuses to start an SPA.
      {
        find: /^gt-react$/,
        replacement: createRequire(resolve(web, "package.json"))
          .resolve("gt-react")
          .replace(/index\.server\.(c?js|mjs)$/, "index.client.mjs"),
      },
      ...Object.entries(entries).map(([id, file]) => ({
        find: new RegExp(`^${id.replaceAll("/", "\\/")}$`),
        replacement: local ? source(file) : installed(id),
      })),
    ],
    dedupe: ["react", "react-reconciler", "scheduler"],
  },
  plugins: [
    browserHost,
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
