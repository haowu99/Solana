import "dotenv/config";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import bs58 from "bs58";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(rpc, "confirmed");

const treasury = process.env.SOLANA_TREASURY_SECRET_KEY
  ? Keypair.fromSecretKey(
      process.env.SOLANA_TREASURY_SECRET_KEY.trim().startsWith("[")
        ? Uint8Array.from(JSON.parse(process.env.SOLANA_TREASURY_SECRET_KEY))
        : bs58.decode(process.env.SOLANA_TREASURY_SECRET_KEY)
    )
  : Keypair.generate();

if (!process.env.SOLANA_TREASURY_SECRET_KEY) {
  console.log("Generated treasury public key:", treasury.publicKey.toBase58());
  console.log("Generated treasury secret key (store securely):", bs58.encode(treasury.secretKey));
}

const mint = await createMint(connection, treasury, treasury.publicKey, null, 6);
const treasuryAta = await getOrCreateAssociatedTokenAccount(
  connection,
  treasury,
  mint,
  treasury.publicKey
);

await mintTo(
  connection,
  treasury,
  mint,
  treasuryAta.address,
  treasury,
  1_000_000_000_000
);

console.log("SOLANA_RPC_URL=" + rpc);
console.log("SOLANA_CLUSTER=devnet");
console.log("SOLANA_TREASURY_SECRET_KEY=" + bs58.encode(treasury.secretKey));
console.log("SOLANA_TOKEN_MINT=" + mint.toBase58());
console.log("Treasury token account=" + treasuryAta.address.toBase58());
console.log("Minted 1,000,000 mock BRL to treasury.");
