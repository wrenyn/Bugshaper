import { lifecycle } from "./bundle.js";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bugshaper", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, query) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction("reports", mode);
      const request = query(tx.objectStore("reports"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Report storage was interrupted."));
    });
  } finally {
    database.close();
  }
}

export function saveReport(report) {
  return transact("readwrite", (store) => store.put(report));
}

export function getReport(id) {
  return transact("readonly", (store) => store.get(id));
}

export function deleteReport(id) {
  return transact("readwrite", (store) => {
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      for (const relatedId of lookup.result?.relatedReports ?? []) {
        const related = store.get(relatedId);
        related.onsuccess = () => {
          const report = related.result;
          if (report) store.put({ ...report, relatedReports: (report.relatedReports ?? []).filter((value) => value !== id) });
        };
      }
      store.delete(id);
    };
    return {};
  });
}

export const relatedReportLimit = 30;

export function setReportLink(id, relatedId, linked) {
  if (id === relatedId) return Promise.resolve("self");
  return transact("readwrite", (store) => {
    const outcome = { result: "missing" };
    const left = store.get(id);
    const right = store.get(relatedId);
    right.onsuccess = () => {
      const report = left.result;
      const related = right.result;
      if (!report || !related) return;
      const first = new Set(report.relatedReports ?? []);
      const second = new Set(related.relatedReports ?? []);
      if (linked && ((!first.has(relatedId) && first.size >= relatedReportLimit) ||
          (!second.has(id) && second.size >= relatedReportLimit))) {
        outcome.result = "limit";
        return;
      }
      if (linked) {
        first.add(relatedId);
        second.add(id);
      } else {
        first.delete(relatedId);
        second.delete(id);
      }
      store.put({ ...report, relatedReports: [...first] });
      store.put({ ...related, relatedReports: [...second] });
      outcome.result = "saved";
    };
    return outcome;
  });
}

export function listReports() {
  return transact("readonly", (store) => {
    const reports = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const {
        id, title, origin, createdAt, status = "Open", project, severity, assignee, category,
        screenshot, video, element, uploadStatus = "", uploadError = "",
      } = cursor.value;
      reports.push({
        id, title, origin, createdAt, status, project, severity, assignee, category,
        screenshot: Boolean(screenshot), video: Boolean(video), element: Boolean(element),
        uploadStatus, uploadError,
      });
      cursor.continue();
    };
    return { result: reports };
  });
}

export function markUpload(id, { status, error = "", workspaceId = "" }) {
  return updateReport(id, {
    uploadStatus: status,
    uploadError: error,
    uploadedWorkspaceId: workspaceId || undefined,
    uploadedAt: status === "uploaded" ? Date.now() : undefined,
  });
}

function updateReport(id, changes) {
  return transact("readwrite", (store) => {
    const lookup = store.get(id);
    lookup.onsuccess = () => {
      if (!lookup.result) return;
      store.put({ ...lookup.result, ...(typeof changes === "function" ? changes(lookup.result) : changes) });
    };
    return lookup;
  });
}

export function updateNotes(id, notes) {
  return updateReport(id, notes);
}

export async function updateReportStatuses(ids, status) {
  if (!lifecycle.includes(status)) throw new Error("Choose a valid report status.");
  return transact("readwrite", (store) => {
    const result = { updated: [], unchanged: 0, missing: [] };
    for (const id of new Set(ids)) {
      const lookup = store.get(id);
      lookup.onsuccess = () => {
        const report = lookup.result;
        if (!report) {
          result.missing.push(id);
        } else if ((report.status ?? "Open") === status) {
          result.unchanged++;
        } else {
          store.put({ ...report, status });
          result.updated.push(id);
        }
      };
    }
    return { result };
  });
}

export function updateScreenshot(id, screenshot) {
  return updateReport(id, { screenshot });
}

export function addReport(report) {
  return transact("readwrite", (store) => store.add(report));
}

export function addVerification(id, entry) {
  return updateReport(id, (report) => ({
    verification: [...(report.verification ?? []), entry].slice(-50),
  }));
}

