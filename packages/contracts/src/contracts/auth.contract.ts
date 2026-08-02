import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "@repo/db/schema";

const baseUserInsert  = createInsertSchema(user);
const baseUserSelect = createSelectSchema(user);

export const RegisterUserInput = baseUserInsert
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    name: z.string().trim().min(1, "Name is required").max(255),
    email: z.email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters long"),
    confirmPassword: z.string().min(8, "Confirm Password must be at least 8 characters long"),
  });

export type RegisterUserInputT = z.infer<typeof RegisterUserInput>;

export const UpdateUserInput = RegisterUserInput.partial();
export type UpdateUserInputT = z.infer<typeof UpdateUserInput>;

export const UserResponse = baseUserSelect;
export type UserResponseT = z.infer<typeof UserResponse>;


//login

export const LoginUserInput = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});
export type LoginUserInputT = z.infer<typeof LoginUserInput>;