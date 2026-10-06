import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const MAX_CHUNK = 8;
const TERMINAL_ITEM = new Set(["PAID", "FAILED"]);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function bad(message, details = undefined) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_REQUEST";
  error.details = details;
  return error;
}

function validateRequest(body) {
  if (!body || typeof body !== "object") throw bad("Request body must be an object.");
  for (const field of ["batch_id", "company_id", "period", "settlement_date", "total_cents"]) {
    if (body[field] === undefined || body[field] === null) throw bad(`${field} is required.`);
  }
  if (!isoDate.test(body.period?.start) || !isoDate.test(body.period?.end)) throw bad("period.start and period.end must be ISO dates.");
  if (!isoDate.test(body.settlement_date)) throw bad("settlement_date must be an ISO date.");
  if (body.currency && body.currency !== "BRL") throw bad("currency must be BRL.");
  if (!Number.isInteger(body.total_cents) || body.total_cents <= 0) throw bad("total_cents must be a positive integer.");
  if (!Array.isArray(body.items) || body.items.length === 0) throw bad("items must be a non-empty array.");

  const ids = new Set();
  const invalidWallets = [];
  let sum = 0;

  for (const item of body.items) {
    for (const field of ["item_id", "employee_id", "wallet_address", "amount_cents"]) {
      if (item[field] === undefined || item[field] === null) throw bad(`items[].${field} is required.`);
    }
    if (ids.has(item.item_id)) throw bad("item_id must be unique within a batch.", { item_id: item.item_id });
    ids.add(item.item_id);
    if (!Number.isInteger(item.amount_cents) || item.amount_cents <= 0) {
      throw bad("amount_cents must be a positive integer.", { item_id: item.item_id });
    }
    try {
      new PublicKey(item.wallet_address);
    } catch {
      invalidWallets.push({ item_id: item.item_id, wallet_address: item.wallet_address });
    }
    sum += item.amount_cents;
  }

  if (invalidWallets.length) throw bad("Invalid Solana wallet address(es).", { items: invalidWallets });
  if (sum !== body.total_cents) {
    throw bad("total_cents must equal the sum of item amounts.", {
      expected: sum,
      received: body.total_cents
    });
  }
}

function batchStatus(items) {
  const counts = { paid: 0, failed: 0, processing: 0 };
  for (const item of items) {
    if (item.status === "PAID") counts.paid += 1;
    else if (item.status === "FAILED") counts.failed += 1;
    else counts.processing += 1;
  }
  if (counts.processing) return "PROCESSING";
  if (counts.paid && counts.failed) return "PARTIALLY_FAILED";
  if (counts.paid) return "COMPLETED";
  return "FAILED";
}

export function serializeItem(item) {
  return {
    batch_id: item.batchId,
    item_id: item.itemId,
    employee_id: item.employeeId,
    wallet_address: item.walletAddress,
    amount_cents: item.amountCents,
    status: item.status,
    tx_signature: item.txSignature || null,
    explorer_url: item.explorerUrl || null,
    slot: item.slot ?? null,
    block_time: item.blockTime || null,
    token_mint: item.tokenMint || null,
    token_amount: (item.amountCents / 100).toFixed(2),
    memo: item.memo,
    error: item.error || null,
    attempts: item.attempts,
    updated_at: item.updatedAt
  };
}

export function serializeBatch(batch) {
  const items = batch.items.map(serializeItem);
  const paidCents = batch.items.filter(i => i.status === "PAID").reduce((sum, i) => sum + i.amountCents, 0);
  const failedCents = batch.items.filter(i => i.status === "FAILED").reduce((sum, i) => sum + i.amountCents, 0);

  return {
    batch_id: batch.batchId,
    status: batchStatus(batch.items),
    counts: {
      paid: batch.items.filter(i => i.status === "PAID").length,
      failed: batch.items.filter(i => i.status === "FAILED").length,
      processing: batch.items.filter(i => !TERMINAL_ITEM.has(i.status)).length
    },
    paid_cents: paidCents,
    failed_cents: failedCents,
    treasury_wallet: batch.treasuryWallet || null,
    cluster: batch.cluster,
    started_at: batch.startedAt,
    finished_at: batchStatus(batch.items) === "PROCESSING" ? null : batch.finishedAt,
    items
  };
}

export class SettlementService {
  constructor({ ledger, rail, webhookSecret, cluster }) {
    this.ledger = ledger;
    this.rail = rail;
    this.webhookSecret = webhookSecret;
    this.cluster = cluster;
  }

