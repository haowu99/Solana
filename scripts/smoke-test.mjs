const baseUrl = process.env.SETTLEMENT_BASE_URL || "http://localhost:3010";
const apiKey = process.env.SETTLEMENT_API_KEY || "devnet-test-key";
const batchId = `smoke_${Date.now()}`;

const body = {
  batch_id: batchId,
  company_id: "1",
  period: { start: "2026-10-01", end: "2026-10-25" },
  settlement_date: "2026-10-25",
  currency: "BRL",
  total_cents: 39000,
  items: [{
    item_id: `${batchId}#emp_3`,
    employee_id: "3",
    employee_name: "Solana Test Employee 1",
    wallet_address: "5XKBYCSuUZsGDwwkckFAWjxLMuXQ7bHpabRULEUhPUiN",
    amount_cents: 39000
  }]
};

const create = await fetch(`${baseUrl}/v1/settlements`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "idempotency-key": batchId
  },
  body: JSON.stringify(body)
});

console.log("POST", create.status, await create.text());

const poll = await fetch(`${baseUrl}/v1/settlements/${batchId}`, {
  headers: { authorization: `Bearer ${apiKey}` }
});

console.log("GET", poll.status, await poll.text());
