import { router } from "./trpc";
import { healthRouter } from "./routers/health.router";

// Domain routers land here as each phase ships — see docs/TASKS.md.
export const appRouter = router({
  health: healthRouter,
});


export type AppRouter = typeof appRouter;
export { createContext } from "./context";
