import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = await buildApp();
await app.listen({ host: env.host, port: env.port });
app.log.info(`API listening on ${env.host}:${env.port} (docs at /docs)`);
