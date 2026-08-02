import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { todos } from "@repo/db/schema";

const baseTodoInsert = createInsertSchema(todos);
const baseTodoSelect = createSelectSchema(todos);

export const CreateTodoInput = baseTodoInsert
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    title: z.string().trim().min(1, "Title is required").max(255),
    description: z.string().trim().optional(),
  });

export type CreateTodoInputT = z.infer<typeof CreateTodoInput>;

export const UpdateTodoInput = CreateTodoInput.partial();
export type UpdateTodoInputT = z.infer<typeof UpdateTodoInput>;

export const TodoResponse = baseTodoSelect;
export type TodoResponseT = z.infer<typeof TodoResponse>;