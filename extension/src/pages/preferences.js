const key = "bugshaper:preferences";
const defaults = { window: "120", speed: "1" };

export function preferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    return { window: ["30", "60", "120"].includes(stored.window) ? stored.window : defaults.window,
      speed: ["0.5", "1", "1.5", "2"].includes(stored.speed) ? stored.speed : defaults.speed };
  } catch {
    return { ...defaults };
  }
}

export function mountPreferences(target) {
  const form = document.createElement("form");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const selected = preferences();
  function addSelect(name, label, choices) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("select");
    input.name = name;
    for (const [value, title] of choices) input.add(new Option(title, value));
    input.value = selected[name];
    wrap.append(input);
    form.append(wrap);
  }
  addSelect("window", "Default replay window", [["30", "30 seconds"], ["60", "60 seconds"], ["120", "120 seconds"]]);
  addSelect("speed", "Default playback speed", [["0.5", "0.5x"], ["1", "1x"], ["1.5", "1.5x"], ["2", "2x"]]);
  const button = document.createElement("button");
  button.textContent = "Save playback settings";
  form.append(button, status);
  form.onsubmit = (event) => {
    event.preventDefault();
    try {
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(new FormData(form))));
      status.textContent = "Playback settings saved on this device.";
    } catch {
      status.textContent = "Playback settings could not be saved.";
    }
  };
  target.append(form);
}
