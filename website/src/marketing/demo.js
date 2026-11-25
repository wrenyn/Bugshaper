const examples = {
  click: ["Checkout clicked", "Click → button.checkout\nViewport: 375 × 812", "The interaction marks the start of the investigation."],
  network: ["Checkout request failed", "POST /api/checkout · 500\nDuration: 560 ms", "The request failed after the customer clicked Place order."],
  error: ["Checkout response could not be read", "TypeError: Cannot read properties of null\n    at submitOrder (checkout.js:42:16)", "The exception followed the failed request."],
  layout: ["Order summary shifted", "Layout shift · 0.12\nViewport: 375 × 812", "The error state pushed the summary down."],
};
const elements = {
  summary: ["section.order-summary", "main › section.order-summary\nBounds: x 16 · y 112 · 343 × 88\nParent: main · 375px wide\nViewport: 375 × 812\ndisplay: grid", "The summary fits inside the viewport."],
  address: ["fieldset.delivery", "main › form › fieldset.delivery\nBounds: x 16 · y 220 · 343 × 112\nParent: form · 343px wide\nViewport: 375 × 812\nbox-sizing: border-box", "The delivery fields follow the form width."],
  button: ["button.checkout", "main › form › button.checkout\nBounds: x 16 · y 354 · 420 × 48\nParent: form · 343px wide\nViewport: 375 × 812\ndisplay: flex\nmin-width: 420px", "The button extends 61px past the viewport’s right edge."],
};
for (const [name, data] of [["event", examples], ["element", elements]]) {
  const buttons = [...document.querySelectorAll("[data-" + name + "]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      for (const peer of buttons) peer.setAttribute("aria-pressed", String(peer === button));
      const [title, evidence, note] = data[button.dataset[name]];
      document.getElementById(name + "-title").textContent = title;
      document.getElementById(name + "-evidence").textContent = evidence;
      document.getElementById(name + "-note").textContent = note;
    });
  }
}
