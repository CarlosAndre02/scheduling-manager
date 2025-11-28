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
