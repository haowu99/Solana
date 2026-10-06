import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import bs58 from "bs58";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function parseSecret(value) {
  if (!value) throw new Error("SOLANA_TREASURY_SECRET_KEY is required");
  if (value.trim().startsWith("[")) return Uint8Array.from(JSON.parse(value));
  return bs58.decode(value.trim());
}

export class SolanaRail {
  constructor({ rpcUrl, cluster, treasurySecretKey, tokenMint, tokenDecimals }) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.cluster = cluster;
    this.treasury = Keypair.fromSecretKey(parseSecret(treasurySecretKey));
    this.mint = new PublicKey(tokenMint);
    this.decimals = tokenDecimals;
  }

  explorerUrl(signature) {
    return `https://explorer.solana.com/tx/${signature}?cluster=${encodeURIComponent(this.cluster)}`;
  }

  async sendChunk({ batchId, settlementDate, items }) {
    const transaction = new Transaction();
    const treasuryAta = await getAssociatedTokenAddress(this.mint, this.treasury.publicKey);

    if (!(await this.connection.getAccountInfo(treasuryAta, "confirmed"))) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.treasury.publicKey,
          treasuryAta,
          this.treasury.publicKey,
          this.mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    for (const item of items) {
      const destination = new PublicKey(item.walletAddress);
      const destinationAta = await getAssociatedTokenAddress(this.mint, destination);

      if (!(await this.connection.getAccountInfo(destinationAta, "confirmed"))) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.treasury.publicKey,
            destinationAta,
            destination,
            this.mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      const rawAmount = BigInt(item.amountCents) * 10n ** BigInt(this.decimals - 2);
      transaction.add(
        createTransferCheckedInstruction(
          treasuryAta,
          this.mint,
          destinationAta,
          this.treasury.publicKey,
          rawAmount,
          this.decimals,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      transaction.add({
        keys: [{ pubkey: this.treasury.publicKey, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(`ASYN|${batchId}|${item.employeeId}|${settlementDate}`, "utf8")
      });
    }

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.treasury],
      { commitment: "confirmed" }
    );
    const tx = await this.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    return {
      signature,
      slot: tx?.slot ?? null,
      blockTime: tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      explorerUrl: this.explorerUrl(signature),
      treasuryWallet: this.treasury.publicKey.toBase58(),
      tokenMint: this.mint.toBase58()
    };
  }
}
