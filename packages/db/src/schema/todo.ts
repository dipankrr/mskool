import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),

  userId: text("user_id")
    .references(() => user.id, { onDelete: "cascade" })
    .notNull(),

  title: text("title").notNull(),

  description: text("description"),

  completed: boolean("completed")
    .notNull()
    .default(false),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),

  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
