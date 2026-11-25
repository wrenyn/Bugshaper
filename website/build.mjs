import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicAssets } from "./src/marketing/site.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "app"), { recursive: true });

await build({
  entryPoints: [join(root, "src/app/App.jsx")],
  outfile: join(dist, "app", "app.js"),
  bundle: true,
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});

const css = [
  readFileSync(join(root, "src/app/workspace.css"), "utf8"),
  readFileSync(join(root, "src/app/dashboard.css"), "utf8"),
].join("\n");
writeFileSync(join(dist, "app", "app.css"), css);
writeFileSync(join(dist, "app", "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reports dashboard · Bugshaper</title><link rel="icon" href="/brand/mark.svg"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/dashboard.css"></head>
<body><div id="root"></div><script type="module" src="/dashboard.js"></script></body></html>
`);

const manifest = {};
for (const [route, { type, body }] of publicAssets()) {
  const file = route === "/" ? "index.html" : route.replace(/^\//, "");
  const absolute = join(dist, file);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
  manifest[route] = { type, file };
}
writeFileSync(join(dist, "asset-manifest.json"), JSON.stringify(manifest, null, 2));

const backendWww = join(root, "..", "backend", "public", "www");
try {
  rmSync(backendWww, { recursive: true, force: true });
  cpSync(dist, backendWww, { recursive: true });
  console.log("Synced website/dist → backend/public/www");
} catch {
  console.log("Skipped backend/public/www sync (sibling backend package not present)");
}
