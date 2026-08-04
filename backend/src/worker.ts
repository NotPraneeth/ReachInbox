import { createWorker } from "./services/queue";
import { processMessage } from "./services/processor";
import { reconcilePendingMessages } from "./services/reconcile";
import { prisma } from "./db";

async function boot() {
  console.log("[worker] starting...");
  await reconcilePendingMessages();
  console.log("[worker] reconciliation complete, starting queue worker...");
  const worker = createWorker(processMessage);
  console.log("[worker] started (Stage 6 rate-limited processor)");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      console.log(`[worker] ${signal} received, shutting down...`);
      await worker.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

boot().catch(async (err) => {
  console.error("[worker] fatal boot error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
