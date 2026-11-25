const defaultUrl = "http://127.0.0.1:4318";

export function apiClient({ url = defaultUrl, token } = {}) {
  const endpoint = new URL(url);
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search || endpoint.pathname !== "/" ||
      !(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)))) {
    throw new Error("Configure an HTTPS endpoint or a loopback HTTP endpoint.");
  }
  if (!token) throw new Error("Set BUGSHAPER_API_TOKEN.");
  return async (path, { method = "GET", body } = {}) => {
    const response = await fetch(new URL(path, endpoint), {
      method, headers: { authorization: "Bearer " + token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Bugshaper API returned HTTP " + response.status + ".");
    return data;
  };
}

export function clientFromEnvironment() {
  return apiClient({ url: process.env.BUGSHAPER_API_URL, token: process.env.BUGSHAPER_API_TOKEN });
}
