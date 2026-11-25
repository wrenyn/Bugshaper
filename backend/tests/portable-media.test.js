import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { makeLocalBundle, extractLocalBundle } from "../helpers/portable-media.js";

test("media bundles require explicit selection and reject altered bytes", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const report = { id: randomUUID(), createdAt: Date.now(), screenshot: new Blob([png], { type: "image/png" }), events: [] };
  assert.equal((await makeLocalBundle(report, [])).media, undefined);
  const bundle = await makeLocalBundle(report, ["screenshot"]);
  const extracted = await extractLocalBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(new Uint8Array(await extracted.screenshot.arrayBuffer()), png);
  bundle.media.screenshot.data = btoa(String.fromCharCode(...png.slice(0, -1), 2));
  await assert.rejects(extractLocalBundle(bundle), /integrity/);
});
