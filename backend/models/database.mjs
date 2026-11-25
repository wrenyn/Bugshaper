import { readFileSync } from "node:fs";
import { transaction } from "../helpers/http.mjs";

export async function migrate(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS platform_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)",
  );
  for (const [version, file] of [
    [1, "001-platform.sql"],
    [2, "002-checkout-recovery.sql"],
    [3, "003-operations.sql"],
    [4, "004-media-storage.sql"],
    [5, "005-platform-shares.sql"],
  ]) {
    if (!(await db.prepare("SELECT 1 FROM platform_migrations WHERE version = ?").get(version))) {
      await transaction(db, async () => {
        await db.exec(readFileSync(new URL("../db/migrations/" + file, import.meta.url), "utf8"));
        await db.prepare("INSERT INTO platform_migrations VALUES (?, ?)").run(version, Date.now());
      });
    }
  }
}