import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { extractBundle, makeBundle } from "../helpers/bundle.js";

test("portable bundle excludes binaries and rejects altered metadata", async () => {
  const input = { id: randomUUID(), createdAt: Date.now(), title: "Screenshot issue",
    screenshot: new Blob(["private"]),
    events: [{ kind: "network", at: 1, resourceType: "fetch", transferBytes: 512 },
      { kind: "console", at: 2, label: "warn" }] };
  const bundle = await makeBundle(input);
  assert.equal((await extractBundle(JSON.parse(JSON.stringify(bundle)))).title, input.title);
  assert.equal(Object.hasOwn(bundle.report, "screenshot"), false);
  assert.deepEqual(bundle.report.events, [{ kind: "network", at: 1, label: "Resource timing" }]);
  bundle.report.title = "Tampered title";
  await assert.rejects(extractBundle(bundle), /integrity/);
});
