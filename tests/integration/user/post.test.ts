import request from "supertest";
import { eq } from "drizzle-orm";

import { createUser } from "../../factory";
import { clearDatabase } from "../../orchestrator";
import { db } from "../../../src/shared/database/conn";
import { users } from "../../../src/shared/database/schema";

const BASE_URL = "http://localhost:4000";

describe("POST /users", () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it("Should return 201 and a success message when the user is created", async () => {
    const user = createUser();
    const response = await request(BASE_URL)
      .post("/users")
      .send(user)
      .set("Content-Type", "application/json")
      .expect(201);

    expect(response.body.message).toBe("User created successfully");
    expect(response.body.success).toBe(true);
  });

  it("Should return 400 and a validation error when the email is not valid", async () => {
    const user = {
      name: "Carlos",
      email: "invalid-email",
    };
    const response = await request(BASE_URL)
      .post("/users")
      .send(user)
      .expect(400);

    expect(response.body.message).toBe("Email is not valid");
  });

  it("Should return 400 when the email is already taken", async () => {
    const user = createUser();

    await request(BASE_URL).post("/users").send(user).expect(201);

    const response = await request(BASE_URL)
      .post("/users")
      .send({ name: "Someone Else", email: user.email })
      .expect(400);

    expect(response.body.message).toBe("User already exists with this email");
  });

  it("Should return 400 when two signups race for the same email", async () => {
    const user = createUser();

    // exists() and the insert are not atomic, so both requests pass the check
    // and the unique constraint has to reject one of them.
    const responses = await Promise.all([
      request(BASE_URL).post("/users").send(user),
      request(BASE_URL)
        .post("/users")
        .send({ name: "Someone Else", email: user.email }),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 400]);
  });

  it("Should return 400 when the same email is reused in a different case", async () => {
    await request(BASE_URL)
      .post("/users")
      .send({ name: "Carlos Um", email: "caso@example.com" })
      .expect(201);

    const response = await request(BASE_URL)
      .post("/users")
      .send({ name: "Carlos Dois", email: "CASO@EXAMPLE.COM" })
      .expect(400);

    expect(response.body.message).toBe("User already exists with this email");
  });

  it("Should store the email lowercased", async () => {
    await request(BASE_URL)
      .post("/users")
      .send({ name: "Carlos Um", email: "  MiXeD@Example.COM " })
      .expect(201);

    const [stored] = await db
      .select()
      .from(users)
      .where(eq(users.email, "mixed@example.com"));

    expect(stored).toBeDefined();
  });

  it("Should return 400 when a field is missing", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .send({ email: "no-name@example.com" })
      .expect(400);

    expect(response.body.message).toBe("name is required and must be a string");
  });

  it("Should reject a name containing HTML", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .send({ name: "<b>Bold</b> Name", email: "bold@example.com" })
      .expect(400);

    expect(response.body.message).toBe("Name must not contain HTML");
  });

  it("Should keep text with angle brackets exactly as sent", async () => {
    await request(BASE_URL)
      .post("/users")
      .send({ name: "Ana <3 Bob", email: "ana@example.com" })
      .expect(201);

    const [stored] = await db
      .select()
      .from(users)
      .where(eq(users.email, "ana@example.com"));

    expect(stored.name).toBe("Ana <3 Bob");
  });

  it("Should return 413 when the body is too large", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .set("Content-Type", "application/json")
      .send({ name: "a".repeat(20000), email: "big@example.com" })
      .expect(413);

    expect(response.body.message).toBe("Request body is too large");
  });

  it("Should return 400 when the name is empty", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .send({ name: "", email: "carlos@example.com" })
      .expect(400);

    expect(response.body.message).toBe("name must not be empty");
  });

  it("Should return 400 and a validation error when the name is too short", async () => {
    const response = await request(BASE_URL)
      .post("/users")
      .send({ name: "ab", email: "carlos@example.com" })
      .expect(400);

    expect(response.body.message).toBe(
      "Name should be between 3 and 50 characters",
    );
  });
});
