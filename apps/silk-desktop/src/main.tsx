// The T3 Code desktop app on Silk UI. Electron's main process, preload and IPC collapse into
// this one process: start the local server, give the web code its desktop functions, render.
import { startBackend } from "./desktop/backend";
import { createDesktopBridge } from "./desktop/bridge";

const backend = await startBackend();
// apps/web decides it is the desktop app when its modules load, so this comes first.
window.desktopBridge = createDesktopBridge(backend);
await (await import("./app")).startup;
