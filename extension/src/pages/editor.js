import { comparePixels } from "../lib/visual.js";
import { updateScreenshot } from "../lib/storage.js";

const LIMIT = 16_000_000;
const select = (id) => document.getElementById(id);

function drawMark(context, mark, scale, preview) {
  const { x, y, width, height, type, start, end, points, text } = mark;
  context.save();
  context.strokeStyle = "#B6F36B";
  context.lineWidth = scale;
  context.lineCap = context.lineJoin = "round";
  if (type === "redact") {
    context.fillStyle = "#101310";
    context.fillRect(Math.floor(x), Math.floor(y), Math.ceil(x + width) - Math.floor(x), Math.ceil(y + height) - Math.floor(y));
  } else if (type === "highlight") {
    context.fillStyle = "#B6F36B66";
    context.fillRect(x, y, width, height);
  } else if (type === "blur") {
    const sample = document.createElement("canvas");
    sample.width = Math.max(1, Math.ceil(width / 14));
    sample.height = Math.max(1, Math.ceil(height / 14));
    sample.getContext("2d").drawImage(context.canvas, x, y, width, height, 0, 0, sample.width, sample.height);
    context.imageSmoothingEnabled = true;
    context.drawImage(sample, x, y, width, height);
  } else if (type === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const length = Math.max(10, 4 * scale);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    for (const offset of [-.55, .55]) {
      context.moveTo(end.x, end.y);
      context.lineTo(end.x - length * Math.cos(angle + offset), end.y - length * Math.sin(angle + offset));
    }
    context.stroke();
  } else if (type === "pen") {
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (const point of [...points, end]) context.lineTo(point.x, point.y);
    context.stroke();
  } else if (type === "text") {
    context.font = "bold " + Math.max(18, scale * 5) + "px sans-serif";
    context.textBaseline = "top";
    context.strokeStyle = "#101310";
    context.fillStyle = "#B6F36B";
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
  } else if (type === "outline" || (type === "crop" && preview)) {
    if (type === "crop") context.setLineDash([scale * 2, scale * 2]);
    context.strokeRect(x, y, width, height);
  }
  context.restore();
}

