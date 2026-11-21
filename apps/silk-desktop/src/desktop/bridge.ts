// The desktop functions apps/web calls as `window.desktopBridge`. In Electron they live in the
// main process behind preload and IPC; here the window's JavaScript runs in the app process,
// so each one is a plain function over Node's APIs. What Silk UI cannot do from JavaScript yet
// (native dialogs and menus, the browser panel, window state) answers as unsupported.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import {
  appWindow,
  openExternal,
  setBadge,
  showContextMenu,
  showOpenDialog,
  startFileDrag,
  type MenuItem,
} from "@silkui/core";
import { showContextMenuFallback } from "~/contextMenuFallback";
import { PROJECT_FAVICON_EXTENSIONS } from "@t3tools/shared/projectFavicon";

import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type ClientSettings,
  type ContextMenuItem,
  type DesktopBridge,
  type DesktopEnvironmentBootstrap,
  type DesktopUpdateState,
} from "@t3tools/contracts";

import { bearerToken, type Backend } from "./backend";
import { menuActions } from "./menu";
import { createPreviewBridge } from "./preview";

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
const cliOff = { supported: false, installedPath: null, onPath: false, launcherPath: null };

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

const PICKED_THEME_FILE_MAX_BYTES = 256 * 1024;

async function pickPaths(options: Parameters<typeof showOpenDialog>[0]): Promise<string[] | null> {
  const result = await showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
}

/** apps/web's menu items as a native menu; resolves to the chosen item's id. */
async function contextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  let chosen: T | null = null;
  const template = (list: readonly ContextMenuItem<T>[]): MenuItem[] =>
    list.flatMap((item): MenuItem[] => [
      ...(item.separatorBefore ? [{ type: "separator" } satisfies MenuItem] : []),
      item.children
        ? { label: item.label, submenu: template(item.children) }
        : {
            label: item.label,
            enabled: !item.disabled && !item.header,
            ...(item.checked === undefined ? {} : { type: "checkbox", checked: item.checked }),
            click: () => {
              chosen = item.id;
            },
          },
    ]);
  const shown = await showContextMenu(template(items), position);
  // Where the system has no menu, apps/web draws its own, as it does in a browser.
  return shown ? chosen : showContextMenuFallback(items, position);
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

  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : "other";
  const updatesOff = {
    enabled: false,
    status: "disabled",
    channel: "latest",
    currentVersion: "0.0.0",
    hostArch: arch,
    appArch: arch,
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  } satisfies DesktopUpdateState;

  const bridge: DesktopBridge = {
    getAppBranding: () => ({ baseName: "T3 Code", stageLabel: "Dev", displayName: "T3 Code (Silk UI)" }),
    getRelayTelemetryEnabled: () => false,
    getPathForFile: (file) => (file as File & { path?: string }).path ?? unsupported("getPathForFile"),
    getClientPlatform: () => process.platform,
    setNotificationBadge: async ({ count }) => {
      await setBadge(count > 0 ? String(count) : "");
    },
    onNotificationBadgeClear: noUnsubscribe,
    onTrackpadScrollBegin: noUnsubscribe,
    onTrackpadScrollEnd: noUnsubscribe,
    revealWindow: async () => appWindow.focus(),
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

    openExternal: (url) => openExternal(url),
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
    getWindowFullscreenState: () => appWindow.isFullScreen(),
    onWindowFullscreenStateChange: (listener) => {
      const handler = (event: { fullScreen: boolean }) => listener(event.fullScreen);
      appWindow.addEventListener("fullscreenchange", handler);
      return () => appWindow.removeEventListener("fullscreenchange", handler);
    },
    getWindowZoomFactor: () => appWindow.getZoomFactor(),
    onMenuAction: (listener) => menuActions.subscribe(listener),
    onQuitShortcut: noUnsubscribe,
    pasteAsText: rejects("pasteAsText"),

    pickFolder: async (options) =>
      (
        await pickPaths({
          properties: ["openDirectory", "createDirectory"],
          ...(options?.initialPath ? { defaultPath: options.initialPath } : {}),
        })
      )?.[0] ?? null,
    pickProjectFavicon: async (initialPath) =>
      (
        await pickPaths({
          properties: ["openFile"],
          ...(initialPath ? { defaultPath: initialPath } : {}),
          filters: [
            { name: "Images", extensions: PROJECT_FAVICON_EXTENSIONS.map((extension) => extension.slice(1)) },
          ],
        })
      )?.[0] ?? null,
    pickThemeFiles: async () => {
      const paths = await pickPaths({
        properties: ["openFile", "multiSelections"],
        defaultPath: join(homedir(), ".vscode", "extensions"),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      return (
        paths?.map((path) => {
          const name = basename(path);
          try {
            const size = statSync(path).size;
            return { name, size, text: size > PICKED_THEME_FILE_MAX_BYTES ? "" : readFileSync(path, "utf8") };
          } catch {
            return { name, size: 0, text: "" };
          }
        }) ?? null
      );
    },
    showContextMenu: (items, position) => contextMenu(items, position),
    // The local backend shares this machine's files, so its path is the path to drag.
    startFileDrag: ({ path }) => startFileDrag(path),
    setTheme: async () => {},
    toLocalBackendPath: async (_backendId, path) => path,

    // Not part of this port: SSH hosts, WSL, server exposure, Snap Shot, updates, CLI shim.
    requestSnapShotPermissions: rejects("requestSnapShotPermissions"),
    getSnapShotState: async () => ({
      mode: "unavailable",
      shortcut: { kind: "both-shift-keys" },
      shortcutRegistered: false,
      shortcutMessage: null,
      message: "Snap Shot is not part of the Silk UI desktop app yet.",
    }),
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
    // The server listens on loopback only; network access is not part of this port.
    getServerExposureState: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    }),
    setServerExposureMode: rejects("setServerExposureMode"),
    setTailscaleServeEnabled: rejects("setTailscaleServeEnabled"),
    getAdvertisedEndpoints: async () => [],
    getWslState: async () => ({
      enabled: false,
      distro: null,
      available: false,
      wslOnly: false,
      distros: [],
      preflightError: null,
    }),
    setWslBackendEnabled: rejects("setWslBackendEnabled"),
    setWslDistro: rejects("setWslDistro"),
    setWslOnly: rejects("setWslOnly"),
    receiveProviderAuthCallback: rejects("receiveProviderAuthCallback"),
    cancelProviderAuthCallback: async () => {},
    getUpdateState: async () => updatesOff,
    setUpdateChannel: rejects("setUpdateChannel"),
    checkForUpdate: rejects("checkForUpdate"),
    downloadUpdate: rejects("downloadUpdate"),
    installUpdate: rejects("installUpdate"),
    onUpdateState: noUnsubscribe,
    cliCommand: {
      getState: async () => cliOff,
      install: rejects("cliCommand.install"),
      uninstall: rejects("cliCommand.uninstall"),
      addToPath: rejects("cliCommand.addToPath"),
    },
    webLinks: { setReady: async () => {}, onOpen: noUnsubscribe },
    appActivation: { setReady: async () => {}, complete: async () => {}, onRequest: noUnsubscribe },

    // The browser panel, on Silk UI web views.
    preview: createPreviewBridge(),
  };
  return bridge;
}
