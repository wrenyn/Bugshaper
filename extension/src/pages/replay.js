import { preferences } from "./preferences.js";
export function frameAt(frames, instant) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (frames[mid].at <= instant) lo = mid + 1;
    else hi = mid;
  }
  return lo ? frames[lo - 1] : null;
}

export function mountReplay(report) {
  const frames = report.replay;
  if (!frames?.length) return;
  const panel = document.querySelector("#replay");
  panel.hidden = false;
  const slider = document.querySelector("#replay-position");
  const duration = document.querySelector("#replay-duration");
  const speed = document.querySelector("#replay-speed");
  const canvas = document.querySelector("#replay-canvas");
  const context = canvas.getContext("2d");
  const button = document.querySelector("#replay-play");
  const caption = document.querySelector("#replay-caption");
  let job = 0;
  let previous = 0;
  let base;
  let limit;
  let displayed;
  const end = frames.at(-1).at;
  const defaults = preferences();
  duration.value = defaults.window;
  speed.value = defaults.speed;

  function paint(instant) {
    const frame = frameAt(frames, instant) ?? frames[0];
    slider.value = String(instant - base);
    caption.textContent = new Date(frame.at).toLocaleTimeString() + " | " + frame.width + " x " + frame.height;
    if (frame === displayed) return;
    displayed = frame;
    canvas.width = Math.max(1, Math.round(frame.width * Math.min(1, 1000 / Math.max(frame.width, frame.height))));
    canvas.height = Math.max(1, Math.round(frame.height * Math.min(1, 1000 / Math.max(frame.width, frame.height))));
    context.setTransform(canvas.width / frame.width, 0, 0, canvas.height / frame.height, 0, 0);
    context.fillStyle = "#101310";
    context.fillRect(0, 0, frame.width, frame.height);
    context.lineWidth = 1;
    for (const { x, y, w, h, kind } of frame.boxes) {
      context.strokeStyle = kind === "control" ? "#B6F36B" : kind === "media" ? "#82C9A9" : "#929B8E";
      context.strokeRect(x, y, w, h);
    }
  }

  function pause() {
    cancelAnimationFrame(job);
    job = 0;
    previous = 0;
    button.textContent = "Play";
  }

  function tick(time) {
    const position = Number(slider.value) + (previous ? (time - previous) * Number(speed.value) : 0);
    previous = time;
    paint(base + Math.min(limit, position));
    if (position >= limit) return pause();
    job = requestAnimationFrame(tick);
  }

  function windowFrom(start) {
    pause();
    base = Math.max(frames[0].at, start);
    limit = end - base;
    slider.max = String(limit);
    button.disabled = !limit;
    paint(base);
  }

  slider.oninput = () => paint(base + Number(slider.value));
  duration.onchange = () => windowFrom(end - Number(duration.value) * 1000);
  button.onclick = () => {
    if (job) return pause();
    if (Number(slider.value) >= limit) paint(base);
    button.textContent = "Pause";
    job = requestAnimationFrame(tick);
  };
  addEventListener("pagehide", pause);
  duration.onchange();

  return (instant) => {
    if (instant < frames[0].at || instant > end) return;
    if (instant < base) { duration.value = "120"; duration.onchange(); }
    pause();
    paint(instant);
  };
}

