import { randomUUID, createHash } from "node:crypto";
import { cookie, equal, fail, hash, json, redirect, safeReturn, text, token, transaction } from "../helpers/http.mjs";

export function authService(repo, config, now, fetcher) {
  const cookieName = config.production ? "__Host-bugshaper" : "bugshaper_session";
  const cookieValue = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.production ? "; Secure" : ""}`;
  const sessionCookie = (value, seconds = 604800) => cookieValue(cookieName, value, seconds);
  async function resolve(req) {
    const raw = cookie(req, cookieName);
    if (!raw) return null;
    return repo.one("SELECT u.id,u.email,u.name,s.csrf,s.digest,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.expires_at>?", hash(raw), now());
  }
  async function createSession(userId) {
    const raw = token(); const csrf = token();
    await repo.run("DELETE FROM sessions WHERE expires_at<=?", now());
    await repo.run("INSERT INTO sessions VALUES (?,?,?,?,?)", hash(raw), userId, csrf, now() + 604800000, now());
    return { cookie: sessionCookie(raw), csrf };
  }
  function extensionClient(req) {
    if (req.headers["x-bugshaper-client"] !== "extension") return false;
    const origin = req.headers.origin;
    return !origin || String(origin).startsWith("chrome-extension://");
  }
  async function requireSession(req, mutate = false) {
    const user = await resolve(req); if (!user) fail(401, "Sign in to continue.");
    if (mutate && (!equal(req.headers["x-csrf-token"], user.csrf) || (req.headers.origin !== config.origin && !extensionClient(req)))) {
      fail(403, "Session verification failed. Refresh and try again.");
    }
    return user;
  }
  async function createWorkspace(userId, name) {
    const id = randomUUID();
    await transaction(repo.db, async () => {
      await repo.run("INSERT INTO workspaces VALUES (?,?,?)", id, name, now());
      await repo.run("INSERT INTO memberships VALUES (?,?,?,?)", id, userId, "owner", now());
      await repo.run("INSERT INTO subscriptions(workspace_id) VALUES (?)", id);
      await repo.activity(id, userId, "workspace.created", `Created ${name}`);
    });
    return id;
  }
  async function upsertProfile(profile) {
    if (profile.email_verified !== true || typeof profile.sub !== "string" || !profile.sub || typeof profile.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) fail(401, "A verified Google email is required.");
    const email = profile.email.toLowerCase();
    const name = text(profile.name || email.split("@")[0], "Google display name");
    let user = await repo.one("SELECT * FROM users WHERE google_sub=?", profile.sub);
    if (!user) {
      // Never merge accounts solely because an email matches a different identity.
      if (await repo.one("SELECT 1 FROM users WHERE email=?", email)) fail(409, "This email is already associated with another identity.");
      const id = randomUUID();
      await transaction(repo.db, async () => {
        await repo.run("INSERT INTO users VALUES (?,?,?,?,?)", id, profile.sub, email, name, now());
        const wid = randomUUID();
        await repo.run("INSERT INTO workspaces VALUES (?,?,?)", wid, `${name.split(" ")[0]}'s workspace`, now());
        await repo.run("INSERT INTO memberships VALUES (?,?,?,?)", wid, id, "owner", now());
        await repo.run("INSERT INTO subscriptions(workspace_id) VALUES (?)", wid);
        await repo.activity(wid, id, "workspace.created", "Created workspace");
      });
      user = await repo.one("SELECT * FROM users WHERE id=?", id);
    } else {
      await repo.run("UPDATE users SET email=?,name=? WHERE id=?", email, name, user.id);
    }
    return user;
  }
  async function handle(req, res, url) {
    const path = url.pathname;
    if (path === "/auth/google" && req.method === "GET") {
      if (!config.googleClientId || !config.googleClientSecret) return redirect(res, "/login?error=google_unconfigured");
      const state = token(); const verifier = token();
      await repo.run("DELETE FROM oauth_states WHERE expires_at<=?", now());
      await repo.run("INSERT INTO oauth_states VALUES (?,?,?,?)", hash(state), verifier, safeReturn(url.searchParams.get("returnTo")), now() + 600000);
      const params = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: config.origin + "/auth/google/callback", response_type: "code", scope: "openid email profile", state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account" });
      return redirect(res, "https://accounts.google.com/o/oauth2/v2/auth?" + params, cookieValue("bugshaper_oauth", state, 600));
    }
    if (path === "/auth/google/callback" && req.method === "GET") {
      const state = url.searchParams.get("state") || "";
      const saved = await repo.one("SELECT * FROM oauth_states WHERE digest=? AND expires_at>?", hash(state), now());
      const clear = cookieValue("bugshaper_oauth", "", 0);
      if (!saved || !equal(cookie(req, "bugshaper_oauth"), state)) return redirect(res, "/login?error=oauth_state", clear);
      await repo.run("DELETE FROM oauth_states WHERE digest=?", hash(state));
      if (url.searchParams.has("error") || !url.searchParams.get("code")) return redirect(res, "/login?error=oauth_cancelled", clear);
      try {
        const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: config.origin + "/auth/google/callback", grant_type: "authorization_code", code_verifier: saved.verifier }) });
        if (!response.ok) throw new Error("Token exchange failed");
        const tokens = await response.json();
        if (typeof tokens.access_token !== "string") throw new Error("Missing access token");
        const profileResponse = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: "Bearer " + tokens.access_token }, signal: AbortSignal.timeout(15000) });
        if (!profileResponse.ok) throw new Error("Profile lookup failed");
        const user = await upsertProfile(await profileResponse.json());
        const session = await createSession(user.id);
        return redirect(res, saved.return_to, [clear, session.cookie]);
      } catch { return redirect(res, "/login?error=oauth_failed", clear); }
    }
    if (path === "/auth/demo" && req.method === "POST") {
      if (!config.demo) fail(404, "Route unavailable.");
      if (req.headers.origin !== config.origin) fail(403, "Invalid request origin.");
      const user = await repo.one("SELECT id FROM users WHERE google_sub='demo-owner'");
      if (!user) fail(503, "Demo workspace is not initialized.");
      const session = await createSession(user.id);
      return json(res, 200, { ok: true }, { "set-cookie": session.cookie });
    }
    if (path === "/api/v1/session" && req.method === "GET") {
      const user = await resolve(req);
      return json(res, 200, { user: user ? { id: user.id, name: user.name, email: user.email } : null, csrf: user?.csrf,
        demo: config.demo, googleReady: Boolean(config.googleClientId && config.googleClientSecret),
        workspaces: user ? await repo.all("SELECT w.*,m.role FROM workspaces w JOIN memberships m ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY w.created_at,w.id", user.id) : [] });
    }
    if (path === "/auth/logout" && req.method === "POST") {
      const user = await requireSession(req, true);
      await repo.run("DELETE FROM sessions WHERE digest=?", user.digest);
      return json(res, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    }
    return false;
  }
  return { handle, resolve, requireSession, createSession, createWorkspace, upsertProfile };
}
