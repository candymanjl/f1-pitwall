"use strict";

const ALLOWED_ORIGIN = "https://candymanjl.github.io";
const UPSTREAM = "https://api.openf1.org";

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin === ALLOWED_ORIGIN) headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  return headers;
}

function normalizePath(raw) {
  const path = String(raw || "")
    .replace(/^\/api\/?/i, "")
    .replace(/^\//, "");
  return path;
}

function upstreamUrl(path, search) {
  const clean = normalizePath(path);
  if (clean === "token" || clean === "token/") return `${UPSTREAM}/token`;
  if (clean === "v1" || clean.startsWith("v1/")) {
    const rest = clean === "v1" ? "" : clean.slice(2);
    return `${UPSTREAM}/v1${rest}${search || ""}`;
  }
  return null;
}

function pickHeader(header, name) {
  if (!header) return "";
  if (typeof header === "function") return header(name) || header(name.toLowerCase()) || "";
  return header[name] || header[name.toLowerCase()] || "";
}

/**
 * Minimal OpenF1 proxy. Forwards Authorization. Never logs tokens or passwords.
 * @param {{ method: string, path: string, search?: string, header: (name: string) => string, body?: () => Promise<string>, fetch?: typeof fetch }} req
 */
async function handleRelay(req) {
  const method = (req.method || "GET").toUpperCase();
  const origin = pickHeader(req.header, "origin");
  const cors = corsHeaders(origin);

  if (method === "OPTIONS") {
    return { status: 204, headers: cors, body: "" };
  }
  if (method !== "GET" && method !== "POST") {
    return { status: 405, headers: cors, body: JSON.stringify({ detail: "Only GET, POST, and OPTIONS." }) };
  }

  const target = upstreamUrl(req.path, req.search || "");
  if (!target) {
    return { status: 404, headers: cors, body: JSON.stringify({ detail: "Relay only proxies /v1/* and /token." }) };
  }
  if (method === "POST" && !target.endsWith("/token")) {
    return { status: 405, headers: cors, body: JSON.stringify({ detail: "POST is only allowed for /token." }) };
  }
  if (method === "GET" && target.endsWith("/token")) {
    return { status: 405, headers: cors, body: JSON.stringify({ detail: "/token is POST only." }) };
  }

  const headers = { accept: pickHeader(req.header, "accept") || "application/json" };
  const auth = pickHeader(req.header, "authorization");
  if (auth) headers.authorization = auth;
  const contentType = pickHeader(req.header, "content-type");
  if (contentType) headers["content-type"] = contentType;

  const init = { method, headers };
  if (method === "POST") init.body = req.body ? await req.body() : "";

  const fetchImpl = req.fetch || fetch;
  let upstream;
  try {
    upstream = await fetchImpl(target, init);
  } catch {
    return { status: 502, headers: cors, body: JSON.stringify({ detail: "OpenF1 upstream is unreachable." }) };
  }

  const outHeaders = { ...cors };
  const type = upstream.headers.get("content-type");
  if (type) outHeaders["Content-Type"] = type;
  const body = Buffer.from(await upstream.arrayBuffer());
  return { status: upstream.status, headers: outHeaders, body };
}

module.exports = { ALLOWED_ORIGIN, corsHeaders, handleRelay, normalizePath, upstreamUrl };
