import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { idPattern } from "../models/report.mjs";

const appPages = ["/dashboard", "/reports", "/login", "/invite", "/projects", "/teams", "/members", "/analytics", "/activity", "/settings", "/billing", "/notifications"];

function siteRoot() {
  if (process.env.BUGSHAPER_SITE_DIR) return process.env.BUGSHAPER_SITE_DIR;
  return fileURLToPath(new URL("../public/www/", import.meta.url));
}

export function loadStaticAssets(_options = {}) {
  const root = siteRoot();
  const manifestPath = join(root, "asset-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing website build at ${root}. Run \`npm run build\` inside the website package first.`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const assets = new Map();
  for (const [route, { type, file }] of Object.entries(manifest)) {
    assets.set(route, { type, body: readFileSync(join(root, file)) });
  }
  const dashboard = {
    "/dashboard": ["text/html; charset=utf-8", "app/index.html"],
    "/dashboard.js": ["text/javascript; charset=utf-8", "app/app.js"],
    "/dashboard.css": ["text/css; charset=utf-8", "app/app.css"],
  };
  for (const [route, [type, file]] of Object.entries(dashboard)) {
    assets.set(route, { type, body: readFileSync(join(root, file)) });
  }
  const viewerRoot = fileURLToPath(new URL("../public/viewer/", import.meta.url));
  for (const [route, [type, file]] of [
    ["/viewer", ["text/html; charset=utf-8", "viewer.html"]],
    ["/viewer.js", ["text/javascript; charset=utf-8", "viewer.js"]],
    ["/viewer.css", ["text/css; charset=utf-8", "viewer.css"]],
  ]) {
    assets.set(route, { type, body: readFileSync(join(viewerRoot, file)) });
  }
  return assets;
}

export function serveStatic(assets, req, res, pathname) {
  if (req.method !== "GET") return false;
  const reportPage = pathname.match(/^\/reports\/([^/]+)$/)?.[1];
  const sharePage = pathname.match(/^\/share\/([a-f0-9]{64})$/i)?.[1];
  const assetPath = appPages.includes(pathname) || (reportPage && idPattern.test(reportPage)) || sharePage ? "/dashboard" : pathname;
  if (!assets.has(assetPath)) return false;
  const page = assets.get(assetPath);
  const viewer = assetPath === "/viewer" || assetPath === "/viewer.js" || assetPath === "/viewer.css";
  const media = assetPath === "/dashboard" ? " data: blob:; media-src 'self' blob:" : "";
  const csp = viewer
    ? "default-src 'none'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    : `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';${media}`;
  res.writeHead(200, {
    "content-type": page.type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": csp,
  });
  res.end(page.body);
  return true;
}
