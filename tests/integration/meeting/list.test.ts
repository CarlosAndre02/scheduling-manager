import request from "supertest";

import {
  createMeeting,
  createUser,
  storeMeeting,
  storeUser,
} from "../../factory";
import { clearDatabase } from "../../orchestrator";

const BASE_URL = "http://localhost:4000";

describe("GET /meetings/user/:userId", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  const seedMeetings = async (count: number) => {
    const user = await storeUser(createUser());

    for (let index = 0; index < count; index += 1) {
      const meeting = createMeeting(user.id);
      const start = new Date("2026-08-10T10:00:00.000Z");
      start.setUTCHours(start.getUTCHours() + index);
      const end = new Date(start.getTime() + 30 * 60 * 1000);

      await storeMeeting({
        ...meeting,
        name: `Meeting ${index}`,
        start_datetime: start,
        end_datetime: end,
      });
    }

    return user;
  };

  it("Should cap the page size at the default limit", async () => {
    const user = await seedMeetings(3);

    const response = await request(BASE_URL)
      .get(`/meetings/user/${user.id}`)
      .expect(200);

    expect(response.body.data).toHaveLength(3);
    expect(response.body.pagination).toEqual({
      limit: 20,
      offset: 0,
      count: 3,
    });
  });

  it("Should honour limit and offset", async () => {
    const user = await seedMeetings(3);

    const firstPage = await request(BASE_URL)
      .get(`/meetings/user/${user.id}?limit=2`)
      .expect(200);

    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data[0].name).toBe("Meeting 0");
    expect(firstPage.body.pagination).toEqual({
      limit: 2,
      offset: 0,
      count: 2,
    });

    const secondPage = await request(BASE_URL)
      .get(`/meetings/user/${user.id}?limit=2&offset=2`)
      .expect(200);

    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].name).toBe("Meeting 2");
    expect(secondPage.body.pagination.offset).toBe(2);
  });

  it("Should return 400 when limit exceeds the maximum", async () => {
    const user = await seedMeetings(1);

    const response = await request(BASE_URL)
      .get(`/meetings/user/${user.id}?limit=101`)
      .expect(400);

    expect(response.body.message).toBe("limit must not exceed 100");
  });

  it("Should return 400 when limit is not a number", async () => {
    const user = await seedMeetings(1);

    const response = await request(BASE_URL)
      .get(`/meetings/user/${user.id}?limit=abc`)
      .expect(400);

    expect(response.body.message).toBe("limit must be a non-negative integer");
  });
});
