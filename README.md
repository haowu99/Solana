# ASYN Solana Settlement Service

Contract-compatible settlement rail for the ASYN hackathon. It implements the settlement-service side so ASYN does not depend on the external provider during development.

## Contract

- POST /v1/settlements
- GET /v1/settlements/:batch_id
- POST /v1/settlements/:batch_id/retry with {"item_ids":[...]}
- Bearer API key
- Idempotency-Key must equal batch_id
- Integer BRL cents
- Whole-batch validation before any Solana transaction
- Item lifecycle: PENDING -> PROCESSING -> PAID|FAILED
- Batch lifecycle: PROCESSING -> COMPLETED|PARTIALLY_FAILED|FAILED
- Devnet mock-BRL SPL token, 6 decimals
- ATA creation inside the payment transaction when needed
- Up to 8 employee transfers per transaction
- Memo per transfer: ASYN|batch|employee|date
- Per-item retry
- Optional HMAC-signed callbacks

## Local setup

npm install
cp .env.example .env
npm run bootstrap:devnet
# copy the printed treasury/mint values into .env
npm run dev

Default URL: http://localhost:3010

The bootstrap script creates a devnet treasury keypair if none is supplied, airdrops SOL, creates a 6-decimal mock-BRL mint, creates the treasury ATA, and mints 1,000,000 mock BRL.

## Security note

The default ledger is a single-instance JSON ledger for the hackathon/demo. Do not run multiple replicas against the same ledger file. For production, move idempotency/payment state to a transactional database and keep the treasury secret in a proper secret manager.
