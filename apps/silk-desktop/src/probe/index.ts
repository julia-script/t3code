// Investigation only, on with T3_SILK_PROBE=1: lists the browser APIs apps/web uses that this
// realm lacks, shims the ones that stop the app from rendering at all, and walks every static
// route so one headless run collects every gap. Not a fix: each shim here is a reported gap.
type Check = readonly [name: string, test: () => unknown];

const el = () => document.createElement("div") as unknown as Record<string, unknown>;
const w = window as unknown as Record<string, unknown>;
const nav = () => (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator ?? {};

const CHECKS: ReadonlyArray<Check> = [
  ["window.navigation", () => w.navigation],
  ["matchMedia", () => w.matchMedia],
  ["ResizeObserver", () => w.ResizeObserver],
  ["IntersectionObserver", () => w.IntersectionObserver],
  ["MutationObserver", () => w.MutationObserver],
  ["requestAnimationFrame", () => w.requestAnimationFrame],
  ["requestIdleCallback", () => w.requestIdleCallback],
  ["getComputedStyle", () => w.getComputedStyle],
  ["getSelection", () => w.getSelection ?? (document as unknown as Record<string, unknown>).getSelection],
  ["document.createRange", () => (document as unknown as Record<string, unknown>).createRange],
  ["document.elementFromPoint", () => (document as unknown as Record<string, unknown>).elementFromPoint],
  ["document.activeElement (key)", () => "activeElement" in document],
  ["document.hasFocus", () => (document as unknown as Record<string, unknown>).hasFocus],
  ["document.visibilityState", () => (document as unknown as Record<string, unknown>).visibilityState],
  ["document.fonts", () => (document as unknown as Record<string, unknown>).fonts],
  ["document.execCommand", () => (document as unknown as Record<string, unknown>).execCommand],
  ["Element.closest", () => el().closest],
  ["Element.matches", () => el().matches],
  ["Element.getBoundingClientRect", () => el().getBoundingClientRect],
  ["Element.getClientRects", () => el().getClientRects],
  ["Element.scrollIntoView", () => el().scrollIntoView],
  ["Element.setPointerCapture", () => el().setPointerCapture],
  ["Element.getAnimations", () => el().getAnimations],
  ["Element.animate", () => el().animate],
  ["Element.showPopover", () => el().showPopover],
  ["Element.attachShadow", () => el().attachShadow],
  ["Element.inert (key)", () => "inert" in el()],
  ["Element.style.setProperty", () => (el().style as Record<string, unknown> | undefined)?.setProperty],
  ["Element.dataset", () => el().dataset],
  ["navigator.platform", () => nav().platform],
  ["navigator.userAgent", () => nav().userAgent],
  ["navigator.language", () => nav().language],
  ["navigator.onLine (key)", () => "onLine" in nav()],
  ["navigator.clipboard", () => nav().clipboard],
  ["navigator.mediaDevices", () => nav().mediaDevices],
  ["ClipboardItem", () => w.ClipboardItem],
  ["Notification", () => w.Notification],
  ["localStorage", () => w.localStorage],
  ["sessionStorage", () => w.sessionStorage],
  ["indexedDB", () => w.indexedDB],
  ["Worker", () => w.Worker],
  ["SharedWorker", () => w.SharedWorker],
  ["WebSocket", () => w.WebSocket],
  ["EventSource", () => w.EventSource],
  ["fetch", () => w.fetch],
  ["AbortController", () => w.AbortController],
  ["URL.createObjectURL", () => (w.URL as Record<string, unknown> | undefined)?.createObjectURL],
  ["Blob", () => w.Blob],
  ["File", () => w.File],
  ["FileReader", () => w.FileReader],
  ["DataTransfer", () => w.DataTransfer],
  ["Image", () => w.Image],
  ["OffscreenCanvas", () => w.OffscreenCanvas],
  ["canvas.getContext", () => (document.createElement("canvas") as unknown as Record<string, unknown>).getContext],
  ["CSS.escape", () => (w.CSS as Record<string, unknown> | undefined)?.escape],
  ["CSS.supports", () => (w.CSS as Record<string, unknown> | undefined)?.supports],
  ["screen", () => w.screen],
  ["devicePixelRatio", () => w.devicePixelRatio],
  ["visualViewport", () => w.visualViewport],
  ["window.open", () => w.open],
  ["performance.now", () => (w.performance as Record<string, unknown> | undefined)?.now],
  ["TextEncoder", () => w.TextEncoder],
  ["structuredClone", () => w.structuredClone],
  ["queueMicrotask", () => w.queueMicrotask],
  ["crypto.subtle", () => (w.crypto as Record<string, unknown> | undefined)?.subtle],
  ["crypto.randomUUID", () => (w.crypto as Record<string, unknown> | undefined)?.randomUUID],
  ["AudioContext", () => w.AudioContext],
  ["MediaRecorder", () => w.MediaRecorder],
  ["Intl.Segmenter", () => (Intl as unknown as Record<string, unknown>).Segmenter],
  ["Intl.ListFormat", () => (Intl as unknown as Record<string, unknown>).ListFormat],
  ["Intl.DisplayNames", () => (Intl as unknown as Record<string, unknown>).DisplayNames],
  ["Intl.RelativeTimeFormat", () => (Intl as unknown as Record<string, unknown>).RelativeTimeFormat],
  ["isSecureContext (key)", () => "isSecureContext" in w],
  ["WebAssembly", () => w.WebAssembly],
  ["PointerEvent", () => w.PointerEvent],
  ["KeyboardEvent", () => w.KeyboardEvent],
  ["CustomEvent", () => w.CustomEvent],
  ["HTMLElement", () => w.HTMLElement],
  ["Node", () => w.Node],
  ["DOMParser", () => w.DOMParser],
];

export const probing = typeof process !== "undefined" && process.env.T3_SILK_PROBE === "1";

const log = (...parts: unknown[]) => console.error("[silk-probe]", ...parts);

export function reportMissingApis() {
  const missing: string[] = [];
  for (const [name, test] of CHECKS) {
    try {
      if (!test()) missing.push(name);
    } catch (error) {
      missing.push(`${name} (threw ${String(error)})`);
    }
  }
  log("missing", JSON.stringify(missing));
}

// The Navigation API over this realm's history, just enough for apps/web's back/forward buttons.
export function installShims() {
  if (w.navigation) return;
  const target = new EventTarget();
  let index = 0;
  let length = 1;
  const changed = () => target.dispatchEvent(new Event("currententrychange"));
  const history = window.history;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    push(...args);
    index += 1;
    length = index + 1;
    changed();
  };
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replace(...args);
    changed();
  };
  window.addEventListener("popstate", changed);
  w.navigation = Object.assign(target, {
    get canGoBack() {
      return index > 0;
    },
    get canGoForward() {
      return index < length - 1;
    },
  });
  log("shimmed window.navigation");
}

