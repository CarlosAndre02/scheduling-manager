import { Client } from "pg";
import "dotenv/config";

export async function clearDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL!,
  });

  try {
    await client.connect();

    await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
        LOOP
          EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" RESTART IDENTITY CASCADE';
        END LOOP;
      END $$;
    `);
  } finally {
    await client.end();
  }
}
