import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function keyFor(workspaceId, reportId, kind) {
  const salt = randomBytes(8).toString("hex");
  const digest = createHash("sha256").update(`${workspaceId}:${reportId}:${kind}:${salt}`).digest("hex").slice(0, 24);
  return `${workspaceId}/${reportId}/${kind}-${digest}`;
}

function assertKey(key) {
  if (typeof key !== "string" || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(screenshot|video)-[a-f0-9]{24}$/.test(key)) {
    throw new Error("Invalid media storage key.");
  }
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, typeof value === "string" ? "utf8" : undefined).digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Minimal AWS SigV4 signer for S3-compatible Put/Get/Delete. */
function s3Request({ method, bucket, key, region, endpoint, accessKey, secretKey, body, contentType }) {
  const host = endpoint ? new URL(endpoint).host : `${bucket}.s3.${region}.amazonaws.com`;
  const path = endpoint ? `/${bucket}/${key}` : `/${key}`;
  const url = endpoint ? `${endpoint.replace(/\/$/, "")}/${bucket}/${key}` : `https://${host}${path}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body || "");
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).map((name) => name.toLowerCase()).sort().join(";");
  const canonicalHeaders = Object.keys(headers).map((name) => name.toLowerCase()).sort()
    .map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers, body };
}

/**
 * Media backends:
 * - default: SQLite BLOBs
 * - BUGSHAPER_MEDIA_DIR: local disk
 * - BUGSHAPER_S3_BUCKET (+ keys/region): S3-compatible object storage (wins over disk when set)
 */
export function mediaStore(env = process.env, fetcher = fetch) {
  const root = env.BUGSHAPER_MEDIA_DIR ? resolve(env.BUGSHAPER_MEDIA_DIR) : "";
  const bucket = env.BUGSHAPER_S3_BUCKET || "";
  const region = env.BUGSHAPER_S3_REGION || "us-east-1";
  const accessKey = env.BUGSHAPER_S3_ACCESS_KEY || "";
  const secretKey = env.BUGSHAPER_S3_SECRET_KEY || "";
  const endpoint = env.BUGSHAPER_S3_ENDPOINT || "";
  const s3 = Boolean(bucket);
  if (s3 && (!accessKey || !secretKey)) throw new Error("S3 media storage requires BUGSHAPER_S3_ACCESS_KEY and BUGSHAPER_S3_SECRET_KEY.");
  if (root && !s3) mkdirSync(root, { recursive: true });

  async function s3Send(method, key, body, contentType) {
    assertKey(key);
    const request = s3Request({ method, bucket, key, region, endpoint, accessKey, secretKey, body, contentType });
    const response = await fetcher(request.url, { method, headers: request.headers, body: body || undefined });
    if (!response.ok) throw new Error(`S3 ${method} failed (${response.status}).`);
    if (method === "GET") return Buffer.from(await response.arrayBuffer());
    return null;
  }

  return {
    enabled: Boolean(root || s3),
    mode: s3 ? "s3" : root ? "disk" : "sqlite",
    async put(workspaceId, reportId, kind, data, type = "application/octet-stream") {
      if (!root && !s3) return { storageKey: null, data };
      const key = keyFor(workspaceId, reportId, kind);
      if (s3) {
        await s3Send("PUT", key, data, type);
        return { storageKey: key, data: Buffer.alloc(0) };
      }
      const path = join(root, key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      return { storageKey: key, data: Buffer.alloc(0) };
    },
    async get(row) {
      if (!row.storage_key) return row.data;
      assertKey(row.storage_key);
      if (s3) return s3Send("GET", row.storage_key);
      const path = join(root, row.storage_key);
      if (!existsSync(path)) throw new Error("Media object missing on disk.");
      return readFileSync(path);
    },
    async remove(row) {
      if (!row?.storage_key) return;
      try {
        if (s3) await s3Send("DELETE", row.storage_key);
        else unlinkSync(join(root, row.storage_key));
      } catch { /* already gone */ }
    },
  };
}
