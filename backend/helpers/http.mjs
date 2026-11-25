import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
export const hash = value => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const equal = (a, b) => typeof a === "string" && typeof b === "string" && timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function json(res, status, data, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(JSON.stringify(data));
}
export function redirect(res, location, cookies) {
  res.writeHead(303, { location, "cache-control": "no-store", ...(cookies ? { "set-cookie": cookies } : {}) }); res.end();
}
export async function rawBody(req, limit = 256 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, "Request exceeds the size limit."); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function body(req, limit) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") fail(415, "Use application/json.");
  try { const data = JSON.parse(await rawBody(req, limit)); if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Expected an object."); return data; }
  catch (error) { if (error instanceof HttpError) throw error; fail(400, "Invalid JSON."); }
}
export const text = (value, name, max = 120, required = true) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400, `Provide a valid ${name} (up to ${max} characters).`);
  return value.trim();
};
export function cookie(req, key) {
  const value = (req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(key + "="))?.slice(key.length + 1);
  return value || "";
}
export const safeReturn = value => typeof value === "string" && /^\/(dashboard|reports|teams|projects|members|analytics|activity|settings|billing|notifications|invite)([/?#]|$)/.test(value) && !/[\\\r\n]/.test(value) ? value.slice(0, 512) : "/dashboard";
export async function transaction(db, fn) {
  await db.exec("BEGIN");
  try {
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
