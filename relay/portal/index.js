"use strict";

const ALLOWED_ORIGIN = "https://candymanjl.github.io";
const UPSTREAM = "https://api.openf1.org";

function cors(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin === ALLOWED_ORIGIN) headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  return headers;
}

function targetFor(path, search) {
  const clean = String(path || "").replace(/^\/api\/?/i, "").replace(/^\//, "");
  if (clean === "token" || clean === "token/") return `${UPSTREAM}/token`;
  if (clean === "v1" || clean.startsWith("v1/")) {
    return `${UPSTREAM}/v1${clean === "v1" ? "" : clean.slice(2)}${search || ""}`;
  }
  return null;
}

module.exports = async function (context, req) {
  const method = String(req.method || "GET").toUpperCase();
  const origin = req.headers.origin || req.headers.Origin || "";
  const headers = cors(origin);
  if (method === "OPTIONS") {
    context.res = { status: 204, headers };
    return;
  }
  if (method !== "GET" && method !== "POST") {
    context.res = { status: 405, headers, body: { detail: "Only GET, POST, and OPTIONS." } };
    return;
  }
  const path = req.params.path || req.params.restOfPath || (req.url || "").split("?")[0];
  const search = req.url && req.url.includes("?") ? `?${req.url.split("?").slice(1).join("?")}` : "";
  const target = targetFor(path, search);
  if (!target) {
    context.res = { status: 404, headers, body: { detail: "Relay only proxies /v1/* and /token." } };
    return;
  }
  if (method === "POST" && !String(target).endsWith("/token")) {
    context.res = { status: 405, headers, body: { detail: "POST is only allowed for /token." } };
    return;
  }
  if (method === "GET" && String(target).endsWith("/token")) {
    context.res = { status: 405, headers, body: { detail: "/token is POST only." } };
    return;
  }
  const upHeaders = { accept: req.headers.accept || "application/json" };
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth) upHeaders.authorization = auth;
  const contentType = req.headers["content-type"] || req.headers["Content-Type"];
  if (contentType) upHeaders["content-type"] = contentType;
  const init = { method, headers: upHeaders };
  if (method === "POST") {
    if (typeof req.body === "string") init.body = req.body;
    else if (typeof req.rawBody === "string" && req.rawBody) init.body = req.rawBody;
    else if (req.body && typeof req.body === "object") {
      init.body = new URLSearchParams(
        Object.entries(req.body).map(([k, v]) => [k, v == null ? "" : String(v)]),
      ).toString();
    } else {
      init.body = "";
    }
  }
  try {
    const upstream = await fetch(target, init);
    const type = upstream.headers.get("content-type") || "application/json";
    const body = Buffer.from(await upstream.arrayBuffer());
    context.res = { status: upstream.status, headers: { ...headers, "Content-Type": type }, body };
  } catch {
    context.res = { status: 502, headers, body: { detail: "OpenF1 upstream is unreachable." } };
  }
};
