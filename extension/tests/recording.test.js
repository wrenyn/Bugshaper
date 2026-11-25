import assert from "node:assert/strict";
import test from "node:test";
import { recordingPosition } from "../src/pages/report-diagnostics.js";

test("recording positions omit pauses and support reports without segments", () => {
  const segments = [{ from: 1000, to: 1700 }, { from: 4200, to: 8000 }];
  assert.equal(recordingPosition(segments, 999), null);
  assert.equal(recordingPosition(segments, 1000), 0);
  assert.equal(recordingPosition(segments, 1650), 0.65);
  assert.equal(recordingPosition(segments, 1700), null);
  assert.equal(recordingPosition(segments, 4000), null);
  assert.equal(recordingPosition(segments, 4200), 0.7);
  assert.equal(recordingPosition(segments, 4500), 1);
  assert.equal(recordingPosition(segments, 8000), null);
  assert.equal(recordingPosition(undefined, 4500), null);
});

test("recorder releases the tab and allows retry if Chrome sends no video", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let listener;
  let released = 0;
  const track = Object.assign(new EventTarget(), { stop: () => { released++; } });
  const stubs = {
    chrome: { runtime: { id: "test", onMessage: { addListener: (value) => { listener = value; } } } },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
    MediaRecorder: class extends EventTarget {
      state = "inactive";
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => this.dispatchEvent(new Event("stop")));
      }
    },
  };
  for (const [name, value] of Object.entries(stubs)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  await import("../src/capture/record.js");
  const command = (action) => new Promise((resolve) => listener({ target: "record", action }, { id: "test" }, resolve));
  assert.equal((await command("start")).result.phase, "waiting");
  t.mock.timers.tick(8_000);
  const timedOut = await command("stop");
  assert.equal(timedOut.result.phase, "idle");
  assert.match(timedOut.result.lastError, /Chrome delivered no video/);
  assert.equal(released, 1);
  assert.equal((await command("start")).result.phase, "waiting");
  assert.equal((await command("stop")).result.phase, "idle");
  assert.equal(released, 2);
});
