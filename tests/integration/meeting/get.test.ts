import request from "supertest";
import { eq } from "drizzle-orm";

import { createMeeting, createUser, storeUser } from "../../factory";
import { clearDatabase } from "../../orchestrator";
import { meetings } from "../../../src/shared/database/schema";
import { db } from "../../../src/shared/database/conn";

const BASE_URL = "http://localhost:4000";

describe("GET /meetings/:id", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should return 200 when meeting exists", async () => {
    const seededUser = createUser();
    const user = await storeUser(seededUser);

    const seededMeeting = createMeeting(user.id);

    await request(BASE_URL)
      .post("/meetings")
      .send(seededMeeting)
      .set("Content-Type", "application/json")
      .expect(201);

    const [createdMeetingFromDb] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.name, seededMeeting.name))
      .limit(1);

    expect(createdMeetingFromDb).toBeDefined();
    const createdMeetingId = createdMeetingFromDb.id;

    const response = await request(BASE_URL)
      .get(`/meetings/${createdMeetingId}`)
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: createdMeetingId,
      name: seededMeeting.name,
      description: seededMeeting.description,
      start_datetime: new Date(seededMeeting.start_datetime).toISOString(),
      end_datetime: new Date(seededMeeting.end_datetime).toISOString(),
      meetingDurationInMinutes: seededMeeting.meetingDurationInMinutes,
      conferenceLink: seededMeeting.conferenceLink,
      isActive: true,
      userId: seededMeeting.userId,
    });
  });

  it("Should return 404 and a meaningful message when meeting does not exist", async () => {
    const response = await request(BASE_URL)
      .get(`/meetings/123`)
      .expect("Content-Type", /json/)
      .expect(404);

    expect(response.body.message).toBe("Meeting not found");
  });
});
