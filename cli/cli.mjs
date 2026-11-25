import { extractBundle } from "./bundle.js";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { clientFromEnvironment } from "./client.mjs";
import { reportId as idPattern } from "./bundle.js";

const usage = [
  "node cli/cli.mjs list | show ID | import FILE | export ID FILE",
  "node cli/cli.mjs discussion ID | comment ID TEXT | edit ID FIELD VALUE",
  "node cli/cli.mjs share ID TTL_SECONDS | invite ID TTL_SECONDS | revoke-share ID | revoke-invite ID",
].join("\n");

async function run([command, first, second, third, ...rest]) {
  if (!command || command === "--help") return console.log(usage);
  const arity = { list: 0, show: 1, import: 1, export: 2, discussion: 1, comment: 2, edit: 3,
    share: 2, invite: 2, "revoke-share": 1, "revoke-invite": 1 };
  const args = [first, second, third].filter((value) => value !== undefined);
  if (rest.length || !Object.hasOwn(arity, command) || args.length !== arity[command]) throw new Error(usage);
  if (!["list", "import"].includes(command) && !idPattern.test(first)) throw new Error("Provide a valid report ID.");
  const request = clientFromEnvironment();
  const path = "/v1/reports/" + first?.toLowerCase();
  let result;
  switch (command) {
    case "list":
      result = await request("/v1/reports");
      break;
    case "import": {
      if (statSync(first).size > 41_000_000) throw new Error("The report file exceeds the import limit.");
      let report = JSON.parse(readFileSync(first, "utf8").replace(/^\uFEFF/, ""));
      if (report?.format === "bugshaper-report") report = await extractBundle(report);
      result = await request("/v1/reports", { method: "POST", body: report });
      break;
    }
    case "export": {
      const { report } = await request(path);
      writeFileSync(second, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      return;
    }
    case "discussion":
      result = await request(path + "/discussion");
      break;
    case "comment":
      result = await request(path + "/discussion", { method: "POST", body: { text: second } });
      break;
    case "edit":
      result = await request(path, { method: "PATCH", body: { [second]: third } });
      break;
    case "share":
    case "invite":
      result = await request(path + (command === "share" ? "/shares" : "/contributors"),
        { method: "POST", body: { ttlSeconds: Number(second) } });
      break;
    case "revoke-share":
    case "revoke-invite":
      result = await request(path + (command === "revoke-share" ? "/shares" : "/contributors"), { method: "DELETE" });
      break;
    default:
      result = await request(path);
  }
  console.log(JSON.stringify(result, null, 2));
}

run(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
