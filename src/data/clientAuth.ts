import { getAccessToken, tryRefreshAfter401 } from "./auth";

/** Fetch with the current bearer token; on 401 refresh once (password login) and retry. */
export async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headersFor = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
      Object.assign(headers, init.headers as Record<string, string>);
    }
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  let res = await fetch(url, { ...init, headers: await headersFor() });
  if (res.status === 401 && (await tryRefreshAfter401())) {
    res = await fetch(url, { ...init, headers: await headersFor() });
  }
  return res;
}
