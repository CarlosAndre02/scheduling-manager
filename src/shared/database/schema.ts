import { sql } from "drizzle-orm";
import * as p from "drizzle-orm/pg-core";

// Helpers
const timestamps = {
  updated_at: p.timestamp({ withTimezone: true }),
  created_at: p.timestamp({ withTimezone: true }).defaultNow().notNull(),
};

export const users = p.pgTable(
  "user",
  {
    id: p.text("id").primaryKey(),
    name: p.text("name").notNull(),
    email: p.text("email").notNull().unique(),
    ...timestamps,
  },
  (table) => [p.index("user_email_idx").on(table.email)],
);

export const meetings = p.pgTable(
  "meeting",
  {
    id: p.text("id").primaryKey(),
    name: p.text("name").notNull(),
    description: p.text("description").notNull(),
    start_datetime: p
      .timestamp("start_datetime", { withTimezone: true })
      .notNull(),
    end_datetime: p.timestamp("end_datetime", { withTimezone: true }).notNull(),
    meetingDurationInMinutes: p.integer("meetingDurationInMinutes").notNull(),
    conferenceLink: p.text("conferenceLink").notNull(),
    isActive: p.boolean("isActive").notNull(),
    userId: p
      .text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    p.index("meeting_user_id_idx").on(table.userId),
    p.index("meeting_start_datetime_idx").on(table.start_datetime),
  ],
);

export const scheduling = p.pgTable(
  "scheduling",
  {
    id: p.text("id").primaryKey(),
    schedulingDatetime: p
      .timestamp("schedulingDatetime", { withTimezone: true })
      .notNull(),
    name: p.text("name").notNull(),
    purpose: p.text("purpose").notNull(),
    isActive: p.boolean("isActive").notNull(),
    hostId: p
      .text("hostId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guestId: p
      .text("guestId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    meetingId: p
      .text("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    p.index("scheduling_host_id_idx").on(table.hostId),
    p.index("scheduling_guest_id_idx").on(table.guestId),
    p.index("scheduling_meeting_id_idx").on(table.meetingId),
    p
      .uniqueIndex("scheduling_active_slot_idx")
      .on(table.meetingId, table.schedulingDatetime)
      .where(sql`"isActive"`),
  ],
);
