import { faker } from "@faker-js/faker";
import { randomUUID } from "node:crypto";

export const createUser = () => {
  const now = new Date();
  return {
    id: randomUUID(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    created_at: now,
    updated_at: null,
  };
};

export const createMeeting = (userIdInput?: string) => {
  const now = new Date();
  return {
    id: randomUUID(),
    name: faker.lorem.sentence(),
    description: faker.lorem.paragraph(),
    start_datetime: faker.date.soon().toISOString(),
    end_datetime: faker.date.soon({ days: 1 }).toISOString(),
    meetingDurationInMinutes: 60,
    conferenceLink: faker.internet.url(),
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
    schedulingDatetime: faker.date.soon().toISOString(),
    name: faker.lorem.sentence(),
    purpose: faker.lorem.paragraph(),
    hostId: hostIdInput ?? randomUUID(),
    guestId: guestIdInput ?? randomUUID(),
    meetingId: meetingIdInput ?? randomUUID(),
    created_at: now,
    updated_at: null,
  };
};
