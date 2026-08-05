import "dotenv/config";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./conn";

// Arbitrary but stable: every runner competes for this same lock id.
const MIGRATION_LOCK_ID = 4242424242;

const migrationsFolder = path.resolve(__dirname, "migrations");

async function main() {
  const client = await pool.connect();

  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [MIGRATION_LOCK_ID],
    );

    if (!lock.rows[0]?.acquired) {
      throw new Error(
        "Another migration run holds the advisory lock. Aborting.",
      );
    }

    try {
      console.log(`Applying migrations from ${migrationsFolder}`);
      await migrate(db, { migrationsFolder });
      console.log("Migrations up to date");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  process.exit(1);
});
