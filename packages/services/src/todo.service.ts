import { eq, desc } from "drizzle-orm";
import { Database, db } from "@repo/db";
import { todos } from "@repo/db/schema";
import { CreateTodoInputT, TodoResponseT } from "@repo/contracts";
// import { TRPCError } from '@trpc/server';

export class TodoService {

  async getAllTodos(userId: string) {
    return db
      .select()
      .from(todos)
      .where(eq(todos.userId, userId))
      .orderBy(desc(todos.createdAt));
  }

  async createTodo(userId: string, input: CreateTodoInputT) {
    const [todo] = await db
      .insert(todos)
      .values({
        ...input,
        userId,
      })
      .returning();

    // if (!todo) throw error

    return todo
  }
}

export const todoService = new TodoService();