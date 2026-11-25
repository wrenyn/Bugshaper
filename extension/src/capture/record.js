import { saveReport } from "../lib/storage.js";

const CAPTURE_LIMIT_MS = 60_000;
const STARTUP_LIMIT_MS = 8_000;
const BYTE_LIMIT = 20_000_000;
let session;
let lastReport;
let lastUpload;
let lastError;

function state() {
  const phase = session?.phase ?? "idle";
  return { phase, recording: Boolean(session), paused: phase === "paused",
    elapsedMs: session ? elapsed(session) : 0, lastReport, lastUpload, lastError };
}

function elapsed(recording) {
  if (!recording.startedAt) return 0;
  return Math.max(0, (recording.pausedAt ?? Date.now()) - recording.startedAt - recording.pausedMs);
}

async function start({ streamId, origin, tabId, documentId }) {
  if (session) throw new Error("A tab recording is already running.");
  const recording = { phase: "requesting", pausedMs: 0, segments: [] };
  session = recording;
  lastError = null;
  lastReport = null;
  lastUpload = null;
  try {
    recording.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxFrameRate: 24 } },
    });
    const recorder = new MediaRecorder(recording.stream, { mimeType: "video/webm", videoBitsPerSecond: 1_500_000 });
    recording.recorder = recorder;
    const chunks = [];
    let bytes = 0;
    const stop = (reason) => {
      if (reason) lastError ??= reason;
      if (recording.phase === "saving") return;
      recording.pausedAt ??= Date.now();
      closeSegment(recording);
      recording.phase = "saving";
      if (recorder.state !== "inactive") recorder.stop();
    };
    recording.finished = new Promise((resolve) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > BYTE_LIMIT) return stop("Recording exceeded the local size limit.");
        chunks.push(event.data);
        clearTimeout(recording.startupTimeout);
        if (recording.phase === "waiting") recording.phase = "recording";
      });
      recorder.addEventListener("error", () => stop("The browser interrupted the recording."));
      recorder.addEventListener("stop", async () => {
        stop();
        clearTimeout(recording.timeout);
        clearTimeout(recording.startupTimeout);
        for (const track of recording.stream.getTracks()) track.stop();
        try {
          if (!chunks.length || bytes > BYTE_LIMIT) throw new Error(lastError || "No video was captured. Reopen Bugshaper on the tab and try again.");
          let events = [];
          if (documentId) {
            try {
              const captured = await chrome.runtime.sendMessage({ action: "recording-evidence", tabId, documentId });
              events = (captured ?? []).filter(({ at }) =>
                recording.segments.some(({ from, to }) => at >= from && at < to));
            } catch {
              // Preserve the video when the source document is no longer available.
            }
          }
          const id = crypto.randomUUID();
          await saveReport({
            id, title: "", origin, createdAt: recording.startedAt, events, recordingSegments: recording.segments,
            video: new Blob(chunks, { type: "video/webm" }),
          });
          lastReport = id;
          try {
            const uploaded = await chrome.runtime.sendMessage({ action: "submit-report", id });
            if (!uploaded?.ok) throw new Error(uploaded?.error || "Upload failed.");
            lastUpload = uploaded.result;
          } catch (error) {
            lastError = error.message || "Recording saved locally, but workspace upload failed.";
          }
        } catch (error) {
          lastError = error.message;
        } finally {
          session = undefined;
          resolve();
        }
      }, { once: true });
    });
    recorder.start(1000);
    recording.startedAt = Date.now();
    recording.segmentStart = recording.startedAt;
    recording.phase = "waiting";
    recording.stop = stop;
    recording.startupTimeout = setTimeout(() => stop("Chrome delivered no video. Reopen Bugshaper on the tab and try again."), STARTUP_LIMIT_MS);
    recording.timeout = setTimeout(() => stop(), CAPTURE_LIMIT_MS);
    for (const track of recording.stream.getTracks()) {
      track.addEventListener("ended", () => stop("The captured tab stopped sharing video."), { once: true });
    }
  } catch (error) {
    for (const track of recording.stream?.getTracks() ?? []) track.stop();
    session = undefined;
    throw error;
  }
}

function closeSegment(recording) {
  if (recording.segmentStart == null) return;
  recording.segments.push({ from: recording.segmentStart, to: recording.pausedAt });
  recording.segmentStart = undefined;
}

async function run(message) {
  if (message.action === "start") await start(message);
  if (message.action === "stop" && session?.stop) {
    const { stop, finished } = session;
    stop();
    await finished;
  }
  if (message.action === "pause" && session?.phase === "recording") {
    session.recorder.pause();
    session.pausedAt = Date.now();
    closeSegment(session);
    session.phase = "paused";
  }
  if (message.action === "resume" && session?.phase === "paused") {
    session.recorder.resume();
    session.segmentStart = Date.now();
    session.pausedMs += session.segmentStart - session.pausedAt;
    session.pausedAt = undefined;
    session.phase = "recording";
  }
  return state();
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "record" || sender.id !== chrome.runtime.id || sender.tab) return;
  run(message).then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

