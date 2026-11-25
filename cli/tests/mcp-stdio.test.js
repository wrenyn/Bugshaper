import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("the MCP subprocess negotiates and lists its read-only tools over stdio", { timeout: 5000 }, async (t) => {
  const entry = fileURLToPath(new URL("../mcp.mjs", import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, BUGSHAPER_API_TOKEN: "test-agent-only", BUGSHAPER_API_URL: "http://127.0.0.1:4318" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  const messages = [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
  ];
  child.stdin.end(messages.map((message) => JSON.stringify({ jsonrpc: "2.0", ...message })).join("\n") + "\n");
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  const [hello, commands] = output.trim().split("\n").map(JSON.parse);
  assert.equal(hello.result.protocolVersion, "2025-06-18");
  assert.equal(commands.result.tools.length, 6);
  assert.ok(commands.result.tools.every((tool) => tool.annotations.readOnlyHint));
});
