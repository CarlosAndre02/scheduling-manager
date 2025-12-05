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
});
