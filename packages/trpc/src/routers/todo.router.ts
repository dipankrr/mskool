import { z } from "zod";
import { publicProcedure, router, protectedProcedure } from "../trpc"
import { CreateTodoInput, CreateTodoInputT, TodoResponse, TodoResponseT, } from "@repo/contracts";
import { todoService } from "@repo/services";
import { TRPCError } from "@trpc/server";


const TAG = ["todos"]

export const todoRouter = router({

    getAllTodosByUserId: publicProcedure
        .meta({ openapi: { method: "GET", path: "/todos", tags: TAG, protect: false } })
        .input(z.undefined())
        .output(z.string())
        .query(async ({ ctx, input }) => {
            return "Healthy"
        }),

    createTodo: protectedProcedure
        .meta({ openapi: { method: "POST", path: "/todo/create", tags: TAG, protect: true } })
        .input(CreateTodoInput)
        .output(TodoResponse)
        .mutation(async ({ ctx, input }) => {
            const todo = await todoService.createTodo(ctx.session.user.id, input)
            if (!todo) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create todo" })
            return todo
        })

    // getTodoById : protected /todo/:id
    // createTodo : protected /todo/create
    // updateTodo : protected /todo/update/:id
    // deleteTodo : protected /todo/delete/:id
    // 
})