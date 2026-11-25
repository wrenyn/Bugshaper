(() => {
  if (globalThis.bugshaperReplay) return;
  const tags = new Set(["header", "footer", "nav", "main", "section", "article", "aside", "div", "button", "input", "select", "textarea", "a", "img", "form", "table", "h1", "h2", "h3", "p", "ul", "ol", "li"]);
  const privateSelector = "[data-bugshaper-private], [data-private], [contenteditable], [hidden]";
  const frames = [];
  let last = 0;

  function frame(force = false) {
    const at = Date.now();
    if ((!force && at - last < 400) || !document.body || document.hidden || document.body.closest(privateSelector)) return;
    last = at;
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.matches(privateSelector)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;

      },
    });
    const boxes = [];
    for (let i = 0; i < 320 && boxes.length < 120; i++) {
      const node = walker.nextNode();
      if (!node) break;
      if (!tags.has(node.localName)) continue;
      const rect = node.getBoundingClientRect();
      const x = Math.round(Math.max(0, rect.left));
      const y = Math.round(Math.max(0, rect.top));
      const w = Math.round(Math.min(width, rect.right)) - x;
      const h = Math.round(Math.min(height, rect.bottom)) - y;
      if (w < 3 || h < 3) continue;
      const kind = ["button", "a", "input", "select", "textarea"].includes(node.localName) ? "control" :
        ["img", "table"].includes(node.localName) ? "media" : "layout";
      boxes.push({ x, y, w, h, kind });
    }
    frames.push({ at, width, height, boxes });
    while (frames.length > 60 || frames[0]?.at < at - 120_000) frames.shift();
  }

  const controller = new AbortController();
  function stop() {
    frame(true);
    clearInterval(interval);
    clearTimeout(expiry);
    controller.abort();
    delete globalThis.bugshaperReplay;
    return frames.filter((entry) => entry.at >= Date.now() - 120_000);
  }
  const interval = setInterval(frame, 2000);
  const expiry = setTimeout(stop, 10 * 60_000);
  for (const type of ["resize", "scroll", "click"]) {
    addEventListener(type, () => frame(), { passive: true, signal: controller.signal });
  }
  globalThis.bugshaperReplay = { stop };
  frame();
})();


