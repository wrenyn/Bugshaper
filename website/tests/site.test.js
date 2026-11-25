import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { publicAssets } from "../src/marketing/site.mjs";

const htmlRoutes = ["/", "/features", "/docs", "/pricing", "/changelog", "/privacy", "/terms", "/login"];

test("marketing pages link to real routes, anchors and shared design assets", () => {
  const assets = publicAssets();
  for (const route of htmlRoutes) {
    const page = assets.get(route);
    assert.match(page.type, /^text\/html/);
    assert.match(page.body, /<main id="main"/);
    for (const [, href] of page.body.matchAll(/(?:href|src)="([/#][^"]+)"/g)) {
      const [target, anchor] = href.split("#");
      if (target === "/viewer" || target === "/dashboard") continue; // Registered separately by the API.
      assert.ok(assets.has(target || route), route + " links to missing " + href);
      if (anchor) assert.ok(String(assets.get(target || route).body).includes('id="' + anchor + '"'), "Missing anchor: " + href);
    }
  }
  const css = assets.get("/theme.css").body.toString();
  for (const [, font] of css.matchAll(/url\("\.\/brand\/([^"]+)"\)/g)) {
    assert.equal(assets.get("/brand/" + font).type, "font/woff2");
    assert.equal(assets.get("/brand/" + font).body.subarray(0, 4).toString(), "wOF2");
  }
  assert.equal((css.match(/@font-face/g) ?? []).length, 4);
  for (const size of ["16", "32", "48", "128"]) {
    const png = assets.get("/brand/icon-" + size + ".png").body;
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
  const social = assets.get("/brand/social.png").body;
  assert.deepEqual([social.readUInt32BE(16), social.readUInt32BE(20)], [1200, 630]);
  assert.match(assets.get("/").body, /Example report/);
  assert.doesNotMatch(assets.get("/").body, /chromewebstore\.google\.com/);
});

test("both product demos update visible evidence and pressed state", () => {
  const assets = publicAssets();
  const controls = [...assets.get("/").body.matchAll(/data-(event|element)="([^"]+)"/g)].map(([, group, key]) => ({
    group, dataset: { [group]: key },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, action) { this[name] = action; },
  }));
  const result = new Map();
  const document = {
    querySelectorAll(selector) { return controls.filter((item) => selector === "[data-" + item.group + "]"); },
    getElementById(id) {
      if (!result.has(id)) result.set(id, {});
      return result.get(id);
    },
  };
  runInNewContext(assets.get("/demo.js").body.toString(), { document });
  const network = controls.find((item) => item.dataset.event === "network");
  network.click();
  assert.equal(network["aria-pressed"], "true");
  assert.match(result.get("event-evidence").textContent, /500/);
  const address = controls.find((item) => item.dataset.element === "address");
  address.click();
  assert.equal(address["aria-pressed"], "true");
  assert.match(result.get("element-title").textContent, /fieldset/);
  assert.equal(controls.find((item) => item.dataset.element === "button")["aria-pressed"], "false");
});