export function mountEditor(report, status, refreshScreenshot) {
  if (!report.screenshot) return;
  const section = select("edit-image");
  section.hidden = false;
  const canvas = select("annotations");
  const context = canvas.getContext("2d");
  const tools = [...section.querySelectorAll("[data-tool]")].filter((tool) => tool.tagName === "BUTTON");
  const textField = select("annotation-text");
  const undo = select("undo-annotation");
  const redo = select("redo-annotation");
  const discard = select("cancel-annotation");
  const save = select("save-annotation");
  let source = new Image();
  const url = URL.createObjectURL(report.screenshot);
  const marks = [];
  const undone = [];
  let tool = "select";
  let drag;
  let selection;
  let loaded = false;
  let saving = false;

  function refresh() {
    undo.disabled = saving || !marks.length;
    redo.disabled = saving || !undone.length;
    discard.disabled = saving || (!marks.length && !undone.length);
    save.disabled = saving || !marks.length;
    for (const button of tools) button.disabled = saving;
  }
  function redraw(preview) {
    if (!loaded) return;
    context.drawImage(source, 0, 0);
    const scale = Math.max(2, canvas.width / 375);
    for (const mark of marks) drawMark(context, mark, scale, false);
    if (preview) drawMark(context, preview, scale, true);
    if (selection) {
      const width = selection.width ?? Math.min(canvas.width - selection.x, (selection.text?.length ?? 1) * scale * 3);
      const height = selection.height ?? scale * 6;
      drawMark(context, { ...selection, type: "crop", x: selection.x - 4, y: selection.y - 4, width: width + 8, height: height + 8 }, scale, true);
    }
  }
  function choose(next) {
    tool = next;
    selection = undefined;
    redraw();
    canvas.dataset.tool = next;
    for (const button of tools) button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    select("annotation-label").hidden = next !== "text";
    select("annotation-hint").textContent = next === "text" ? "Enter text, then click its position on the image."
      : next === "blur" ? "Drag to soften details visually. Use Redact to cover sensitive content."
      : next === "select" ? "Choose a tool, then drag on the screenshot." : "Drag on the screenshot to apply " + next + ".";
    if (next === "text") textField.focus();
  }
  for (const button of tools) button.onclick = () => choose(button.dataset.tool);
  choose("select");
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  }
  function markAt(event) {
    const end = point(event);
    const { start, type, points } = drag;
    return { type, start, end, points, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }
  function add(mark) {
    marks.push(mark);
    undone.length = 0;
    redraw();
    refresh();
  }
  source.onload = () => {
    URL.revokeObjectURL(url);
    if (source.width * source.height > LIMIT) {
      status.textContent = "This screenshot exceeds the editor size limit.";
      return;
    }
    canvas.width = source.width;
    canvas.height = source.height;
    loaded = true;
    redraw();
  };
  source.onerror = () => { URL.revokeObjectURL(url); status.textContent = "Screenshot preview could not be decoded."; };
  source.src = url;
  canvas.addEventListener("pointerdown", (event) => {
    if (!loaded || saving || !event.isPrimary || event.button !== 0) return;
    if (tool === "select") {
      const { x, y } = point(event);
      const scale = Math.max(2, canvas.width / 375);
      selection = marks.findLast((mark) =>
        x >= mark.x - 6 && x <= mark.x + (mark.width ?? mark.text.length * scale * 3) + 6 &&
        y >= mark.y - 6 && y <= mark.y + (mark.height ?? scale * 6) + 6);
      select("annotation-hint").textContent = selection ? "Selected " + selection.type + " annotation." : "No annotation at this position.";
      redraw();
      return;
    }
    if (tool === "text") {
      const text = textField.value.trim();
      if (text) add({ ...point(event), type: tool, text });
      else textField.focus();
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    drag = { start: point(event), id: event.pointerId, type: tool, points: [] };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id !== event.pointerId) return;
    if (drag.type === "pen" && drag.points.length < 6000) drag.points.push(point(event));
    redraw(markAt(event));
  });
  canvas.addEventListener("pointerup", (event) => {
    if (drag?.id !== event.pointerId) return;
    const mark = markAt(event);
    drag = null;
    const line = ["arrow", "pen"].includes(mark.type);
    if (line ? (mark.width + mark.height >= 1 || mark.points.length) : mark.width >= 1 && mark.height >= 1) add(mark);
    else redraw();
  });
  canvas.addEventListener("lostpointercapture", () => {
    if (drag) { drag = null; redraw(); }
  });
  undo.onclick = () => { selection = undefined; if (marks.length) undone.push(marks.pop()); redraw(); refresh(); };
  redo.onclick = () => { if (undone.length) marks.push(undone.pop()); redraw(); refresh(); };
  discard.onclick = () => { selection = undefined; marks.length = undone.length = 0; redraw(); refresh(); };
  section.addEventListener("keydown", (event) => {
    if (saving || event.target.matches("input, textarea, select")) return;
    const keys = { v: "select", r: "outline", a: "arrow", p: "pen", t: "text", h: "highlight", b: "blur", x: "redact", c: "crop" };
    const next = keys[event.key.toLowerCase()];
    if (next && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const button = tools.find((item) => item.dataset.tool === next);
      button.focus();
      choose(next);
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      (event.shiftKey ? redo : undo).click();
    }
  });
  save.onclick = async () => {
    if (!loaded || !marks.length || saving) return;
    saving = true;
    refresh();
    status.textContent = "Saving screenshot.";
    let bitmap;
    try {
      selection = undefined;
      redraw();
      let edited = canvas;
      const crop = marks.findLast((mark) => mark.type === "crop");
      if (crop) {
        const left = Math.floor(crop.x);
        const top = Math.floor(crop.y);
        edited = document.createElement("canvas");
        edited.width = Math.ceil(crop.x + crop.width) - left;
        edited.height = Math.ceil(crop.y + crop.height) - top;
        edited.getContext("2d").drawImage(canvas, left, top, edited.width, edited.height, 0, 0, edited.width, edited.height);
      }
      const image = await new Promise((resolve) => edited.toBlob(resolve, "image/png"));
      if (!image) throw new Error("The annotated image could not be created.");
      bitmap = await createImageBitmap(image);
      if (!(await updateScreenshot(report.id, image))) throw new Error("The annotated image could not be saved.");
      source.close?.();
      source = bitmap;
      bitmap = undefined;
      canvas.width = source.width;
      canvas.height = source.height;
      marks.length = undone.length = 0;
      clearComparison();
      refreshScreenshot(image);
      redraw();
      status.textContent = "Screenshot saved.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      bitmap?.close();
      saving = false;
      refresh();
    }
  };

  const compareButton = select("compare");
  const candidate = select("candidate");
  const thresholdInput = select("threshold");
  const comparison = select("comparison-result");
  const view = select("comparison-view");
  const opacity = select("comparison-opacity");
  const output = select("diff");
  const outputContext = output.getContext("2d");
  let updatedImage;
  let pendingImage;
  let difference;
  let updateUrl;

  function renderComparison() {
    const sideBySide = view.value === "side-by-side";
    const overlay = view.value === "overlay";
    select("comparison-pair").hidden = !sideBySide;
    select("comparison-opacity-control").hidden = !overlay;
    output.hidden = sideBySide;
    if (sideBySide || !difference) return;
    output.setAttribute("aria-label", overlay ? "Overlay of baseline and updated screenshots" : "Highlighted pixel differences");
    if (!overlay) return outputContext.putImageData(difference, 0, 0);
    outputContext.clearRect(0, 0, output.width, output.height);
    outputContext.drawImage(source, 0, 0);
    outputContext.globalAlpha = opacity.valueAsNumber / 100;
    outputContext.drawImage(updatedImage, 0, 0);
    outputContext.globalAlpha = 1;
  }

  function clearComparison() {
    pendingImage = undefined;
    comparison.hidden = true;
    difference = undefined;
    updatedImage?.close();
    updatedImage = undefined;
    if (updateUrl) URL.revokeObjectURL(updateUrl);
    updateUrl = undefined;
  }
  candidate.onchange = thresholdInput.oninput = clearComparison;
  view.onchange = opacity.oninput = renderComparison;
  addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    clearComparison();
    source.close?.();
  });

  compareButton.onclick = async () => {
    const file = candidate.files[0];
    if (!loaded || !file) { status.textContent = "Select an updated screenshot first."; return; }
    clearComparison();
    const request = {};
    pendingImage = request;
    let bitmap;
    compareButton.disabled = true;
    try {
      if (file.size > 25_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image under 25 MB.");
      bitmap = await createImageBitmap(file);
      if (pendingImage !== request) return;
      if (bitmap.width !== source.width || bitmap.height !== source.height) throw new Error("Use a screenshot with the same dimensions as the baseline.");
      output.width = bitmap.width;
      output.height = bitmap.height;
      outputContext.drawImage(source, 0, 0);
      const baseline = outputContext.getImageData(0, 0, bitmap.width, bitmap.height);
      outputContext.clearRect(0, 0, bitmap.width, bitmap.height);
      outputContext.drawImage(bitmap, 0, 0);
      const updated = outputContext.getImageData(0, 0, bitmap.width, bitmap.height);
      const result = comparePixels(baseline.data, updated.data, thresholdInput.valueAsNumber);
      difference = new ImageData(result.overlay, bitmap.width, bitmap.height);
      updatedImage = bitmap;
      bitmap = undefined;
      updateUrl = URL.createObjectURL(file);
      select("comparison-before").src = select("shot").src;
      select("comparison-after").src = updateUrl;
      status.textContent = "";
      comparison.hidden = false;
      select("comparison-summary").textContent = result.changed.toLocaleString() + " changed pixels out of " + result.pixels.toLocaleString() + ".";
      renderComparison();
    } catch (error) {
      if (pendingImage === request) {
        clearComparison();
        status.textContent = error.message;
      }
    } finally {
      bitmap?.close();
      compareButton.disabled = false;
    }
  };
}
