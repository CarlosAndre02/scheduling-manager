import request from "supertest";

import { createMeeting, createUser, storeUser } from "../../factory";
import { clearDatabase } from "../../orchestrator";

const BASE_URL = "http://localhost:4000";

describe("POST /meetings", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should return 201 and a success message when the meeting is created", async () => {
    const seededUser = createUser();
    const user = await storeUser(seededUser);

    const meeting = createMeeting(user.id);
    const response = await request(BASE_URL)
      .post("/meetings")
      .send(meeting)
      .set("Content-Type", "application/json")
      .expect(201);

    expect(response.body.message).toBe("Meeting created successfully");
    expect(response.body.success).toBe(true);
  });

  it("Should return 400 when a required field is missing", async () => {
    const user = await storeUser(createUser());
    const meeting = createMeeting(user.id);
    const { start_datetime: _omitted, ...withoutStart } = meeting;

    const response = await request(BASE_URL)
      .post("/meetings")
      .send(withoutStart)
      .expect(400);

    expect(response.body.message).toBe(
      "start_datetime is required and must be a string",
    );
  });

  it("Should return 400 when userId is not a uuid", async () => {
    const meeting = createMeeting("not-a-uuid");

    const response = await request(BASE_URL)
      .post("/meetings")
      .send(meeting)
      .expect(400);

    expect(response.body.message).toBe("userId must be a valid uuid");
  });

  it("Should reject a conference link without a protocol", async () => {
    const user = await storeUser(createUser());
    const meeting = createMeeting(user.id);

    const response = await request(BASE_URL)
      .post("/meetings")
      .send({ ...meeting, conferenceLink: "meet.example.com/sala" })
      .expect(400);

    expect(response.body.message).toBe("conferenceLink must be a valid URL");
  });

  it("Should reject a conference link pointing at internal infrastructure", async () => {
    const user = await storeUser(createUser());
    const meeting = createMeeting(user.id);

    const response = await request(BASE_URL)
      .post("/meetings")
      .send({
        ...meeting,
        conferenceLink: "http://169.254.169.254/latest/meta-data/",
      })
      .expect(400);

    expect(response.body.message).toBe("conferenceLink must be a valid URL");
  });
});
