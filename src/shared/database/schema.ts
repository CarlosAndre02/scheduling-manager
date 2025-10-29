import * as p from "drizzle-orm/pg-core";

// Helpers
const timestamps = {
  updated_at: p.timestamp(),
  created_at: p.timestamp().defaultNow().notNull(),
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
