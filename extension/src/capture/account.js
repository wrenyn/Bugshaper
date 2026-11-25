const ORIGIN_KEY = "bugshaper.workspaceOrigin";
const WORKSPACE_KEY = "bugshaper.workspace";
const PROJECT_KEY = "bugshaper.projectId";
const DEFAULT_ORIGIN = "http://localhost:4318";

export async function workspaceOrigin() {
  const stored = await chrome.storage.sync.get(ORIGIN_KEY);
  const value = stored[ORIGIN_KEY];
  if (typeof value === "string" && value) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.origin;
    } catch {
      // fall through
    }
  }
  return DEFAULT_ORIGIN;
}

export async function setWorkspaceOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter an http(s) Bugshaper workspace URL.");
  }
  await chrome.storage.sync.set({ [ORIGIN_KEY]: url.origin });
  return url.origin;
}

export async function selectedWorkspaceId() {
  const stored = await chrome.storage.sync.get([WORKSPACE_KEY, "bugshaper.workspaceId"]);
  if (typeof stored[WORKSPACE_KEY] === "string" && stored[WORKSPACE_KEY]) return stored[WORKSPACE_KEY];
  // Migrate legacy extension key to the website localStorage key name.
  if (typeof stored["bugshaper.workspaceId"] === "string" && stored["bugshaper.workspaceId"]) {
    await chrome.storage.sync.set({ [WORKSPACE_KEY]: stored["bugshaper.workspaceId"] });
    await chrome.storage.sync.remove("bugshaper.workspaceId");
    return stored["bugshaper.workspaceId"];
  }
  return "";
}

export async function setSelectedWorkspaceId(id) {
  if (!id) await chrome.storage.sync.remove(WORKSPACE_KEY);
  else await chrome.storage.sync.set({ [WORKSPACE_KEY]: id });
  return id;
}

export async function selectedProjectId() {
  const stored = await chrome.storage.sync.get(PROJECT_KEY);
  return typeof stored[PROJECT_KEY] === "string" ? stored[PROJECT_KEY] : "";
}

export async function setSelectedProjectId(id) {
  if (!id) await chrome.storage.sync.remove(PROJECT_KEY);
  else await chrome.storage.sync.set({ [PROJECT_KEY]: id });
  return id;
}

function cookieNames(origin) {
  return origin.startsWith("https://")
    ? ["__Host-bugshaper", "bugshaper_session"]
    : ["bugshaper_session", "__Host-bugshaper"];
}

async function sessionCookie(origin) {
  for (const name of cookieNames(origin)) {
    const cookie = await chrome.cookies.get({ url: origin + "/", name });
    if (cookie?.value) return `${cookie.name}=${cookie.value}`;
  }
  return null;
}

export async function ensureOriginAccess(origin) {
  const pattern = origin + "/*";
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

export async function getSession() {
  const origin = await workspaceOrigin();
  if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) {
    return { origin, user: null, workspaces: [], workspaceId: "", reason: "permission" };
  }
  const cookie = await sessionCookie(origin);
  if (!cookie) return { origin, user: null, workspaces: [], workspaceId: "", reason: "signed_out" };
  const response = await fetch(origin + "/api/v1/session", {
    headers: { cookie, accept: "application/json", "x-bugshaper-client": "extension" },
  });
  if (!response.ok) return { origin, user: null, workspaces: [], workspaceId: "", reason: "signed_out" };
  const data = await response.json();
  const workspaces = data.workspaces || [];
  let workspaceId = await selectedWorkspaceId();
  if (!workspaces.some((w) => w.id === workspaceId)) workspaceId = workspaces[0]?.id || "";
  if (workspaceId) await setSelectedWorkspaceId(workspaceId);
  return {
    origin,
    user: data.user || null,
    workspaces,
    workspaceId,
    csrf: data.csrf,
    cookie,
    reason: data.user ? "ok" : "signed_out",
  };
}

/** Poll until Google sign-in creates a session cookie, or timeout. */
export async function waitForSession({ timeoutMs = 120000, intervalMs = 1500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = await getSession();
    if (session.user) return session;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return getSession();
}

export async function openSignIn() {
  const origin = await workspaceOrigin();
  if (!(await ensureOriginAccess(origin))) throw new Error("Allow access to your Bugshaper workspace to sign in.");
  await chrome.tabs.create({ url: origin + "/login?" + new URLSearchParams({ returnTo: "/dashboard" }) });
}

export async function openWorkspace(path = "/dashboard") {
  const origin = await workspaceOrigin();
  await chrome.tabs.create({ url: origin + path });
}

/** Authenticated JSON call against the Bugshaper website API. */
export async function api(path, method = "GET", body) {
  const session = await getSession();
  if (!session.user || !session.cookie) throw new Error("Sign in to Bugshaper to continue.");
  const response = await fetch(session.origin + path, {
    method,
    headers: {
      cookie: session.cookie,
      accept: "application/json",
      "x-bugshaper-client": "extension",
      ...(!["GET", "HEAD"].includes(method) ? { "x-csrf-token": session.csrf, "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
