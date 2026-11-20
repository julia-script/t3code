// The desktop functions apps/web calls as `window.desktopBridge`. In Electron they live in the
// main process behind preload and IPC; here the window's JavaScript runs in the app process,
// so each one is a plain function over Node's APIs. What Silk UI cannot do from JavaScript yet
// (native dialogs and menus, the browser panel, window state) answers as unsupported.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type ClientSettings,
  type DesktopBridge,
  type DesktopEnvironmentBootstrap,
} from "@t3tools/contracts";

import { bearerToken, type Backend } from "./backend";

class Unsupported extends Error {
  constructor(name: string) {
    super(`${name} is not available in the Silk UI desktop app yet`);
    this.name = "Unsupported";
  }
}

const warned = new Set<string>();
function unsupported(name: string): never {
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[silk-desktop] ${name}: not available yet`);
  }
  throw new Unsupported(name);
}

const rejects =
  (name: string) =>
  async (..._args: unknown[]): Promise<never> =>
    unsupported(name);
const noUnsubscribe = () => () => {};

/** Every method of a part not built yet: listeners register nowhere, calls reject. */
function unsupportedPart<T extends object>(part: string): T {
  return new Proxy({} as T, {
    get: (_target, name) => {
      if (typeof name !== "string" || name === "then") return undefined;
      return name.startsWith("on") ? noUnsubscribe : rejects(`${part}.${name}`);
    },
  });
}

function jsonStore<T>(file: string) {
  return {
    read(): T | null {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
      } catch {
        return null;
      }
    },
    write(value: T) {
      writeFileSync(file, JSON.stringify(value, null, 2));
    },
  };
}

function openWithSystem(target: string): Promise<boolean> {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => done(false));
    child.once("spawn", () => {
      child.unref();
      done(true);
    });
  });
}

export function createDesktopBridge(backend: Backend): DesktopBridge {
  const state = join(backend.t3Home, "silk-desktop");
  mkdirSync(state, { recursive: true });
  const clientSettings = jsonStore<ClientSettings>(join(state, "client-settings.json"));
  const connectionCatalog = jsonStore<{ catalog: string }>(join(state, "connection-catalog.json"));
  const flags = jsonStore<{ localEnvironmentEnabled?: boolean }>(join(state, "flags.json"));

  const primary: DesktopEnvironmentBootstrap = {
    id: PRIMARY_LOCAL_ENVIRONMENT_ID,
    label: "This Mac",
    httpBaseUrl: backend.httpBaseUrl,
    wsBaseUrl: backend.wsBaseUrl,
    bootstrapToken: backend.bootstrapToken,
  };
  if (process.platform !== "darwin") primary.label = "This computer";

  let token: Promise<string> | null = null;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;

  const bridge: DesktopBridge = {
    getAppBranding: () => ({ baseName: "T3 Code", stageLabel: "Dev", displayName: "T3 Code (Silk UI)" }),
    getRelayTelemetryEnabled: () => false,
    getPathForFile: (file) => (file as File & { path?: string }).path ?? unsupported("getPathForFile"),
    getClientPlatform: () => process.platform,
    setNotificationBadge: async () => {},
    onNotificationBadgeClear: noUnsubscribe,
    onTrackpadScrollBegin: noUnsubscribe,
    onTrackpadScrollEnd: noUnsubscribe,
    revealWindow: async () => {},
    getSystemLocale: () => locale,
    getPreferredSystemLanguages: () => [locale],
    getPrimaryPasteEnabled: () => true,

    getLocalEnvironmentBootstraps: () =>
      flags.read()?.localEnvironmentEnabled === false ? [] : [primary],
    getLocalEnvironmentEnabled: () => flags.read()?.localEnvironmentEnabled !== false,
    setLocalEnvironmentEnabled: async (enabled) => {
      flags.write({ ...flags.read(), localEnvironmentEnabled: enabled });
    },
    getHostEnvironmentId: async () => null,
    getLocalEnvironmentBearerToken: () => {
      token ??= bearerToken(backend).catch((error: unknown) => {
        token = null;
        throw error;
      });
      return token;
    },
    getClientSettings: async () => clientSettings.read(),
    setClientSettings: async (settings) => clientSettings.write(settings),
    getConnectionCatalog: async () => connectionCatalog.read()?.catalog ?? null,
    setConnectionCatalog: async (catalog) => {
      connectionCatalog.write({ catalog });
      return true;
    },

    openExternal: (url) => openWithSystem(url),
    openSystemSettings: rejects("openSystemSettings"),
    checkSystemPermission: async () => true,
    probeRemoteEditors: async () => [],
    readMedia: async (url) => {
      try {
        const response = await fetch(url);
        return {
          status: response.status,
          mimeType: response.headers.get("content-type") ?? "application/octet-stream",
          data: new Uint8Array(await response.arrayBuffer()),
        };
      } catch {
        return null;
      }
    },

    // Window state: Silk UI has no JavaScript API for these yet.
    getWindowFullscreenState: () => false,
    onWindowFullscreenStateChange: noUnsubscribe,
    getWindowZoomFactor: () => 1,
    onMenuAction: noUnsubscribe,
    onQuitShortcut: noUnsubscribe,
    pasteAsText: rejects("pasteAsText"),

    // Native dialogs, menus and drags: waiting on Silk UI desktop APIs.
    pickFolder: rejects("pickFolder"),
    pickProjectFavicon: rejects("pickProjectFavicon"),
    pickThemeFiles: rejects("pickThemeFiles"),
    showContextMenu: rejects("showContextMenu"),
    startFileDrag: async () => false,
    setTheme: async () => {},
    toLocalBackendPath: async (_backendId, path) => path,

    // Not part of this port: SSH hosts, WSL, server exposure, Snap Shot, updates, CLI shim.
    requestSnapShotPermissions: rejects("requestSnapShotPermissions"),
    getSnapShotState: rejects("getSnapShotState"),
    setupSnapShot: rejects("setupSnapShot"),
    previewSnapShotConfig: rejects("previewSnapShotConfig"),
    applySnapShotConfig: rejects("applySnapShotConfig"),
    checkSnapShotShortcut: rejects("checkSnapShotShortcut"),
    setSnapShotShortcutSuppressed: async () => {},
    listPendingSnapShots: async () => [],
    readSnapShot: rejects("readSnapShot"),
    setSnapShotAnimationDestination: async () => {},
    dismissSnapShotAnimation: async () => {},
    acknowledgeSnapShot: async () => {},
    onSnapShotEvent: noUnsubscribe,
    discoverSshHosts: async () => [],
    resolveSshHost: rejects("resolveSshHost"),
    ensureSshEnvironment: rejects("ensureSshEnvironment"),
    disconnectSshEnvironment: rejects("disconnectSshEnvironment"),
    fetchSshEnvironmentDescriptor: rejects("fetchSshEnvironmentDescriptor"),
    bootstrapSshBearerSession: rejects("bootstrapSshBearerSession"),
    fetchSshSessionState: rejects("fetchSshSessionState"),
    onSshPasswordPrompt: noUnsubscribe,
    onSshPasswordPromptSettled: noUnsubscribe,
    resolveSshPasswordPrompt: rejects("resolveSshPasswordPrompt"),
    getServerExposureState: rejects("getServerExposureState"),
    setServerExposureMode: rejects("setServerExposureMode"),
    setTailscaleServeEnabled: rejects("setTailscaleServeEnabled"),
    getAdvertisedEndpoints: async () => [],
    getWslState: rejects("getWslState"),
    setWslBackendEnabled: rejects("setWslBackendEnabled"),
    setWslDistro: rejects("setWslDistro"),
    setWslOnly: rejects("setWslOnly"),
    receiveProviderAuthCallback: rejects("receiveProviderAuthCallback"),
    cancelProviderAuthCallback: async () => {},
    getUpdateState: rejects("getUpdateState"),
    setUpdateChannel: rejects("setUpdateChannel"),
    checkForUpdate: rejects("checkForUpdate"),
    downloadUpdate: rejects("downloadUpdate"),
    installUpdate: rejects("installUpdate"),
    onUpdateState: noUnsubscribe,
    cliCommand: unsupportedPart("cliCommand"),
    webLinks: { setReady: async () => {}, onOpen: noUnsubscribe },
    appActivation: { setReady: async () => {}, complete: async () => {}, onRequest: noUnsubscribe },

    // The browser panel: waiting on the Silk UI webview.
    preview: unsupportedPart("preview"),
  };
  return bridge;
}
