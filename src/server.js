import Fastify from "fastify";
import { config } from "./config.js";
import { Ledger } from "./ledger.js";
import { SolanaRail } from "./solana.js";
import { SettlementService, serializeBatch } from "./service.js";

const app = Fastify({ logger: true });
const ledger = new Ledger(config.ledgerPath);
await ledger.init();

let service = null;
try {
  if (config.treasurySecretKey && config.tokenMint) {
    service = new SettlementService({
      ledger,
      rail: new SolanaRail(config),
      webhookSecret: config.webhookSecret,
      cluster: config.cluster
    });
  }
} catch (error) {
  app.log.error(error, "Solana settlement rail failed to initialize");
}

function authenticate(request, reply) {
  const authorization = request.headers.authorization || "";
  if (authorization !== `Bearer ${config.apiKey}`) {
    reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid API key." } });
    return false;
  }
  return true;
}

app.get("/health", async () => ({
  ok: true,
  service: "asyn-solana-settlement",
  cluster: config.cluster,
  configured: Boolean(service)
}));

app.post("/v1/settlements", async (request, reply) => {
  if (!authenticate(request, reply)) return;

  const idempotencyKey = request.headers["idempotency-key"];
  if (!idempotencyKey || idempotencyKey !== request.body?.batch_id) {
    return reply.code(400).send({
      error: {
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Idempotency-Key must equal batch_id."
      }
    });
  }

  if (!service) {
    return reply.code(503).send({
      error: {
        code: "SERVICE_NOT_CONFIGURED",
        message: "Solana settlement rail is not configured."
      }
    });
  }

  try {
    const result = await service.create(request.body);
    return reply.code(202).send(result.response);
  } catch (error) {
    return reply.code(error.statusCode || 500).send({
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message,
        details: error.details
      }
    });
  }
});

app.get("/v1/settlements/:batchId", async (request, reply) => {
  if (!authenticate(request, reply)) return;

  const batch = ledger.get(request.params.batchId);
  if (!batch) {
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: "Settlement batch not found." }
    });
  }

  return reply.send(serializeBatch(batch));
});

app.post("/v1/settlements/:batchId/retry", async (request, reply) => {
  if (!authenticate(request, reply)) return;
  if (!service) {
    return reply.code(503).send({
      error: {
        code: "SERVICE_NOT_CONFIGURED",
        message: "Solana settlement rail is not configured."
      }
    });
  }

  try {
    return reply.code(202).send(
      await service.retry(request.params.batchId, request.body?.item_ids)
    );
  } catch (error) {
    return reply.code(error.statusCode || 500).send({
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message,
        details: error.details
      }
    });
  }
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch(error => {
  app.log.error(error);
  process.exit(1);
});
