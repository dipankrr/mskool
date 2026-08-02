import { router } from "./trpc";
import { examRouter } from "./routers/exam.router";
import { healthRouter } from "./routers/health.router";

export const appRouter = router({
  health: healthRouter,
  exam: examRouter,
});

export type AppRouter = typeof appRouter;
export { createContext } from "./context";
