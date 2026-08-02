import { createServer } from "./server";
import { env } from "./env";

const app = createServer();

app.listen(env.PORT, () => {
  console.log(`🚀 API ready at         http://localhost:${env.PORT}`);
  console.log(`📘 REST + Scalar docs   http://localhost:${env.PORT}/docs`);
  console.log(`📘 OpenAPI docs         http://localhost:${env.PORT}/openapi.json`);
  console.log(`🔐 Auth routes          http://localhost:${env.PORT}/api/auth/*`);
});
