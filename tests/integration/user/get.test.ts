import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { clearDatabase } from "../../orchestrator";
import { createUser } from "../../factory";
import { users } from "../../../src/shared/database/schema";
import { db } from "../../../src/shared/database/conn";

const BASE_URL = "http://localhost:4000";

describe("GET /users/:id", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should return 200 and the persisted user when it exists", async () => {
    const seededUser = createUser();

    await request(BASE_URL)
      .post("/users")
      .send(seededUser)
      .set("Content-Type", "application/json")
      .expect(201);

    const [createdUserFromDb] = await db
      .select()
      .from(users)
      .where(eq(users.email, seededUser.email))
      .limit(1);

    expect(createdUserFromDb).toBeDefined();
    const createdUserId = createdUserFromDb.id;

    const response = await request(BASE_URL)
      .get(`/users/${createdUserId}`)
      .expect("Content-Type", /json/)
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: createdUserId,
      name: seededUser.name,
      email: seededUser.email,
    });
  });

  it("Should return 404 and a meaningful message when user does not exist", async () => {
    const missingId = randomUUID();

    const response = await request(BASE_URL)
      .get(`/users/${missingId}`)
      .expect("Content-Type", /json/)
      .expect(404);

    expect(response.body.message).toBe("User not found.");
  });
});
