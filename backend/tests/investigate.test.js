import { test } from "node:test";
import assert from "node:assert/strict";
import { investigationProvider } from "../controllers/investigate.mjs";

test("investigation sends sanitized event facts and validates references", async () => {
  let reference = 1;
  const request = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.doesNotMatch(payload.input, /private|origin|title|10000/);
    assert.equal(JSON.parse(payload.input)[0].status, 503);
    return { ok: true, json: async () => ({ status: "completed", output: [{ type: "message", role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify({ summary: "Service unavailable", nextCheck: "Inspect service logs", evidence: [reference] }) }] }] }) };
  };
  const run = investigationProvider({ key: "test", model: "test", request });
  const report = { title: "private title", events: [{ kind: "network", label: "Resource timing", at: 10000, status: 503, origin: "https://private.example" }] };
  assert.deepEqual((await run(report)).evidenceAt, [10000]);
  reference = 2;
  await assert.rejects(run(report), /Invalid evidence references/);
});