  async create(body) {
    validateRequest(body);
    const existing = this.ledger.get(body.batch_id);
    if (existing) return { accepted: true, existing: true, response: this.acceptedResponse(existing) };

    const now = new Date().toISOString();
    const batch = {
      batchId: body.batch_id,
      companyId: body.company_id,
      period: body.period,
      settlementDate: body.settlement_date,
      currency: body.currency || "BRL",
      totalCents: body.total_cents,
      callbackUrl: body.callback_url || null,
      cluster: this.cluster,
      startedAt: now,
      finishedAt: null,
      treasuryWallet: null,
      items: body.items.map(item => ({
        batchId: body.batch_id,
        itemId: item.item_id,
        employeeId: item.employee_id,
        employeeName: item.employee_name || null,
        walletAddress: item.wallet_address,
        amountCents: item.amount_cents,
        status: "PENDING",
        attempts: 0,
        txSignature: null,
        explorerUrl: null,
        slot: null,
        blockTime: null,
        tokenMint: null,
        memo: `ASYN|${body.batch_id}|${item.employee_id}|${body.settlement_date}`,
        error: null,
        updatedAt: now
      }))
    };

    await this.ledger.set(batch);
    setImmediate(() => this.process(batch.batchId).catch(error => console.error("settlement processing failed", error)));
    return { accepted: true, existing: false, response: this.acceptedResponse(batch) };
  }

  acceptedResponse(batch) {
    return {
      batch_id: batch.batchId,
      status: "PROCESSING",
      items: batch.items.length,
      chunks: Math.ceil(batch.items.length / MAX_CHUNK),
      received_at: batch.startedAt
    };
  }

  async process(batchId, onlyItemIds = null) {
    const batch = this.ledger.get(batchId);
    if (!batch) return;

    const candidates = batch.items.filter(
      item => (!onlyItemIds || onlyItemIds.includes(item.itemId)) && !TERMINAL_ITEM.has(item.status)
    );

    for (let i = 0; i < candidates.length; i += MAX_CHUNK) {
      const chunk = candidates.slice(i, i + MAX_CHUNK);

      for (const item of chunk) {
        item.status = "PROCESSING";
        item.attempts += 1;
        item.updatedAt = new Date().toISOString();
      }
      await this.ledger.set(batch);

      try {
        const result = await this.rail.sendChunk({
          batchId,
          settlementDate: batch.settlementDate,
          items: chunk
        });

        batch.treasuryWallet = result.treasuryWallet;
        for (const item of chunk) {
          item.status = "PAID";
          item.txSignature = result.signature;
          item.explorerUrl = result.explorerUrl;
          item.slot = result.slot;
          item.blockTime = result.blockTime;
          item.tokenMint = result.tokenMint;
          item.error = null;
          item.updatedAt = new Date().toISOString();
          await this.emitItemUpdated(batch, item);
        }
      } catch (error) {
        const code = error?.code || (error?.message?.toLowerCase().includes("blockhash") ? "TX_EXPIRED" : "RPC_TIMEOUT");
        for (const item of chunk) {
          item.status = "FAILED";
          item.error = { code, message: error?.message || "Settlement transaction failed." };
          item.updatedAt = new Date().toISOString();
          await this.emitItemUpdated(batch, item);
        }
      }

      await this.ledger.set(batch);
    }

    if (batch.items.every(item => TERMINAL_ITEM.has(item.status))) {
      batch.finishedAt = new Date().toISOString();
      await this.ledger.set(batch);
      await this.emitBatchCompleted(batch);
    }
  }

  async retry(batchId, itemIds) {
    const batch = this.ledger.get(batchId);
    if (!batch) {
      const error = new Error("Settlement batch not found.");
      error.statusCode = 404;
      error.code = "NOT_FOUND";
      throw error;
    }
    if (!Array.isArray(itemIds) || itemIds.length === 0) throw bad("item_ids must be a non-empty array.");

    const selected = batch.items.filter(item => itemIds.includes(item.itemId));
    if (selected.length !== itemIds.length) throw bad("One or more item_ids do not belong to the batch.");
    if (selected.some(item => item.status !== "FAILED")) throw bad("Only FAILED items can be retried.");

    for (const item of selected) {
      item.status = "PENDING";
      item.error = null;
      item.updatedAt = new Date().toISOString();
    }
    batch.finishedAt = null;
    await this.ledger.set(batch);
    setImmediate(() => this.process(batchId, itemIds).catch(error => console.error("settlement retry failed", error)));
    return { batch_id: batchId, status: "PROCESSING", item_ids: itemIds };
  }

  async emitItemUpdated(batch, item) {
    if (!batch.callbackUrl) return;
    await this.webhook(batch.callbackUrl, "settlement.item.updated", serializeItem(item));
  }

  async emitBatchCompleted(batch) {
    if (!batch.callbackUrl) return;
    await this.webhook(batch.callbackUrl, "settlement.batch.completed", serializeBatch(batch));
  }

  async webhook(url, event, payload) {
    const body = JSON.stringify({ event, data: payload });
    const signature = crypto.createHmac("sha256", this.webhookSecret).update(body).digest("hex");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Settlement-Signature": `sha256=${signature}`
          },
          body
        });
        if (response.ok) return;
      } catch {}

      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}
