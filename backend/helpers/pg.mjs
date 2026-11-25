import pg from "pg";

function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function mapRow(row) {
  if (!row) return undefined;
  const mapped = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[key.toLowerCase()] = value;
  }
  return mapped;
}

function statement(prepareQuery, sql) {
  const text = convertPlaceholders(sql);
  return {
    async get(...args) {
      const result = await prepareQuery(text, args);
      return mapRow(result.rows[0]);
    },
    async all(...args) {
      const result = await prepareQuery(text, args);
      return result.rows.map(mapRow);
    },
    async run(...args) {
      const result = await prepareQuery(text, args);
      return { changes: result.rowCount ?? 0 };
    },
  };
}

export async function openDatabase(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let txClient = null;

  async function query(text, params) {
    return txClient ? txClient.query(text, params) : pool.query(text, params);
  }

  async function exec(sql) {
    const trimmed = sql.trim();
    const keyword = trimmed.split(/\s+/)[0].toUpperCase();
    if (keyword === "BEGIN") {
      if (txClient) throw new Error("Transaction already active.");
      txClient = await pool.connect();
      await txClient.query("BEGIN");
      return;
    }
    if (keyword === "COMMIT") {
      if (!txClient) throw new Error("No active transaction.");
      try {
        await txClient.query("COMMIT");
      } finally {
        txClient.release();
        txClient = null;
      }
      return;
    }
    if (keyword === "ROLLBACK") {
      if (!txClient) throw new Error("No active transaction.");
      try {
        await txClient.query("ROLLBACK");
      } finally {
        txClient.release();
        txClient = null;
      }
      return;
    }
    await query(sql);
  }

  function prepare(sql) {
    return statement(query, sql);
  }

  async function transaction(fn) {
    const client = await pool.connect();
    const previous = txClient;
    txClient = client;
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      txClient = previous;
      client.release();
    }
  }

  async function close() {
    if (txClient) {
      try {
        await txClient.query("ROLLBACK");
      } catch {
        // Pool shutdown path.
      }
      txClient.release();
      txClient = null;
    }
    await pool.end();
  }

  return { pool, prepare, exec, close, transaction };
}