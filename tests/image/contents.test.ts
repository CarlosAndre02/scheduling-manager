import { readdirSync } from "node:fs";
import path from "node:path";

import { inspectImage } from "./docker";

const MIGRATIONS_IN_REPO = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "shared",
  "database",
  "migrations",
);

describe("Image contents", () => {
  it("Should run as the unprivileged node user", async () => {
    await expect(inspectImage(["id", "-un"])).resolves.toBe("node");
  });

  it("Should carry the build output without the sources that produced it", async () => {
    const entries = (await inspectImage(["ls", "-1", "/app"])).split("\n");

    expect(entries).toEqual(
      expect.arrayContaining(["dist", "node_modules", "package.json"]),
    );
    expect(entries).not.toContain("src");
    expect(entries).not.toContain("tests");
    expect(entries).not.toContain("tsconfig.json");
  });

  it("Should prune development dependencies and keep the runtime ones", async () => {
    const modules = (
      await inspectImage(["ls", "-1", "/app/node_modules"])
    ).split("\n");

    expect(modules).toEqual(
      expect.arrayContaining(["express", "drizzle-orm", "pg", "validator"]),
    );

    for (const devOnly of ["typescript", "jest", "eslint", "drizzle-kit"]) {
      expect(modules).not.toContain(devOnly);
    }
  });

  // tsc emits no .sql, so the migration files reach dist/ only through
  // scripts/copy-migrations.mjs. A break there surfaces at deploy time.
  it("Should ship every migration the runtime migrator looks for", async () => {
    const expected = readdirSync(MIGRATIONS_IN_REPO).filter((file) =>
      file.endsWith(".sql"),
    );
    const shipped = (
      await inspectImage(["ls", "-1", "/app/dist/shared/database/migrations"])
    ).split("\n");

    expect(expected.length).toBeGreaterThan(0);
    expect(shipped).toEqual(expect.arrayContaining(expected));
    expect(shipped).toContain("meta");
  });
});
