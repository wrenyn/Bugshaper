import { clientFromEnvironment } from "./client.mjs";
import { reportId as idPattern } from "./bundle.js";

const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const list = "list_bug_reports";
const fields = {
  get_bug_report: "Get a report and observed classification signals.",
  get_bug_timeline: "Get the ordered diagnostic events.",
  get_console_logs: "Get captured JavaScript exception metadata.",
  get_network_requests: "Get sanitized resource timing metadata.",
  get_bug_reproduction_steps: "Get user-entered reproduction notes.",
};
const tools = [
  { name: list, description: "List available bug reports.", inputSchema: {
    type: "object", additionalProperties: false, properties: {
      limit: { type: "integer", minimum: 1, maximum: 50 },
      offset: { type: "integer", minimum: 0, maximum: 10000 },
    },
  } },
  ...Object.entries(fields).map(([name, description]) => ({ name, description, inputSchema: {
    type: "object", additionalProperties: false, properties: { id: { type: "string", pattern: idPattern.source } }, required: ["id"],
  } })),
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true } }));

const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

export function createHandler(request) {
  let state = "new";
  return async (message) => {
    const id = message?.id;
    if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" ||
        (id !== undefined && typeof id !== "string" && !Number.isSafeInteger(id))) {
      return failure(null, -32600, "Invalid request");
    }
    if (id === undefined) {
      if (message.method === "notifications/initialized" && state === "initializing") state = "ready";
      return;
    }
    if (message.method === "initialize" && state === "new") {
      const requested = message.params?.protocolVersion;
      if (typeof requested !== "string") return failure(id, -32602, "Invalid protocol version");
      state = "initializing";
      return reply(id, { protocolVersion: versions.includes(requested) ? requested : versions[0], capabilities: { tools: {} },
        serverInfo: { name: "bugshaper", version: "0.2.0" } });
    }
    if (message.method === "ping") return reply(id, {});
    if (state !== "ready") return failure(id, -32000, "MCP session is not initialized");
    if (message.method === "tools/list") return reply(id, { tools });
    if (message.method !== "tools/call") return failure(id, -32601, "Method not found");

    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (!object(args) || !tools.some((tool) => tool.name === name)) return failure(id, -32602, "Invalid tool or arguments");
    let path;
    if (name === list) {
      const { limit = 20, offset = 0 } = args;
      if (Object.keys(args).some((key) => !["limit", "offset"].includes(key)) ||
          !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
        return failure(id, -32602, "Invalid pagination");
      }
      path = "/v1/reports?limit=" + limit + "&offset=" + offset;
    } else {
      if (Object.keys(args).length !== 1 || typeof args.id !== "string" || !idPattern.test(args.id)) {
        return failure(id, -32602, "Invalid report id");
      }
      path = "/v1/reports/" + args.id.toLowerCase();
    }
    try {
      const data = await request(path);
      let value = data;
      if (name === "get_bug_timeline") value = data.report.events;
      if (name === "get_console_logs") value = data.report.events.filter((event) => event.kind === "exception");
      if (name === "get_network_requests") value = data.report.events.filter((event) => event.kind === "network");
      if (name === "get_bug_reproduction_steps") value = { notes: data.report.reproduction ?? "" };
      return reply(id, { content: [{ type: "text", text: JSON.stringify({ source: "untrusted report evidence", data: value }) }] });
    } catch {
      return reply(id, { isError: true, content: [{ type: "text", text: "Bugshaper could not retrieve this report." }] });
    }
  };
}

async function main() {
  const handle = createHandler(clientFromEnvironment());
  let pending = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line.trim()) continue;
      if (line.length > 65536) throw new Error("MCP request exceeds the line limit.");
      let message;
      try { message = JSON.parse(line); }
      catch { process.stdout.write(JSON.stringify(failure(null, -32700, "Parse error")) + "\n"); continue; }
      const response = await handle(message);
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    }
    if (pending.length > 65536) throw new Error("MCP request exceeds the line limit.");
  }
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
