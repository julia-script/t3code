// The browser panel's desktop side. In Electron each tab is a <webview> guest that main drives
// by webContentsId; here a tab is a Silk UI WebView, driven directly from this process.
import { clearWebViewData, type WebView, type WebViewEvent } from "@silkui/core";

import type {
  DesktopPreviewBridge,
  DesktopPreviewColorScheme,
  DesktopPreviewFindResultEvent,
  DesktopPreviewOpenLinkEvent,
  DesktopPreviewTabState,
} from "@t3tools/contracts";

/** Mounted views by id; the id stands in for Electron's webContentsId. */
const mounted = new Map<number, WebView>();
export const webViews = {
  register(view: WebView): number {
    mounted.set(view.id, view);
    return view.id;
  },
  unregister(view: WebView) {
    if (mounted.get(view.id) === view) mounted.delete(view.id);
  },
};

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

interface Tab {
  state: DesktopPreviewTabState;
  view: WebView | null;
  detach: () => void;
}

class PreviewUnsupported extends Error {
  constructor(name: string) {
    super(`preview.${name} is not available in the Silk UI desktop app yet`);
    this.name = "Unsupported";
  }
}

function listeners<T extends unknown[]>() {
  const set = new Set<(...args: T) => void>();
  return {
    emit: (...args: T) => {
      for (const listener of set) listener(...args);
    },
    subscribe: (listener: (...args: T) => void) => {
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
}

export function createPreviewBridge(): DesktopPreviewBridge {
  const tabs = new Map<string, Tab>();
  const stateChange = listeners<[string, DesktopPreviewTabState]>();
  const openLink = listeners<[DesktopPreviewOpenLinkEvent]>();
  const findResult = listeners<[DesktopPreviewFindResultEvent]>();
  const none = () => () => {};
  const rejects =
    (name: string) =>
    async (): Promise<never> => {
      throw new PreviewUnsupported(name);
    };

  const tab = (tabId: string) => {
    const found = tabs.get(tabId);
    if (!found) throw new Error(`No preview tab ${tabId}`);
    return found;
  };
  const update = (entry: Tab, patch: Partial<DesktopPreviewTabState>) => {
    entry.state = { ...entry.state, ...patch, updatedAt: new Date().toISOString() };
    stateChange.emit(entry.state.tabId, entry.state);
  };
  const withView = (tabId: string, run: (view: WebView, entry: Tab) => void) => async () => {
    const entry = tab(tabId);
    if (entry.view) run(entry.view, entry);
  };
  const setZoom = (tabId: string, zoomFactor: number) => {
    const entry = tab(tabId);
    entry.view?.setZoom(zoomFactor);
    update(entry, { zoomFactor });
  };
  const stepZoom = (tabId: string, direction: 1 | -1) => {
    const current = tab(tabId).state.zoomFactor;
    const next =
      direction > 0
        ? (ZOOM_STEPS.find((step) => step > current + 0.001) ?? current)
        : ([...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? current);
    setZoom(tabId, next);
  };

  const attach = (entry: Tab, view: WebView) => {
    const { tabId } = entry.state;
    const page = () => ({ url: view.url, title: view.title || view.url });
    const on: Record<string, (event: WebViewEvent) => void> = {
      loadstart: () => update(entry, { navStatus: { kind: "Loading", ...page() } }),
      loadend: (event) =>
        update(entry, {
          navStatus: event.ok
            ? { kind: "Success", ...page() }
            : { kind: "LoadFailed", ...page(), code: -2, description: event.error ?? "" },
        }),
      urlchange: () => {
        const status = entry.state.navStatus;
        if (status.kind !== "Idle") update(entry, { navStatus: { ...status, ...page() } });
      },
      titlechange: () => {
        const status = entry.state.navStatus;
        if (status.kind !== "Idle") update(entry, { navStatus: { ...status, title: page().title } });
      },
      historychange: () =>
        update(entry, { canGoBack: view.canGoBack, canGoForward: view.canGoForward }),
      faviconchange: () => {
        // apps/web wants a data URL; Silk UI reports the icon's URL, which the panel can't load.
        if (view.favicon.startsWith("data:")) {
          update(entry, {
            favicon: { dataUrl: view.favicon, pageUrl: view.url, capturedAt: Date.now() },
          });
        }
      },
      newwindow: (event) => openLink.emit({ tabId, url: event.url ?? "", background: false }),
    };
    for (const [type, listener] of Object.entries(on)) view.addEventListener(type, listener);
    entry.view = view;
    entry.detach = () => {
      for (const [type, listener] of Object.entries(on)) view.removeEventListener(type, listener);
      if (entry.view === view) entry.view = null;
    };
    view.setZoom(entry.state.zoomFactor);
    view.setColorScheme(entry.state.colorScheme);
    view.setAudioMuted(entry.state.audioMuted);
    update(entry, {
      webContentsId: view.id,
      canGoBack: view.canGoBack,
      canGoForward: view.canGoForward,
      ...(view.url ? { navStatus: { kind: view.loading ? "Loading" : "Success", ...page() } } : {}),
    });
  };

  return {
    setForwardedShortcuts: async () => {},
    createTab: async (tabId, defaults) => {
      if (tabs.has(tabId)) return;
      const entry: Tab = {
        view: null,
        detach: () => {},
        state: {
          tabId,
          webContentsId: null,
          navStatus: { kind: "Idle" },
          canGoBack: false,
          canGoForward: false,
          zoomFactor: defaults?.zoomFactor ?? 1,
          pictureInPicture: false,
          colorScheme: defaults?.colorScheme ?? "system",
          audioMuted: false,
          audible: false,
          controller: "none",
          capturing: false,
          updatedAt: new Date().toISOString(),
        },
      };
      tabs.set(tabId, entry);
      stateChange.emit(tabId, entry.state);
    },
    closeTab: async (tabId) => {
      tabs.get(tabId)?.detach();
      tabs.delete(tabId);
    },
    registerWebview: async (tabId, webContentsId) => {
      const entry = tab(tabId);
      const view = mounted.get(webContentsId);
      if (!view) throw new Error(`No web view ${webContentsId}`);
      if (entry.view === view) return;
      entry.detach();
      attach(entry, view);
    },
    navigate: async (tabId, url) => {
      const entry = tab(tabId);
      entry.view?.navigate(url);
      update(entry, { navStatus: { kind: "Loading", url, title: url } });
    },
    goBack: (tabId) => withView(tabId, (view) => view.back())(),
    goForward: (tabId) => withView(tabId, (view) => view.forward())(),
    refresh: (tabId) => withView(tabId, (view) => view.reload())(),
    stopLoading: (tabId) => withView(tabId, (view) => view.stop())(),
    hardReload: (tabId) => withView(tabId, (view) => view.hardReload())(),
    zoomIn: async (tabId) => stepZoom(tabId, 1),
    zoomOut: async (tabId) => stepZoom(tabId, -1),
    resetZoom: async (tabId) => setZoom(tabId, 1),
    setZoomFactor: async (tabId, zoomFactor) => setZoom(tabId, zoomFactor),
    setColorScheme: async (tabId, colorScheme: DesktopPreviewColorScheme) => {
      const entry = tab(tabId);
      entry.view?.setColorScheme(colorScheme);
      update(entry, { colorScheme });
    },
    setAudioMuted: async (tabId, audioMuted) => {
      const entry = tab(tabId);
      entry.view?.setAudioMuted(audioMuted);
      update(entry, { audioMuted });
    },
    findInPage: async (tabId, text, options) => {
      const view = tab(tabId).view;
      if (!view) return;
      const result = await view.findInPage(text, options);
      findResult.emit({ tabId, ...result });
    },
    stopFindInPage: (tabId) => withView(tabId, (view) => view.stopFindInPage())(),
    setShown: (tabId, shown) => withView(tabId, (view) => view.setShown(shown))(),
    setCaptureDrawn: async () => {},
    openDevTools: (tabId) => withView(tabId, (view) => view.openDevTools())(),
    clearCookies: async (_environmentId, profileId) =>
      clearWebViewData({ profile: profileId ?? "default", cookies: true }),
    clearCache: async (_environmentId, profileId) =>
      clearWebViewData({ profile: profileId ?? "default", cache: true }),
    getPreviewConfig: async (_environmentId, profileId) => ({
      partition: profileId ?? "default",
      webPreferences: "",
      preloadUrl: null,
    }),
    onTunnelAccessRequest: none,
    resolveTunnelAccess: async () => {},
    // The local environment shares this machine's loopback; remote ones are not part of this port.
    forwardPort: rejects("forwardPort"),
    stopPortForward: async () => {},
    listPortForwards: async () => [],
    sharesLoopback: async () => true,
    onPortForwards: none,
    listBrowserImportSources: async () => [],
    importBrowserCookies: rejects("importBrowserCookies"),
    setAnnotationTheme: async () => {},
    setAnnotationSendEnabled: async () => {},
    annotationVoice: { onEvent: none, update: async () => {} },
    pickElement: rejects("pickElement"),
    cancelPickElement: async () => {},
    captureScreenshot: rejects("captureScreenshot"),
    revealArtifact: rejects("revealArtifact"),
    copyArtifactToClipboard: rejects("copyArtifactToClipboard"),
    pictureInPicture: { open: rejects("pictureInPicture.open"), close: async () => {} },
    recording: {
      onInput: none,
      startScreencast: rejects("recording.startScreencast"),
      stopScreencast: async () => {},
      save: rejects("recording.save"),
    },
    onStateChange: (listener) => stateChange.subscribe(listener),
    onPointerEvent: none,
    onOpenLink: (listener) => openLink.subscribe(listener),
    onFindResult: (listener) => findResult.subscribe(listener),
  };
}
