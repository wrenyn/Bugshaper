/** Resolve a rate-limit identity. Only honor X-Forwarded-For when trustProxy is enabled. */
export function clientAddress(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || "unknown";
}
