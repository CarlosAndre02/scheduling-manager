import request from "supertest";

import { clearDatabase } from "../../orchestrator";

const BASE_URL = "http://localhost:4000";

// An origin no configuration would ever list, so these hold whatever
// CORS_ORIGINS is set to in the environment running the suite.
const HOSTILE_ORIGIN = "https://not-an-allowed-origin.example";

describe("Security headers", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should not advertise the framework behind the API", async () => {
    const response = await request(BASE_URL).get("/health").expect(200);

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("Should tell browsers not to sniff the content type", async () => {
    const response = await request(BASE_URL).get("/health").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBeDefined();
  });

  // The headers have to survive middleware that answers before any route runs,
  // which is why helmet is mounted ahead of the body parsers.
  it("Should send the headers on a response the body parser rejects", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .set("Content-Type", "application/json")
      .send('{"name":')
      .expect(400);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  // Reflecting the requesting origin is the failure mode that matters: it reads
  // as working CORS and grants every site the access the list was meant to
  // restrict.
  it("Should never reflect an origin it was not configured with", async () => {
    const response = await request(BASE_URL)
      .get("/health")
      .set("Origin", HOSTILE_ORIGIN)
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).not.toBe(
      HOSTILE_ORIGIN,
    );
    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("Should not approve a preflight from an origin it was not configured with", async () => {
    const response = await request(BASE_URL)
      .options("/users")
      .set("Origin", HOSTILE_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(response.headers["access-control-allow-origin"]).not.toBe(
      HOSTILE_ORIGIN,
    );
    expect(response.headers["access-control-allow-origin"]).not.toBe("*");
  });
});
