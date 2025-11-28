import { sql } from "drizzle-orm";
import { db } from "../src/shared/database/conn";

export async function clearDatabase() {
  await db.execute(
    sql.raw("drop schema public cascade; create schema public;"),
  );
}
