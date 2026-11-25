const preference = "bugshaper:report-context-width";
const defaultWidth = 315;
const minimumWidth = 250;
const maximumWidth = 560;

export function mountReportDivider(divider) {
  const layout = divider.parentElement;
  const desktop = matchMedia("(min-width: 971px)");
  let preferred = defaultWidth;
  let width = defaultWidth;
  let limit = maximumWidth;
  let drag;
  try {
    const saved = Number(localStorage.getItem(preference));
    if (Number.isInteger(saved) && saved >= minimumWidth && saved <= maximumWidth) preferred = saved;
  } catch { /* The current report can still be resized. */ }

  function apply(value) {
    width = Math.max(minimumWidth, Math.min(limit, Math.round(value)));
    layout.style.setProperty("--report-context-width", width + "px");
    divider.setAttribute("aria-valuenow", String(width));
    divider.setAttribute("aria-valuetext", width + " pixels");
  }

  function updateBounds() {
    const available = layout.clientWidth - 400 - 24;
    divider.hidden = !desktop.matches || available <= minimumWidth;
    if (divider.hidden) return;
    limit = Math.min(maximumWidth, available);
    divider.setAttribute("aria-valuemin", String(minimumWidth));
    divider.setAttribute("aria-valuemax", String(limit));
    apply(drag ? width : preferred);
  }

  function save(value) {
    preferred = value;
    apply(value);
    try {
      localStorage.setItem(preference, String(value));
    } catch { /* Keep the chosen width for this report view. */ }
  }

  divider.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 48 : 16;
    const values = { ArrowLeft: width + step, ArrowRight: width - step, Home: minimumWidth, End: limit, Enter: defaultWidth };
    if (drag || !Object.hasOwn(values, event.key)) return;
    event.preventDefault();
    save(event.key === "Enter" ? defaultWidth : Math.max(minimumWidth, Math.min(limit, values[event.key])));
  });

  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, width };
    divider.classList.add("is-dragging");
  });
  divider.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) apply(drag.width + drag.x - event.clientX);
  });
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    divider.classList.remove("is-dragging");
    if (event.type === "pointercancel" || divider.hidden) apply(preferred);
    else if (width !== Math.max(minimumWidth, Math.min(limit, preferred))) save(width);
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) divider.addEventListener(type, finish);
  divider.addEventListener("dblclick", () => save(defaultWidth));
  desktop.addEventListener("change", updateBounds);
  new ResizeObserver(updateBounds).observe(layout);
  updateBounds();
}
