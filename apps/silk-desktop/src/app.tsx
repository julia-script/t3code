// apps/web/src/main.tsx with the React DOM root swapped for a Silk UI root; everything it
// renders is apps/web's own code.
import React from "react";
import { createRoot } from "@silkui/react";

import "@fontsource-variable/inter";
import "~/index.css";

import { startAppServices } from "~/appInit";
import { AppRoot } from "~/AppRoot";
import { whenLocaleReady } from "~/i18n/runtime";

const router = startAppServices();

export const startup = router
  .load()
  .then(() => console.error("[silk-desktop] router loaded"))
  .then(whenLocaleReady)
  .then(() => {
    console.error("[silk-desktop] first render");
    createRoot(document.body as never).render(
      <React.StrictMode>
        <AppRoot router={router} />
      </React.StrictMode>,
    );
    console.error("[silk-desktop] rendered");
  });
