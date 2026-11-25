import { addVerification } from "../lib/storage.js";

export function mountVerification(report, status) {
  const history = document.querySelector("#verification-history");
  const form = document.querySelector("#verification");
  const button = form.querySelector("button");
  const append = (entry) => {
    const item = document.createElement("li");
    item.textContent = new Date(entry.at).toLocaleString() + " | " + entry.result +
      (entry.note ? " | " + entry.note : "");
    history.prepend(item);
  };
  for (const entry of report.verification ?? []) append(entry);
  form.onsubmit = async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const entry = { at: Date.now(), result: form.elements.namedItem("result").value,
        note: form.elements.namedItem("note").value.trim() };
      if (!(await addVerification(report.id, entry))) throw new Error("This report was deleted.");
      if (history.children.length >= 50) history.lastElementChild.remove();
      append(entry);
      form.reset();
      status.textContent = "Verification result saved to this report.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

