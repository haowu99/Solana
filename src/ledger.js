import fs from "node:fs/promises";
import path from "node:path";

export class Ledger {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { batches: {} };
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    if (this.loaded) return;
    try {
      this.data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await this.flush();
    }
    this.loaded = true;
  }

  async flush() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.filePath);
  }

  async save() {
    this.writeQueue = this.writeQueue.then(() => this.flush());
    return this.writeQueue;
  }

  get(batchId) {
    return this.data.batches[batchId] || null;
  }

  async set(batch) {
    this.data.batches[batch.batchId] = batch;
    await this.save();
  }
}
