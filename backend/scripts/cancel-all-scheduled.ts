import { prisma } from "../src/db";
import { emailQueue } from "../src/services/queue";

async function main() {
  const res = await prisma.emailMessage.updateMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "CANCELLED" },
  });
  console.log(`[cancel] marked ${res.count} scheduled message(s) CANCELLED`);

  await emailQueue.obliterate({ force: true });
  console.log("[cancel] email-queue obliterated (delayed + waiting + active)");

  await emailQueue.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[cancel] failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
