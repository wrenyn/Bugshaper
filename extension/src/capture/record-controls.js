import { workspaceOrigin } from "./account.js";

const start = document.querySelector("#record-start");
const stop = document.querySelector("#record-stop");
const pause = document.querySelector("#record-pause");
const output = document.querySelector("#record-status");
const time = document.querySelector("#record-time");
const result = document.querySelector("#record-result");
let action;
let polling = false;
let revision = 0;
let latest;
let notice = "";

async function command(action) {
  const response = await chrome.runtime.sendMessage({ action: "record:" + action });
  if (!response?.ok) throw new Error(response?.error ?? "Recorder did not respond.");
  return response.result;
}

async function reportUrl(state) {
  if (state.lastUpload?.id) {
    const origin = await workspaceOrigin();
    return origin + "/reports/" + state.lastUpload.id;
  }
  return chrome.runtime.getURL("src/pages/reports.html#" + state.lastReport);
}

async function render() {
  const state = latest ?? {};
  const phase = action === "start" ? "requesting" : action === "stop" ? "saving" : state.phase;
  const active = phase === "recording" || phase === "paused";
  start.disabled = Boolean(action || state.recording);
  document.querySelector("#record-actions").hidden = !state.recording || phase === "saving";
  output.dataset.recording = String(phase === "recording");
  stop.disabled = Boolean(action || !state.recording);
  pause.disabled = Boolean(action || !active);
  pause.textContent = state.paused ? "Resume" : "Pause";
  time.hidden = !active;
  time.textContent = Math.floor((state.elapsedMs ?? 0) / 1000) + "s";
  result.hidden = !state.lastReport || phase !== "idle";
  if (!result.hidden) {
    result.href = await reportUrl(state);
    result.textContent = state.lastUpload?.id ? "Open in workspace" : "Open local recording";
  }
  const labels = {
    requesting: "Connecting to the active tab…",
    waiting: "Waiting for video from the tab…",
    recording: "Recording tab",
    paused: "Recording paused",
    saving: "Saving recording…",
  };
  const message = notice || labels[phase] || state.lastError
    || (state.lastUpload?.id ? "Recording uploaded to your workspace." : state.lastReport ? "Recording saved locally." : "Video only. Up to 60 seconds.");
  if (output.textContent !== message) output.textContent = message;
}

async function change(next) {
  if (action) return;
  revision++;
  action = next;
  notice = "";
  await render();
  try {
    latest = await command(next);
    return latest;
  } catch (error) {
    notice = error.message;
  } finally {
    action = undefined;
    await render();
  }
}

start.onclick = () => change("start");
stop.onclick = async () => {
  const saved = await change("stop");
  if (saved?.lastReport) {
    try {
      await chrome.tabs.create({ url: await reportUrl(saved) });
    } catch (error) {
      notice = error.message;
      await render();
    }
  }
};
pause.onclick = () => change(latest?.paused ? "resume" : "pause");
change("state");
setInterval(async () => {
  if (action || polling || !latest?.recording) return;
  polling = true;
  const previous = revision;
  try {
    const state = await command("state");
    if (previous === revision) { latest = state; await render(); }
  } catch (error) {
    if (previous === revision) { notice = error.message; await render(); }
  } finally {
    polling = false;
  }
}, 1000);
