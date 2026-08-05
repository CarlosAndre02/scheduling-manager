// tsc only emits JavaScript, so the .sql files and meta/_journal.json that the
// drizzle migrator reads at runtime never reach dist/ on their own.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "shared", "database", "migrations");
const destination = path.join(root, "dist", "shared", "database", "migrations");

if (!existsSync(source)) {
  console.error(`Migrations folder not found: ${source}`);
  process.exit(1);
}

cpSync(source, destination, { recursive: true });
console.log(`Copied migrations to ${destination}`);
