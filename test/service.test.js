import { describe, expect, it, beforeEach } from "vitest";
import { SettlementService } from "../src/service.js";

function makeLedger() {
  const data = new Map();
  return {
    get: id => data.get(id) || null,
    set: async batch => data.set(batch.batchId, structuredClone(batch))
  };
}

const valid = {
  batch_id: "stl_test_001",
  company_id: "1",
  period: { start: "2026-10-01", end: "2026-10-25" },
  settlement_date: "2026-10-25",
  currency: "BRL",
  total_cents: 39000,
  items: [
    {
      item_id: "stl_test_001#emp_3",
      employee_id: "3",
      employee_name: "Test",
      wallet_address: "11111111111111111111111111111111",
      amount_cents: 39000
    }
  ]
};

describe("settlement service contract", () => {
  let ledger;

  beforeEach(() => {
    ledger = makeLedger();
  });

  it("rejects a mismatched total before processing", async () => {
    const service = new SettlementService({
      ledger,
      rail: null,
      webhookSecret: "x",
      cluster: "devnet"
    });

    await expect(
      service.create({ ...valid, total_cents: 39001 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("is idempotent by batch_id", async () => {
    const service = new SettlementService({
      ledger,
      rail: { sendChunk: async () => { throw new Error("should not run in test"); } },
      webhookSecret: "x",
      cluster: "devnet"
    });

    const first = await service.create(valid);
    const second = await service.create(valid);

    expect(first.response.batch_id).toBe(valid.batch_id);
    expect(second.existing).toBe(true);
  });

  it("preserves failed items for per-item retry", async () => {
    const rail = {
      sendChunk: async () => {
        throw Object.assign(new Error("expired"), { code: "TX_EXPIRED" });
      }
    };

    const service = new SettlementService({
      ledger,
      rail,
      webhookSecret: "x",
      cluster: "devnet"
    });

    await service.create(valid);
    await new Promise(resolve => setTimeout(resolve, 10));

    const batch = ledger.get(valid.batch_id);
    expect(batch.items[0].status).toBe("FAILED");
    expect(batch.items[0].error.code).toBe("TX_EXPIRED");
  });
});
