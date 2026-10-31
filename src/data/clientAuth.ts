import { getAccessToken, peekAccessToken, tryRefreshAfter401 } from "./auth";

export function bearerHeaders(token: string, init?: HeadersInit): Headers {
  const headers = new Headers(init ?? undefined);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  const clean = token.replace(/^Bearer\s+/i, "").trim();
  if (clean) headers.set("Authorization", `Bearer ${clean}`);
  return headers;
}

/** Fetch with the current bearer token; on 401 refresh once (password login) and retry. */
export async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = (await getAccessToken()) || peekAccessToken();
  let res = await fetch(url, { ...init, headers: bearerHeaders(token, init.headers) });
  if (res.status === 401 && (await tryRefreshAfter401())) {
    const next = (await getAccessToken()) || peekAccessToken();
    res = await fetch(url, { ...init, headers: bearerHeaders(next, init.headers) });
  }
  return res;
}
