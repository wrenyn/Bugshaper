import { extractLocalBundle, makeLocalBundle, maxBundleBytes } from "../lib/portable-media.js";
import { addReport } from "../lib/storage.js";

export function mountImport(status) {
  const input = document.querySelector("#import-report");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    input.disabled = true;
    try {
      if (file.size > maxBundleBytes) throw new Error("The report file exceeds the import limit.");
      const report = await extractLocalBundle(JSON.parse(await file.text()));
      await addReport(report);
      location.hash = report.id;
    } catch (error) {
      status.textContent = error.name === "ConstraintError" ? "A report with this ID already exists." : error.message;
    } finally {
      input.value = "";
      input.disabled = false;
    }
  });
}

export function mountExport(initial, loadReport, status) {
  const { id } = initial;
  const fields = ["screenshot", "video"].map((name) => {
    const input = document.querySelector("#bundle-" + name);
    input.closest("label").hidden = !initial[name];
    return { input, name };
  });
  const button = document.querySelector("#export-report");
  button.onclick = async () => {
    button.disabled = true;
    try {
      const report = await loadReport(id);
      if (!report) throw new Error("This report was deleted.");
      const selected = fields.filter(({ input }) => input.checked).map(({ name }) => name);
      const bundle = await makeLocalBundle(report, selected);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "bugshaper-" + id + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

