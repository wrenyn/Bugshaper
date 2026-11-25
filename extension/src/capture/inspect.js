(() => {
  if (globalThis.bugshaperInspecting) return null;
  globalThis.bugshaperInspecting = true;
  const controller = new AbortController();
  const signal = controller.signal;
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #B6F36B;background:#B6F36B28;display:none";
  overlay.setAttribute("aria-hidden", "true");
  const help = document.createElement("div");
  help.setAttribute("role", "status");
  help.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;bottom:12px;left:12px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:8px 12px;border:1px solid #82C9A9;border-radius:8px;background:#101310;color:#EDF2E9;font:14px/1.4 system-ui";
  document.documentElement.append(overlay, help);
  const instructions = "Bugshaper: Click an element or use Tab and Enter. Press Esc to cancel.";
  const privateSelector = "[data-bugshaper-private], [data-private], [contenteditable], [hidden]";
  help.textContent = instructions;

  function box(element) {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }

  function tag(target) {
    const value = target.localName;
    return /^[a-z][a-z0-9]{0,39}$/.test(value) ? value : "custom-element";
  }

  function childIndex(node) {
    let index = 1;
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (++index > 1000) return null;
    }
    return index;
  }

  function uniqueSelector(element) {
    const segments = [];
    let node = element;
    while (node && segments.length < 24) {
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        const index = childIndex(node);
        if (!index || !node.parentElement && node !== root) return null;
        if (node.parentNode === root) {
          segments.push((tag(node) === "custom-element" ? "*" : tag(node)) + ":nth-child(" + index + ")");
          segments.push(":host(" + tag(root.host) + ")");
          node = root.host;
          continue;
        }
        if (!node.parentElement) return null;
        segments.push((tag(node) === "custom-element" ? "*" : tag(node)) + ":nth-child(" + index + ")");
        node = node.parentElement;
        continue;
      }
      if (node === document.documentElement) break;
      if (!node.parentElement) return null;
      const index = childIndex(node);
      if (!index) return null;
      segments.push((tag(node) === "custom-element" ? "*" : tag(node)) + ":nth-child(" + index + ")");
      node = node.parentElement;
    }
    if (segments.some((part) => part.startsWith(":host("))) {
      return segments.reverse().join(" >>> ");
    }
    const selector = [":root", ...segments.reverse()].join(" > ");
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element ? selector : null;
    } catch {
      return null;
    }
  }

  function composedElement(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof Element && node !== overlay && node !== help) return node;
    }
    return event.target instanceof Element ? event.target : null;
  }

  function captureBranch(element) {
    const tree = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    // Walk a bounded number of nodes, including skipped branches.
    for (let node = walker.firstChild(), depth = 1, visited = 0; node && visited < 80; visited++) {
      const visible = node !== overlay && node !== help && !node.matches(privateSelector);
      if (visible) tree.push({ tag: tag(node), depth });
      if (visible && depth < 5 && walker.firstChild()) {
        node = walker.currentNode;
        depth++;
        continue;
      }
      while (depth > 0 && !walker.nextSibling()) {
        walker.parentNode();
        depth--;
      }
      node = depth ? walker.currentNode : null;
    }
    return tree;
  }

  function describe(element) {
    const properties = ["display", "position", "overflow-x", "overflow-y", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height", "margin", "padding", "border", "z-index", "flex-direction", "align-items", "justify-content", "grid-template-columns", "gap", "font-size", "line-height", "white-space", "text-overflow", "opacity", "visibility", "transform"];
    function styles(target) {
      const computed = getComputedStyle(target);
      return Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property).slice(0, 160)]));
    }
    const bounds = box(element);
    const parent = element.parentElement;
    const viewport = { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio };
    const anomalies = [];
    if (bounds.x < 0 || bounds.x + bounds.width > viewport.width + 1) anomalies.push("Element extends past the viewport horizontally");
    if (element.scrollWidth > element.clientWidth + 1) anomalies.push("Content exceeds the element's visible width");
    if (element.scrollHeight > element.clientHeight + 1) anomalies.push("Content exceeds the element's visible height");
    if (!bounds.width || !bounds.height) anomalies.push("Element has zero width or height");
    const ancestry = [];
    for (let cursor = parent; cursor && ancestry.length < 8; cursor = cursor.parentElement) ancestry.push(tag(cursor));
    const root = element.getRootNode();
    const shadowHost = root instanceof ShadowRoot ? tag(root.host) : null;
    return { tag: tag(element), bounds, viewport, ancestry, styles: styles(element),
      selector: uniqueSelector(element), descendants: captureBranch(element),
      shadow: Boolean(shadowHost), shadowHost,
      parent: parent ? { tag: tag(parent), bounds: box(parent), styles: styles(parent) } : null, anomalies };
  }

  return new Promise((resolve) => {
    function finish(result) {
      controller.abort();
      clearTimeout(timeout);
      overlay.remove();
      help.remove();
      delete globalThis.bugshaperInspecting;
      resolve(result);
    }
    const timeout = setTimeout(() => finish(null), 25_000);
    function selectElement(target) {
      if (target.closest(privateSelector)) {
        help.textContent = "Bugshaper: This element is private. Select another element or press Esc to cancel.";
        return;
      }
      finish(describe(target));
    }
    function highlight(target) {
      if (!(target instanceof Element)) return;
      if (target.closest(privateSelector)) {
        overlay.style.display = "none";
        return;
      }
      if (help.textContent !== instructions) help.textContent = instructions;
      const { x, y, width, height } = box(target);
      Object.assign(overlay.style, { display: "block", left: x + "px", top: y + "px", width: width + "px", height: height + "px" });
    }
    for (const type of ["pointermove", "focusin"]) {
      addEventListener(type, (event) => highlight(event.target), { capture: true, signal });
    }
    for (const type of ["pointerdown", "pointerup"]) {
      addEventListener(type, (event) => {
        if (event.isTrusted && event.button === 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, { capture: true, signal });
    }
    addEventListener("click", (event) => {
      const target = composedElement(event);
      if (!event.isTrusted || !target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectElement(target);
    }, { capture: true, signal });
    addEventListener("keydown", (event) => {
      if (!event.isTrusted) return;
      const target = document.activeElement;
      const select = event.key === "Enter" && target && target !== document.body && target !== document.documentElement;
      if (!select && event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (select) selectElement(target);
      else finish(null);
    }, { capture: true, signal });
  });
})();
