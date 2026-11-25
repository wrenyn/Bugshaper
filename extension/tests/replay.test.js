import { test } from "node:test";
import assert from "node:assert/strict";
import { frameAt } from "../src/pages/replay.js";

test("replay uses the most recent frame at or before the event", () => {
  const frames = [{ at: 1000 }, { at: 1100 }, { at: 1400 }];
  assert.equal(frameAt(frames, 999), null);
  assert.equal(frameAt(frames, 1000), frames[0]);
  assert.equal(frameAt(frames, 1399), frames[1]);
  assert.equal(frameAt(frames, 1500), frames[2]);
});
