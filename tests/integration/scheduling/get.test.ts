import request from "supertest";
import { eq } from "drizzle-orm";

import {
  createMeeting,
  createScheduling,
  createUser,
  storeMeeting,
  storeUser,
} from "../../factory";
import { clearDatabase } from "../../orchestrator";
import { db } from "../../../src/shared/database/conn";
import { scheduling } from "../../../src/shared/database/schema";

const BASE_URL = "http://localhost:4000";

describe("GET /schedulings/:id", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should return 200 when scheduling exists", async () => {
    const firstSeededUser = createUser();
    const firstUser = await storeUser(firstSeededUser);

    const secondSeededUser = {
      id: "1234",
      name: "Neymar Jr",
      email: "neymarjr@email.com",
    };
    const secondUser = await storeUser(secondSeededUser);

    const seededMeeting = createMeeting(firstUser.id);
    const meeting = await storeMeeting(seededMeeting);
    console.log("firstUser: ", firstUser);
    console.log("secondUser: ", secondUser);
    console.log("meeting: ", meeting);

    const seededScheduling = createScheduling(
      firstUser.id,
      secondUser.id,
      meeting.id,
    );

    await request(BASE_URL)
      .post("/schedulings")
      .send(seededScheduling)
      .set("Content-Type", "application/json")
      .expect(201);

    const [createdSchedulingFromDb] = await db
      .select()
      .from(scheduling)
      .where(eq(scheduling.name, seededScheduling.name))
      .limit(1);

    expect(createdSchedulingFromDb).toBeDefined();
    const createdSchedulingId = createdSchedulingFromDb.id;

    const response = await request(BASE_URL)
      .get(`/schedulings/${createdSchedulingId}`)
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: createdSchedulingId,
      schedulingDatetime: seededScheduling.schedulingDatetime,
      name: seededScheduling.name,
      purpose: seededScheduling.purpose,
      hostId: seededScheduling.hostId,
      guestId: seededScheduling.guestId,
      meetingId: seededScheduling.meetingId,
    });
  });
});
