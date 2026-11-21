// Browser globals (window, document, ...) for apps/web; first, so they exist before anything runs.
import "@silkui/core/globals";
// The T3 Code desktop app on Silk UI. Electron's main process, preload and IPC collapse into
// this one process: start the local server, give the web code its desktop functions, render.
import { startBackend } from "./desktop/backend";
import { createDesktopBridge } from "./desktop/bridge";
import { installApplicationMenu } from "./desktop/menu";
import { installShims, probing, reportMissingApis, watchErrors, watchStyles } from "./probe";

if (probing) {
  reportMissingApis();
  installShims();
  watchErrors();
}
watchStyles();
const backend = await startBackend();
void installApplicationMenu("T3 Code");
// apps/web decides it is the desktop app when its modules load, so this comes first.
window.desktopBridge = createDesktopBridge(backend);
await (await import("./app")).startup;
