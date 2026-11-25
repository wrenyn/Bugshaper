import { createLegacyController } from "../controllers/legacy.mjs";

export function createLegacyRouter(db, options) {
  if (options.ownerKey == null) {
    return async (_req, res, { pathname }) => {
      if (!pathname.startsWith("/v1/")) return false;
      res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Legacy API unavailable." }));
      return true;
    };
  }
  const handle = createLegacyController(db, options);
  return async (req, res, url) => {
    if (!url.pathname.startsWith("/v1/")) return false;
    await handle(req, res, { pathname: url.pathname, searchParams: url.searchParams, method: req.method });
    return true;
  };
}
