import assert from "node:assert/strict";
import test from "node:test";
import { MAX_EVENTS, normalizeEvidence, publicAddress } from "../helpers/evidence.js";

test("persisted diagnostics omit raw addresses, messages, and credentials", () => {
  assert.equal(publicAddress("https://user:password@example.test/path?token=hidden"), "https://example.test");
  assert.equal(publicAddress("chrome://extensions"), null);
  const events = normalizeEvidence([
    { kind: "exception", at: 2, label: "secret=foo", message: "foo", stack: "private", reason: "private",
      origin: "https://example.test/source.js?token=foo", line: 9 },
    { kind: "network", at: 1, origin: "https://example.test/private?token=foo", status: 500, body: "foo",
      resourceType: "fetch", transferBytes: 512 },
    { kind: "network", at: 3, resourceType: "private=foo", transferBytes: -5 },
    { kind: "unsupported", at: 0 },
  ]);
  assert.deepEqual(events, [
    { kind: "network", at: 1, label: "Resource timing", origin: "https://example.test",
      resourceType: "fetch", transferBytes: 512, status: 500 },
    { kind: "exception", at: 2, label: "Script error", origin: "https://example.test", line: 9 },
    { kind: "network", at: 3, label: "Resource timing" },
  ]);
});

test("the latest events are bounded and ordered", () => {
  const events = Array.from({ length: MAX_EVENTS + 5 }, (_, at) => ({ at, kind: "interaction", label: "Click" }));
  const normalized = normalizeEvidence(events);
  assert.equal(normalized.length, MAX_EVENTS);
  assert.equal(normalized[0].at, 5);
  assert.deepEqual(normalizeEvidence(null), []);
});

test("console evidence retains only known levels and a timestamp", () => {
  const events = normalizeEvidence([
    { kind: "console", at: 1, label: "warn", message: "private", stack: "private", origin: "https://example.test", value: 10 },
    { kind: "console", at: 2, label: "private" },
  ]);
  assert.deepEqual(events, [{ kind: "console", at: 1, label: "warn" }]);
});
