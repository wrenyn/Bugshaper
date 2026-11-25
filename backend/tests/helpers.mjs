import { readFileSync } from "node:fs";
import { openDatabase } from "../helpers/pg.mjs";
import { migrate } from "../models/database.mjs";

/** Default test DB — override with BUGSHAPER_TEST_DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.BUGSHAPER_TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://bugshaper:bugshaper@127.0.0.1:5432/bugshaper_test";

const SCHEMA_SQL = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const DB_UNAVAILABLE =
  "Cannot connect to the test database. Start Postgres (from repo root: docker compose up -d postgres) " +
  "and ensure the bugshaper_test database exists (see backend/scripts/init-databases.sql). " +
  `Connection: ${TEST_DATABASE_URL}`;

async function resetSchema(db) {
  await db.exec("DROP SCHEMA IF EXISTS public CASCADE");
  await db.exec("CREATE SCHEMA public");
  await db.exec("GRANT ALL ON SCHEMA public TO public");
  await db.exec(SCHEMA_SQL);
  await migrate(db);
}

/** Opens a fresh schema for the test; registers `t.after` to close the pool. */
export async function withDb(t) {
  let db;
  try {
    db = await openDatabase(TEST_DATABASE_URL);
  } catch (error) {
    const message = `${DB_UNAVAILABLE}\n${error?.message || error}`;
    throw Object.assign(new Error(message), { cause: error });
  }
  try {
    await resetSchema(db);
  } catch (error) {
    await db.close().catch(() => {});
    const message = error?.code === "ECONNREFUSED" || error?.code === "3D000"
      ? `${DB_UNAVAILABLE}\n${error.message}`
      : error.message;
    throw new Error(message, { cause: error });
  }
  t.after(() => db.close());
  return db;
}