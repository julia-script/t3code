import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import silk from "@silkui/vite";
import react from "@silkui/react/vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const web = fileURLToPath(new URL("../web", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^~\//, replacement: `${web}/src/` },
    ],
    dedupe: ["react"],
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
    // React's own JSX runtime, which @silkui/react supports. Its own import source lacks
    // `createElement`, which the automatic runtime needs for `<X {...props} key={k} />`.
    { name: "t3-silk:jsx", config: () => ({ oxc: { jsx: { runtime: "automatic", importSource: "react" } } }) },
  ],
});
