import { router } from "./trpc";
import { healthRouter } from "./routers/health.router";
import { schoolRouter } from "./routers/school.router";

// Domain routers land here as each phase ships — see docs/TASKS.md.
// Staff routers are namespaced <domain>.*; student portal routers portal.*.
export const appRouter = router({
  health: healthRouter,
  school: schoolRouter,
});



export type AppRouter = typeof appRouter;
export { createContext } from "./context";
