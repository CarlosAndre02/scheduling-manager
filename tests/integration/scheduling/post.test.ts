import request from "supertest";

import {
  createMeeting,
  createScheduling,
  createUser,
  storeMeeting,
  storeUser,
} from "../../factory";
import { clearDatabase } from "../../orchestrator";

const BASE_URL = "http://localhost:4000";

describe("POST /schedulings", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  const seedHostGuestAndMeeting = async () => {
    const host = await storeUser(createUser({ email: "host@example.com" }));
    const guest = await storeUser(createUser({ email: "guest@example.com" }));
    const meeting = await storeMeeting(createMeeting(host.id));

    return { host, guest, meeting };
  };

  it("Should return 201 when the scheduling is created", async () => {
    const { host, guest, meeting } = await seedHostGuestAndMeeting();

    const response = await request(BASE_URL)
      .post("/schedulings")
      .send(createScheduling(host.id, guest.id, meeting.id))
      .set("Content-Type", "application/json")
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe("Scheduling created successfully");
  });

  it("Should return 400 when the slot is already booked by someone else", async () => {
    const { host, guest, meeting } = await seedHostGuestAndMeeting();
    const otherGuest = await storeUser(
      createUser({ email: "other-guest@example.com" }),
    );

    await request(BASE_URL)
      .post("/schedulings")
      .send(createScheduling(host.id, guest.id, meeting.id))
      .set("Content-Type", "application/json")
      .expect(201);

    const response = await request(BASE_URL)
      .post("/schedulings")
      .send(createScheduling(host.id, otherGuest.id, meeting.id))
      .set("Content-Type", "application/json")
      .expect(400);

    expect(response.body.message).toBe("This time slot is already booked");
  });

  it("Should return 400 when two guests race for the same slot", async () => {
    const { host, guest, meeting } = await seedHostGuestAndMeeting();
    const otherGuest = await storeUser(
      createUser({ email: "other-guest@example.com" }),
    );

    // Fired together on purpose: every check in the use case passes for both,
    // so only the unique index can settle it.
    const responses = await Promise.all([
      request(BASE_URL)
        .post("/schedulings")
        .send(createScheduling(host.id, guest.id, meeting.id))
        .set("Content-Type", "application/json"),
      request(BASE_URL)
        .post("/schedulings")
        .send(createScheduling(host.id, otherGuest.id, meeting.id))
        .set("Content-Type", "application/json"),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 400]);
  });

  it("Should return 400 when a required field is missing", async () => {
    const { host, guest, meeting } = await seedHostGuestAndMeeting();
    const scheduling = createScheduling(host.id, guest.id, meeting.id);
    const { hostId: _omitted, ...withoutHost } = scheduling;

    const response = await request(BASE_URL)
      .post("/schedulings")
      .send(withoutHost)
      .expect(400);

    expect(response.body.message).toBe(
      "hostId is required and must be a string",
    );
  });

  it("Should reject a purpose containing HTML", async () => {
    const { host, guest, meeting } = await seedHostGuestAndMeeting();

    const response = await request(BASE_URL)
      .post("/schedulings")
      .send({
        ...createScheduling(host.id, guest.id, meeting.id),
        purpose: "<script>alert(1)</script> talk",
      })
      .expect(400);

    expect(response.body.message).toBe("Purpose must not contain HTML");
  });
});
