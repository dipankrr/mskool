import { createServer } from "./server";
import { env } from "./env";
import { startHomeworkWorker, homeworkWorkerHealth } from "./homework-worker";

const app = createServer();

const worker = startHomeworkWorker();

app.listen(env.PORT, () => {
  console.log(`🚀 API ready at         http://localhost:${env.PORT}`);
  console.log(`📘 REST + Scalar docs   http://localhost:${env.PORT}/docs`);
  console.log(`📘 OpenAPI docs         http://localhost:${env.PORT}/openapi.json`);
  console.log(`🔐 Auth routes          http://localhost:${env.PORT}/api/auth/*`);
});

// Graceful shutdown: stop accepting new ticks and wait out an in-flight
// sweep (bounded; Postgres would roll back an interrupted one anyway).
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received — shutting down…`);
  if (worker) await worker.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { homeworkWorkerHealth };
