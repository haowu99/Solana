import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3010),
  apiKey: process.env.SETTLEMENT_API_KEY || "devnet-test-key",
  webhookSecret: process.env.SETTLEMENT_WEBHOOK_SECRET || "change-me",
  rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  cluster: process.env.SOLANA_CLUSTER || "devnet",
  treasurySecretKey: process.env.SOLANA_TREASURY_SECRET_KEY || "",
  tokenMint: process.env.SOLANA_TOKEN_MINT || "",
  tokenDecimals: Number(process.env.SOLANA_TOKEN_DECIMALS || 6),
  ledgerPath: process.env.LEDGER_PATH || ".data/ledger.json"
};
