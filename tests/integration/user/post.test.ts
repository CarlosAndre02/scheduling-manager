import request from "supertest";
import { createUser } from "../../factory";
import { clearDatabase } from "../../orchestrator";

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

  it("Should return 400 and a validation error when the name is not valid", async () => {
    const user = {
      name: "",
      email: "carlos@example.com",
    };
    const response = await request(BASE_URL)
      .post("/users")
      .send(user)
      .expect(400);

    expect(response.body.message).toBe(
      "Name should be between 3 and 50 characters",
    );
  });
});
