import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePixels } from "../src/lib/visual.js";

test("visual comparison highlights only pixels over the threshold", () => {
  const baseline = [0, 0, 0, 255, 10, 10, 10, 255];
  const updated = [20, 20, 20, 255, 255, 10, 10, 255];
  const result = comparePixels(baseline, updated, 20);
  assert.equal(result.changed, 1);
  assert.deepEqual([...result.overlay], [0, 0, 0, 255, 255, 82, 110, 255]);
  assert.throws(() => comparePixels(baseline, updated.slice(0, 4)));
});
