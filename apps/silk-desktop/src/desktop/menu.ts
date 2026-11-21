// The menu bar of apps/desktop's DesktopApplicationMenu, on Silk UI's native menu. Items that
// act on the app hand their action to apps/web through `desktopBridge.onMenuAction`.
import { appWindow, setApplicationMenu, type MenuItem } from "@silkui/core";

const listeners = new Set<(action: string) => void>();

export const menuActions = {
  subscribe(listener: (action: string) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const dispatch = (action: string) => () => {
  appWindow.focus();
  for (const listener of listeners) listener(action);
};

const zoom = (factor: number | ((zoom: number) => number)) => () =>
  void appWindow.setZoomFactor(typeof factor === "number" ? factor : factor(appWindow.getZoomFactor()));

export function installApplicationMenu(appName: string): Promise<void> {
  const mac = process.platform === "darwin";
  const settings: MenuItem = { label: "Settings...", accelerator: "CmdOrCtrl+,", click: dispatch("open-settings") };
  const template: MenuItem[] = [
    ...(mac
      ? [
          {
            label: appName,
            submenu: [
              { role: "about", label: `About ${appName}` },
              { type: "separator" },
              settings,
              { type: "separator" },
              { role: "services", label: "Services" },
              { type: "separator" },
              { role: "hide", label: `Hide ${appName}` },
              { role: "hideOthers", label: "Hide Others" },
              { role: "unhide", label: "Show All" },
              { type: "separator" },
              { role: "quit", label: `Quit ${appName}` },
            ],
          } satisfies MenuItem,
        ]
      : []),
    {
      label: "File",
      submenu: [...(mac ? [] : [settings, { type: "separator" } satisfies MenuItem]), { role: mac ? "close" : "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { label: "Paste as Text", accelerator: "CmdOrCtrl+Shift+V", click: dispatch("paste-as-text") },
        { type: "separator" },
        { role: "selectAll", label: "Select All" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: zoom(1) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: zoom((value) => value * 1.1) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: zoom((value) => value / 1.1) },
        { type: "separator" },
        { role: "togglefullscreen", label: "Toggle Full Screen" },
      ],
    },
    {
      role: "windowMenu",
      label: "Window",
      submenu: [
        { role: "minimize", label: "Minimize" },
        { role: "zoom", label: "Zoom" },
        ...(mac ? [{ type: "separator" } satisfies MenuItem, { role: "front", label: "Bring All to Front" }] : []),
      ],
    },
  ];
  return setApplicationMenu(template);
}
