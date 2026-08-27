import { clearDatabase } from "../../orchestrator";

import request from "supertest";

beforeAll(async () => {
  await clearDatabase();
});

describe("GET /health", () => {
  it("Should return 200 and OK when server is running", async () => {
    const response = await request("http://localhost:4000")
      .get("/health")
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body.status).toBe("OK");
  });
});

describe("GET /ready", () => {
  it("Should return 200 and READY when the database answers", async () => {
    const response = await request("http://localhost:4000")
      .get("/ready")
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body.status).toBe("READY");
  });

  // The unreachable-database case cannot be produced from here without stopping
  // the container the rest of the suite depends on. It is covered against the
  // image instead, where the container runs with no database at all —
  // tests/image/runtime.test.ts.
  it("Should say nothing about the database in the body", async () => {
    const response = await request("http://localhost:4000").get("/ready");

    expect(Object.keys(response.body).sort()).toEqual(["status", "timestamp"]);
  });
});
