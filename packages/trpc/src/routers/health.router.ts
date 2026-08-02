import {publicProcedure, router} from "../trpc"
import { z } from "zod";

export const healthRouter = router({

  health: publicProcedure
    .meta({ openapi: { method: "GET", path: "/health", tags: ["health"], protect: false } })
    .input(z.undefined())
    .output(z.string())
    .query(async ({ ctx, input }) => {
        return "Healthy"
    }),
})