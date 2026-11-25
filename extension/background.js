import { normalizeEvidence, publicAddress } from "./src/lib/evidence.js";
import { getReport, saveReport } from "./src/lib/storage.js";
import { getSession } from "./src/capture/account.js";
import { submitReportToWorkspace } from "./src/capture/submit.js";

const PAGE = {
  record: "src/capture/record.html",
  reports: "src/pages/reports.html",
  drafts: "src/pages/drafts.html",
  popup: "src/popup/popup.html",
};

async function requireSignedIn() {
  const session = await getSession();
  if (!session.user) throw new Error("Sign in to Bugshaper to capture bugs.");
  return session;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null || !publicAddress(tab.url)) {
    throw new Error("Open a regular website and reopen Bugshaper there.");
  }
  return tab;
}

let starting = false;

async function recordingAction(action) {
  const url = chrome.runtime.getURL(PAGE.record);
  const contexts = () => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (action === "start") {
    if (starting) throw new Error("A recording is already starting.");
    starting = true;
    try {
      const tab = await activeTab();
      if (!(await contexts()).length) {
        await chrome.offscreen.createDocument({
          url: PAGE.record, reasons: ["USER_MEDIA"], justification: "Record a tab selected by the Bugshaper user.",
        });
      }
      let documentId;
      try {
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => typeof globalThis.bugshaperProbe?.snapshot === "function",
        });
        if (probe?.result) documentId = probe.documentId;
      } catch {
        // Recording can still proceed when diagnostics are unavailable.
      }
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      return await sendRecorder({ action, streamId, origin: publicAddress(tab.url), tabId: tab.id, documentId });
    } finally {
      starting = false;
    }
  }
  if (!(await contexts()).length) return { phase: "idle", recording: false };
  return sendRecorder({ action });
}

async function sendRecorder(data) {
  const response = await chrome.runtime.sendMessage({ ...data, target: "record" });
  if (!response?.ok) throw new Error(response?.error ?? "Recorder did not respond.");
  return response.result;
}

async function run(action) {
  const recording = typeof action === "string" && action.startsWith("record:") ? action.slice(7) : null;
  if (recording !== "state") await requireSignedIn();
  if (recording) return recordingAction(recording);
  const tab = await activeTab();
  if (action === "start") {
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/capture/probe.js", "src/capture/replay-capture.js"],
    });
    try {
      const [consoleProbe] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [probe.documentId] },
        world: "MAIN",
        files: ["src/capture/console-probe.js"],
      });
      if (consoleProbe?.result) return { started: true };
    } catch {
      // Other diagnostics are still active.
    }
    return { started: true, consoleUnavailable: true };
  }
  let element = null;
  if (action === "inspect") {
    const [selection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/capture/inspect.js"],
    });
    element = selection?.result;
    if (!element) return { cancelled: true };
  } else if (action !== "open-report") {
    throw new Error("Unknown capture action.");
  }

  const selected = await activeTab();
  if (selected.id !== tab.id || selected.url !== tab.url) {
    throw new Error("The active page changed before capture. Try again.");
  }
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const [current] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (current?.id !== tab.id || current.url !== tab.url) {
    throw new Error("The active page changed during capture. Try again.");
  }
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ events: globalThis.bugshaperProbe?.stop() ?? [], replay: globalThis.bugshaperReplay?.stop() ?? [] }),
  });

  const id = crypto.randomUUID();
  const report = {
    id, title: "", createdAt: Date.now(), origin: publicAddress(tab.url),
    screenshot: await (await fetch(screenshot)).blob(),
    events: normalizeEvidence(probe?.result?.events), replay: probe?.result?.replay ?? [], element,
  };
  await saveReport(report);
  try {
    const uploaded = await submitReportToWorkspace(report);
    return { id, uploaded: true, workspaceId: uploaded.workspaceId };
  } catch (error) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(PAGE.reports + "#" + id) });
    throw new Error((error.message || "Upload failed.") + " Local draft kept.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.url === chrome.runtime.getURL(PAGE.record) && !sender.tab &&
      message?.action === "recording-evidence" && Number.isInteger(message.tabId) && typeof message.documentId === "string") {
    chrome.scripting.executeScript({
      target: { tabId: message.tabId, documentIds: [message.documentId] },
      func: () => globalThis.bugshaperProbe?.snapshot?.() ?? [],
    }).then(([probe]) => respond(normalizeEvidence(probe?.result)), () => respond([]));
    return true;
  }
  if (sender.url === chrome.runtime.getURL(PAGE.record) && !sender.tab && message?.action === "submit-report") {
    getReport(message.id).then(async (report) => {
      if (!report) throw new Error("Saved recording was not found.");
      return submitReportToWorkspace(report, { open: false });
    }).then(
      (result) => respond({ ok: true, result }),
      (error) => respond({ ok: false, error: error.message }),
    );
    return true;
  }
  if (sender.url !== chrome.runtime.getURL(PAGE.popup)) return;
  run(message?.action).then(
    (result) => respond({ ok: true, result }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});
