"use strict";

/**
 * Starts the local relay, hits real OpenF1 with a fake bearer, and checks
 * CORS + proxying. Does not print tokens or Authorization values.
 */
const { spawn } = require("child_process");
const { ALLOWED_ORIGIN } = require("./handler");

const PORT = 8799;
const ORIGIN = ALLOWED_ORIGIN;

function waitFor(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function once(url, init) {
  const res = await fetch(url, init);
  return {
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
    allowHeaders: res.headers.get("access-control-allow-headers") || "",
    allowMethods: res.headers.get("access-control-allow-methods") || "",
    type: res.headers.get("content-type") || "",
    body: await res.text(),
  };
}

async function main() {
  const child = spawn(process.execPath, ["local.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  child.stdout.on("data", (buf) => {
    if (String(buf).includes("listening")) ready = true;
  });
  for (let i = 0; i < 40 && !ready; i += 1) await waitFor(50);
  if (!ready) {
    child.kill();
    throw new Error("local relay did not start");
  }

  try {
    const options = await once(`http://127.0.0.1:${PORT}/v1/sessions?session_key=latest`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    if (options.status !== 204) throw new Error(`OPTIONS status ${options.status}`);
    if (options.allowOrigin !== ORIGIN) throw new Error("OPTIONS missing Allow-Origin for GitHub Pages");
    if (!/authorization/i.test(options.allowHeaders)) throw new Error("OPTIONS must allow Authorization");
    if (!/GET/i.test(options.allowMethods)) throw new Error("OPTIONS must allow GET");

    const get = await once(`http://127.0.0.1:${PORT}/v1/sessions?session_key=latest`, {
      method: "GET",
      headers: {
        Origin: ORIGIN,
        Accept: "application/json",
        Authorization: "Bearer fake-token-for-cors-test",
      },
    });
    if (get.allowOrigin !== ORIGIN) throw new Error("GET missing CORS Allow-Origin");
    if (get.status < 200 || get.status >= 600) throw new Error(`GET unexpected status ${get.status}`);
    if (get.status === 404) throw new Error("GET was not proxied (404 from relay)");

    const blocked = await once(`http://127.0.0.1:${PORT}/v1/sessions?session_key=latest`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    if (blocked.allowOrigin) throw new Error("CORS must not allow other origins");

    const token = await once(`http://127.0.0.1:${PORT}/token`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "username=fake&password=fake",
    });
    if (token.allowOrigin !== ORIGIN) throw new Error("POST /token missing CORS Allow-Origin");
    if (token.status === 404) throw new Error("POST /token was not proxied");

    process.stdout.write(
      `relay local test ok: OPTIONS ${options.status}, GET ${get.status}, token ${token.status}, CORS=${ORIGIN}\n`,
    );
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
