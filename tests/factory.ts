import { randomUUID } from "node:crypto";
import { users } from "../src/shared/database/schema";
import { db } from "../src/shared/database/conn";

export const createUser = () => {
  const now = new Date();
  return {
    id: randomUUID(),
    name: "Carlos André",
    email: "carlosandre2@email.com",
    created_at: now,
    updated_at: null,
  };
};

export const storeUser = async (user: any) => {
  const userResponse = await db.insert(users).values(user).returning();
  if (!userResponse[0]) throw new Error("Failed to create user");
  return userResponse[0];
};

export const createMeeting = (userIdInput?: string) => {
  const now = new Date();
  return {
    id: randomUUID(),
    name: "Sprint Planning",
    description: "Plan next sprint",
    start_datetime: "2025-11-04T10:00:00.000Z",
    end_datetime: "2025-11-04T10:30:00.000Z",
    meetingDurationInMinutes: 30,
    conferenceLink: "https://meet.example.com/room-123",
    userId: userIdInput ?? randomUUID(),
    created_at: now,
    updated_at: null,
  };
};

export const createScheduling = (
  hostIdInput?: string,
  guestIdInput?: string,
  meetingIdInput?: string,
) => {
  const now = new Date();
  return {
    id: randomUUID(),
    schedulingDatetime: "2025-11-04T10:15:00.000Z",
    name: "Intro Call",
    purpose: "Discuss project scope",
    hostId: hostIdInput ?? randomUUID(),
    guestId: guestIdInput ?? randomUUID(),
    meetingId: meetingIdInput ?? randomUUID(),
    created_at: now,
    updated_at: null,
  };
};