export function watchErrors() {
  window.addEventListener("error", (event) => log("error", (event as ErrorEvent).message));
  window.addEventListener("unhandledrejection", (event) =>
    log("unhandledrejection", String((event as PromiseRejectionEvent).reason)),
  );
}

const ROUTES = [
  "/",
  "/new",
  "/issues",
  "/pull-requests",
  "/usage",
  ...[
    "about", "access", "appearance", "archived", "beta", "browser", "chat", "connections",
    "devices", "diagnostics", "diffs", "general", "integrations", "keybindings", "labs",
    "maintenance", "open-source-licenses", "projects", "providers", "scheduled-tasks", "secrets",
    "snap-shot", "source-control", "storage", "threads", "voice", "worktrees",
  ].map((page) => `/settings/${page}`),
];

// One route every few seconds; whatever breaks shows up as console errors between the markers.
export async function walkRoutes(router: { history: { push: (path: string) => void } }) {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const ms = Number(process.env.T3_SILK_PROBE_STEP_MS ?? 4000);
  await wait(ms);
  for (const route of ROUTES) {
    log("route", route);
    try {
      router.history.push(route);
    } catch (error) {
      log("route threw", route, String(error));
    }
    await wait(ms);
    log("route done", route, "body text", (document.body.textContent ?? "").slice(0, 160).replace(/\s+/g, " "));
  }
  log("walk done");
}
