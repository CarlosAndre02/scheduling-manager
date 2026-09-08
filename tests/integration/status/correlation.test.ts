import request from "supertest";

const BASE_URL = "http://localhost:4000";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Request correlation", () => {
  it("Should return a request id on every response", async () => {
    const response = await request(BASE_URL).get("/health").expect(200);

    expect(response.headers["x-request-id"]).toMatch(UUID);
  });

  it("Should give each request its own id", async () => {
    const [first, second] = await Promise.all([
      request(BASE_URL).get("/health"),
      request(BASE_URL).get("/health"),
    ]);

    expect(first.headers["x-request-id"]).not.toBe(
      second.headers["x-request-id"],
    );
  });

  // The id is generated, never read from the request. Injection is not the
  // reason: Node refuses to send a header containing a newline, so a compliant
  // client cannot smuggle one. The reason is collision — a caller that chooses
  // its own id can file its traffic under someone else's, which is worse than
  // useless in the log query an incident is investigated with.
  it("Should ignore a request id supplied by the caller", async () => {
    const chosenByCaller = "11111111-1111-1111-1111-111111111111";

    const response = await request(BASE_URL)
      .get("/health")
      .set("X-Request-Id", chosenByCaller)
      .expect(200);

    expect(response.headers["x-request-id"]).not.toBe(chosenByCaller);
    expect(response.headers["x-request-id"]).toMatch(UUID);
  });

  // A 500 carries an errorId in the body and a requestId in the header, and the
  // log record for that failure carries both — which is what turns a user's
  // complaint into a lookup instead of a search by timestamp.
  it("Should carry a request id on a response the body parser rejects", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .set("Content-Type", "application/json")
      .send('{"name":')
      .expect(400);

    expect(response.headers["x-request-id"]).toMatch(UUID);
  });
});
