(() => {
  const key = Symbol.for("bugshaper.consoleProbe");
  if (typeof globalThis[key] === "boolean") return globalThis[key];
  const output = globalThis.console;
  const emit = document.dispatchEvent.bind(document);
  const EventType = Event;
  const ExceptionEvent = CustomEvent;
  const stringify = JSON.stringify;
  const call = Reflect.apply;
  const installed = new Map();
  const errors = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError"]);
  const controller = new AbortController();
  let remaining = 60;
  let timer;

  function stop() {
    remaining = 0;
    clearTimeout(timer);
    controller.abort();
    for (const [level, { descriptor, wrapper }] of installed) {
      if (Object.getOwnPropertyDescriptor(output, level)?.value !== wrapper) continue;
      if (descriptor) Object.defineProperty(output, level, descriptor);
      else delete output[level];
    }
    document.removeEventListener("bugshaper:stop-console", stop);
    delete globalThis[key];
  }

  function reportException(detail) {
    try {
      emit(new ExceptionEvent("bugshaper:exception", { detail: stringify(detail) }));
    } catch { /* Diagnostics must not create additional page exceptions. */ }
  }

  addEventListener("error", (event) => {
    if (!event.isTrusted || !(event instanceof ErrorEvent)) return;
    let label = "Script error";
    let origin;
    try {
      const name = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(event.error), "name")?.value;
      if (errors.has(name)) label = name;
    } catch { /* Use the generic label when the error has no standard prototype. */ }
    try {
      const url = new URL(event.filename);
      if (["http:", "https:"].includes(url.protocol)) origin = url.origin;
    } catch { /* Source location is optional. */ }
    reportException({ label, origin, line: event.lineno, column: event.colno });
  }, { capture: true, signal: controller.signal });
  addEventListener("unhandledrejection", (event) => {
    if (event.isTrusted) reportException({ label: "Unhandled rejection" });
  }, { signal: controller.signal });
  for (const level of ["debug", "log", "info", "warn", "error", "trace"]) {
    const descriptor = Object.getOwnPropertyDescriptor(output, level);
    const original = descriptor?.value ?? (!descriptor ? output[level] : null);
    if (typeof original !== "function" || descriptor?.writable === false) continue;
    const wrapper = function (...args) {
      const result = call(original, this, args);
      if (remaining > 0) {
        remaining--;
        try { emit(new EventType("bugshaper:console:" + level)); } catch { /* Preserve page console behavior. */ }
      }
      return result;
    };
    try {
      Object.defineProperty(output, level, { configurable: true, enumerable: false, writable: true, ...descriptor, value: wrapper });
      installed.set(level, { descriptor, wrapper });
    } catch { /* The page can lock a console method. */ }
  }
  globalThis[key] = installed.size > 0;
  document.addEventListener("bugshaper:stop-console", stop, { once: true });
  timer = setTimeout(stop, 10 * 60 * 1000);
  return globalThis[key];
})();
