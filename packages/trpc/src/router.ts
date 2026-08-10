import { router } from "./trpc";
import { healthRouter } from "./routers/health.router";
import { meRouter } from "./routers/me.router";
import { schoolRouter } from "./routers/school.router";

// Domain routers land here as each phase ships — see docs/TASKS.md.
// Staff routers are namespaced <domain>.*; student portal routers portal.*.
export const appRouter = router({
  health: healthRouter,
  // Not namespaced by domain: `me` is about the caller, not a domain, and it is
  // the call that supplies the organizationId every other staff route requires.
  me: meRouter,
  school: schoolRouter,
});




export type AppRouter = typeof appRouter;
export { createContext } from "./context";
