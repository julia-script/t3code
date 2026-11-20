// Starts the T3 server as a child process, the way apps/desktop's backend manager does for
// a local environment: the bootstrap goes in on stdin (`--bootstrap-fd 0`, as the WSL backend
// receives it) and the window authenticates with the bootstrap token.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { FetchHttpClient } from "effect/http";

export interface Backend {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly bootstrapToken: string;
  readonly t3Home: string;
  stop(): void;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/** The repository's server: its build when there is one, else its sources (Node strips the types). */
function serverEntry(repo: string): string {
  const built = join(repo, "apps/server/dist/bin.mjs");
  return existsSync(built) ? built : join(repo, "apps/server/src/bin.ts");
}

export async function startBackend(): Promise<Backend> {
  const env = process.env;
  // Run from apps/silk-desktop, as `silk task dev` does, or name the checkout.
  const repo = resolve(env.T3CODE_REPO ?? join(process.cwd(), "../.."));
  // Its own T3 home by default, so the demo never opens the home of an installed T3 Code.
  const t3Home = env.T3CODE_HOME ?? join(homedir(), ".t3-silk");
  mkdirSync(t3Home, { recursive: true });
  const port = await freePort();
  const host = "127.0.0.1";
  const bootstrapToken = randomBytes(32).toString("base64url");
  const bootstrap = {
    mode: "desktop",
    noBrowser: true,
    port,
    host,
    t3Home,
    desktopBootstrapToken: bootstrapToken,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  };

  const child: ChildProcess = spawn(env.T3CODE_NODE ?? "node", [serverEntry(repo), "--bootstrap-fd", "0"], {
    cwd: join(repo, "apps/server"),
    env: { ...env, T3CODE_HOME: t3Home },
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin?.end(`${JSON.stringify(bootstrap)}\n`);
  child.once("exit", (code, signal) => {
    console.error(`[silk-desktop] server exited (${signal ?? code})`);
  });

  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  process.once("exit", stop);

  return {
    httpBaseUrl: `http://${host}:${port}/`,
    wsBaseUrl: `ws://${host}:${port}/`,
    bootstrapToken,
    t3Home,
    stop,
  };
}

/** Trades the bootstrap token for a bearer token, retrying while the server starts. */
export async function bearerToken(backend: Backend): Promise<string> {
  const exchange = bootstrapRemoteBearerSession({
    httpBaseUrl: backend.httpBaseUrl,
    credential: backend.bootstrapToken,
    clientMetadata: { label: "T3 Code Desktop", deviceType: "desktop" },
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 240 }),
    Effect.provide(FetchHttpClient.layer),
  );
  return (await Effect.runPromise(exchange)).access_token;
}
