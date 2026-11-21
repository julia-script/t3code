# T3 Code on Silk UI

The desktop app with [Silk UI](https://github.com/silk-lang/SilkUI) in place of Electron. It
renders `apps/web` unchanged on `@silkui/react`, and starts the same local server the
Electron app starts. There is no preload or IPC: the window's JavaScript runs in the app
process, so `window.desktopBridge` is plain functions (`src/desktop/bridge.ts`).

```sh
vp i                    # from the repository root
cd apps/silk-desktop
../../node_modules/.bin/vp build   # the bundle, which the Silk tasks take as it is
silk task dev           # opens the window
```

The app keeps its state in `~/.t3-silk` (`T3CODE_HOME` overrides it), never in an installed
T3 Code's home. The server runs with `node` from `PATH` (`T3CODE_NODE` overrides it).

Until `@silkui/*` 0.1.11 is on npm, build the bundle against a SilkUI checkout at the commit
`silk.toml` pins: `npm ci` in its `modules/js`, then
`SILK_PACKAGES=<SilkUI>/modules/js/packages ../../node_modules/.bin/vp build`.

`vp build` builds only the bundle (`dist/app.js`, `dist/app.sheet`)
and prints the browser APIs the bundle uses that the runtime lacks.
