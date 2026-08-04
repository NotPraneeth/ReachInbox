import { prisma } from "../src/db";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    where: { OR: [{ subject: "Stage 7 reconcile test" }, { subject: "Stage 6 rate-limit test" }] },
    select: { id: true },
  });
  for (const c of campaigns) {
    await prisma.emailMessage.deleteMany({ where: { campaignId: c.id } });
    await prisma.campaign.delete({ where: { id: c.id } });
  }
  console.log(`cleaned ${campaigns.length} test campaign(s)`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
