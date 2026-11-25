import { makeLocalBundle } from "../lib/portable-media.js";
import { api, getSession, openWorkspace, selectedProjectId, setSelectedProjectId } from "./account.js";
import { markUpload } from "../lib/storage.js";

function writableWorkspaces(session) {
  return (session.workspaces || []).filter((w) => w.role !== "viewer");
}

export async function listProjects(workspaceId) {
  const data = await api(`/api/v1/workspaces/${workspaceId}/projects`);
  return data.projects || data || [];
}

/**
 * Upload a local report to the signed-in workspace.
 * @param {object} report
 * @param {{ open?: boolean, projectId?: string, onProgress?: (message: string) => void }} [options]
 */
export async function submitReportToWorkspace(report, { open = true, projectId, onProgress } = {}) {
  const notify = (message) => { try { onProgress?.(message); } catch { /* ignore */ } };
  const session = await getSession();
  if (!session.user) throw new Error("Sign in to Bugshaper to capture bugs.");
  const writable = writableWorkspaces(session);
  if (!writable.length) throw new Error("You need write access to a workspace to upload captures.");
  const workspaceId = writable.some((w) => w.id === session.workspaceId)
    ? session.workspaceId
    : writable[0].id;
  const chosenProject = projectId ?? (await selectedProjectId());
  notify("Preparing capture bundle…");
  await markUpload(report.id, { status: "uploading", error: "" });
  try {
    const payload = {
      ...report,
      title: (report.title || "").trim() || (report.origin ? `Capture from ${report.origin}` : "Browser capture"),
    };
    const selected = ["screenshot", "video"].filter((name) => payload[name] instanceof Blob);
    const bundle = await makeLocalBundle(payload, selected);
    if (chosenProject) bundle.projectId = chosenProject;
    notify("Uploading to your workspace…");
    const result = await api(`/api/v1/workspaces/${workspaceId}/submissions`, "POST", bundle);
    const id = result.id || report.id;
    await markUpload(report.id, { status: "uploaded", error: "", workspaceId });
    if (chosenProject) await setSelectedProjectId(chosenProject);
    notify("Upload complete.");
    if (open) await openWorkspace("/reports/" + id);
    return { workspaceId, id, projectId: chosenProject || "" };
  } catch (error) {
    await markUpload(report.id, { status: "failed", error: error.message || "Upload failed." });
    throw error;
  }
}
