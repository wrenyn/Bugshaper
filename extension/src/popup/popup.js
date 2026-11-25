import {
  getSession, openSignIn, openWorkspace, selectedProjectId, setSelectedProjectId,
  setSelectedWorkspaceId, setWorkspaceOrigin, waitForSession, workspaceOrigin,
} from "../capture/account.js";
import { listProjects } from "../capture/submit.js";

const status = document.querySelector("#status");
const authPanel = document.querySelector("#auth-panel");
const capturePanel = document.querySelector("#capture-panel");
const originInput = document.querySelector("#workspace-origin");
const workspaceSelect = document.querySelector("#workspace-select");
const projectSelect = document.querySelector("#project-select");
const captureButtons = [...document.querySelectorAll("#start, #open-report, #inspect")];
const recordStart = document.querySelector("#record-start");
const projectError = document.querySelector("#project-error");

function showSignedOut(session, message) {
  authPanel.hidden = false;
  capturePanel.hidden = true;
  originInput.value = session.origin;
  document.querySelector("#auth-message").textContent = message
    || (session.reason === "permission"
      ? "Allow access to your Bugshaper workspace, then sign in."
      : "Sign in to your Bugshaper workspace to capture bugs.");
}

function fillWorkspaces(session) {
  workspaceSelect.replaceChildren();
  const writable = session.workspaces.filter((w) => w.role !== "viewer");
  for (const workspace of writable) {
    workspaceSelect.add(new Option(
      `${workspace.name} (${workspace.role})`,
      workspace.id,
      workspace.id === session.workspaceId,
      workspace.id === session.workspaceId,
    ));
  }
  workspaceSelect.disabled = writable.length <= 1;
  if (!writable.length) {
    workspaceSelect.add(new Option("No writable workspace", "", true, true));
    workspaceSelect.disabled = true;
  }
}

async function fillProjects(workspaceId) {
  const previous = projectSelect.value || await selectedProjectId();
  projectSelect.replaceChildren(new Option("No project", ""));
  if (projectError) {
    projectError.hidden = true;
    projectError.textContent = "";
  }
  if (!workspaceId) {
    projectSelect.disabled = true;
    return;
  }
  try {
    const projects = await listProjects(workspaceId);
    for (const project of projects) {
      projectSelect.add(new Option(project.name, project.id, project.id === previous, project.id === previous));
    }
    projectSelect.disabled = false;
    if (previous && ![...projectSelect.options].some((o) => o.value === previous)) {
      projectSelect.value = "";
      await setSelectedProjectId("");
    } else if (previous) {
      projectSelect.value = previous;
    }
  } catch (error) {
    projectSelect.disabled = true;
    if (projectError) {
      projectError.hidden = false;
      projectError.textContent = error.message || "Could not load projects for this workspace.";
    }
  }
}

async function showSignedIn(session) {
  authPanel.hidden = true;
  capturePanel.hidden = false;
  document.querySelector("#account-name").textContent = session.user.name;
  document.querySelector("#account-email").textContent = session.user.email;
  fillWorkspaces(session);
  await fillProjects(session.workspaceId);
}

async function refreshAuth() {
  const session = await getSession();
  if (!session.user) {
    showSignedOut(session);
    return null;
  }
  await showSignedIn(session);
  return session;
}

async function requireSession() {
  const session = await getSession();
  if (!session.user) {
    showSignedOut(session, "Sign in required before capturing.");
    throw new Error("Sign in to Bugshaper to capture bugs.");
  }
  if (!session.workspaces.some((w) => w.id === session.workspaceId && w.role !== "viewer")) {
    throw new Error("Choose a workspace you can write to.");
  }
  await setSelectedProjectId(projectSelect.value || "");
  return session;
}

for (const button of captureButtons) {
  button.addEventListener("click", async () => {
    for (const control of captureButtons) control.disabled = true;
    if (recordStart) recordStart.disabled = true;
    status.textContent = "";
    try {
      await requireSession();
      if (button.id === "open-report" || button.id === "inspect") status.textContent = "Capturing and uploading…";
      const response = await chrome.runtime.sendMessage({ action: button.id });
      if (!response?.ok) throw new Error(response?.error ?? "Capture did not respond.");
      if (response.result?.cancelled) { status.textContent = "Element selection closed."; return; }
      status.textContent = button.id === "start"
        ? response.result?.consoleUnavailable
          ? "Diagnostics started. Console levels are unavailable on this page."
          : "Diagnostics started for this page. Capture within 10 minutes or before navigating."
        : "Uploaded to your workspace. The report opened in a new tab.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      for (const control of captureButtons) control.disabled = false;
      if (recordStart) recordStart.disabled = false;
    }
  });
}

document.querySelector("#sign-in").addEventListener("click", async () => {
  const authMessage = document.querySelector("#auth-message");
  const signIn = document.querySelector("#sign-in");
  try {
    if (originInput.value.trim()) await setWorkspaceOrigin(originInput.value.trim());
    signIn.disabled = true;
    authMessage.textContent = "Opening sign-in…";
    await openSignIn();
    authMessage.textContent = "Waiting for sign-in in the browser tab…";
    const session = await waitForSession();
    if (!session.user) {
      authMessage.textContent = "Still signed out. Finish Google sign-in, then choose Check again.";
      return;
    }
    await showSignedIn(session);
    authMessage.textContent = "";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    signIn.disabled = false;
  }
});

document.querySelector("#save-origin").addEventListener("click", async () => {
  try {
    const origin = await setWorkspaceOrigin(originInput.value.trim() || await workspaceOrigin());
    originInput.value = origin;
    document.querySelector("#auth-message").textContent = "Workspace URL saved. Sign in to continue.";
  } catch (error) {
    document.querySelector("#auth-message").textContent = error.message;
  }
});

document.querySelector("#refresh-session").addEventListener("click", async () => {
  const authMessage = document.querySelector("#auth-message");
  authMessage.textContent = "Checking your session…";
  const session = await refreshAuth();
  if (!session) authMessage.textContent = "Still signed out. Finish Google sign-in in the browser tab, then check again.";
  else authMessage.textContent = "";
});

document.querySelector("#open-settings").addEventListener("click", async () => {
  const session = await getSession();
  showSignedOut(session, "Update your workspace URL, then sign in.");
  authPanel.hidden = false;
});

workspaceSelect.addEventListener("change", async () => {
  await setSelectedWorkspaceId(workspaceSelect.value);
  await setSelectedProjectId("");
  await fillProjects(workspaceSelect.value);
});

projectSelect.addEventListener("change", async () => {
  await setSelectedProjectId(projectSelect.value);
});

document.querySelector("#open-workspace")?.addEventListener("click", async () => {
  try {
    await requireSession();
    await openWorkspace("/dashboard");
  } catch (error) {
    if (status) status.textContent = error.message;
  }
});

document.querySelector("#reports")?.addEventListener("click", async () => {
  try {
    await requireSession();
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/drafts.html") });
  } catch (error) {
    if (status) status.textContent = error.message;
  }
});

recordStart?.addEventListener("click", async (event) => {
  try {
    await requireSession();
  } catch (error) {
    event.stopImmediatePropagation();
    if (status) status.textContent = error.message;
  }
}, true);

refreshAuth().catch(() => {
  showSignedOut({ origin: "http://localhost:4318", reason: "signed_out" }, "Could not reach Bugshaper. Check the workspace URL.");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAuth().catch(() => {});
});
