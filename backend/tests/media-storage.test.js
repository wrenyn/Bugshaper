import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mediaStore } from "../models/media.mjs";

test("media store keeps blobs in SQLite mode and on disk when configured", async () => {
  const inline = mediaStore({});
  assert.equal(inline.enabled, false);
  assert.equal(inline.mode, "sqlite");
  const bytes = Buffer.from([1, 2, 3, 4]);
  const kept = await inline.put("w", "r", "screenshot", bytes);
  assert.equal(kept.storageKey, null);
  assert.deepEqual(kept.data, bytes);

  const directory = mkdtempSync(join(tmpdir(), "bugshaper-media-"));
  try {
    const disk = mediaStore({ BUGSHAPER_MEDIA_DIR: directory });
    assert.equal(disk.enabled, true);
    assert.equal(disk.mode, "disk");
    const workspaceId = randomUUID();
    const reportId = randomUUID();
    const stored = await disk.put(workspaceId, reportId, "screenshot", bytes);
    assert.ok(stored.storageKey);
    assert.equal(stored.data.length, 0);
    const row = { storage_key: stored.storageKey, data: stored.data };
    assert.deepEqual(await disk.get(row), bytes);
    assert.deepEqual(readFileSync(join(directory, stored.storageKey)), bytes);
    await disk.remove(row);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("S3 media store signs PutObject and stores externally", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body });
    if (options.method === "GET") return new Response(Buffer.from([9, 9]), { status: 200 });
    return new Response(null, { status: 200 });
  };
  const store = mediaStore({
    BUGSHAPER_S3_BUCKET: "bugshaper-media",
    BUGSHAPER_S3_REGION: "us-east-1",
    BUGSHAPER_S3_ACCESS_KEY: "AKIAEXAMPLE",
    BUGSHAPER_S3_SECRET_KEY: "secretsecretsecretsecretsecret12",
  }, fetcher);
  assert.equal(store.mode, "s3");
  const workspaceId = randomUUID();
  const reportId = randomUUID();
  const stored = await store.put(workspaceId, reportId, "video", Buffer.from("webm"), "video/webm");
  assert.ok(stored.storageKey);
  assert.equal(calls[0].method, "PUT");
  assert.match(calls[0].headers.authorization, /AWS4-HMAC-SHA256/);
  assert.equal(calls[0].headers["content-type"], "video/webm");
  const got = await store.get({ storage_key: stored.storageKey });
  assert.deepEqual(got, Buffer.from([9, 9]));
  await store.remove({ storage_key: stored.storageKey });
  assert.equal(calls.at(-1).method, "DELETE");
});
