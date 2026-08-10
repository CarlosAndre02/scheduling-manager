import request from "supertest";

import { clearDatabase } from "../../orchestrator";

const BASE_URL = "http://localhost:4000";

// Every failure answers the same envelope, whatever produced it: a route that
// does not exist, a body the parser refuses, and a validation error all come
// back as { message }. Clients branch on the status, never on the shape.
describe("Error contract", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should return 404 and the same envelope for an unmatched route", async () => {
    const response = await request(BASE_URL)
      .get("/does-not-exist")
      .expect("Content-Type", /json/)
      .expect(404);

    expect(response.body.message).toBe("Route not found");
    expect(Object.keys(response.body)).toEqual(["message"]);
  });

  // body-parser rejects the request before any controller runs, tagging the
  // error with its own status. Without the handler reading that status, a
  // client's malformed JSON would be reported as an internal failure.
  it("Should return 400 when the JSON body is malformed", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .set("Content-Type", "application/json")
      .send('{"name":"Carlos",')
      .expect("Content-Type", /json/)
      .expect(400);

    expect(response.body.message).toBe("Malformed JSON body");
    expect(Object.keys(response.body)).toEqual(["message"]);
  });

  // A malformed id is a malformed request, not a missing resource: answering
  // 404 would imply the id could have existed, and would cost a pointless
  // query to find out it does not.
  it("Should return 400, not 404, when an id is not a uuid", async () => {
    const response = await request(BASE_URL)
      .get("/users/not-a-uuid")
      .expect("Content-Type", /json/)
      .expect(400);

    expect(response.body.message).toBe("id must be a valid uuid");
  });
});
