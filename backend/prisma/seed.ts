import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

interface SenderSeed {
  displayName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

async function createEtherealSenders(count: number): Promise<SenderSeed[]> {
  const senders: SenderSeed[] = [];
  for (let i = 0; i < count; i++) {
    const account = await nodemailer.createTestAccount();
    senders.push({
      displayName: account.name ?? `Ethereal Sender ${i + 1}`,
      email: account.user,
      smtpHost: account.smtp.host,
      smtpPort: account.smtp.port,
      smtpUser: account.user,
      smtpPass: account.pass,
    });
  }
  return senders;
}

async function main() {
  const autoCreate = (process.env.ETHEREAL_AUTO_CREATE ?? "true") !== "false";

  const user = await prisma.user.upsert({
    where: { email: "dev@reachinbox.local" },
    update: {},
    create: {
      googleId: "dev-user-placeholder",
      email: "dev@reachinbox.local",
      name: "Dev User",
      avatarUrl: null,
    },
  });

  const existing = await prisma.sender.count({ where: { userId: user.id } });
  if (existing > 0) {
    console.log(`[seed] Dev user + ${existing} sender(s) already present.`);
    return;
  }

  let senders: SenderSeed[];
  if (autoCreate) {
    senders = await createEtherealSenders(3);
    console.log("[seed] Created 3 fresh Ethereal test accounts.");
  } else {
    senders = [
      {
        displayName: "Primary Sender",
        email: process.env.ETHEREAL_USER ?? "placeholder@ethereal.email",
        smtpHost: process.env.ETHEREAL_HOST ?? "smtp.ethereal.email",
        smtpPort: Number.parseInt(process.env.ETHEREAL_PORT ?? "587", 10),
        smtpUser: process.env.ETHEREAL_USER ?? "placeholder",
        smtpPass: process.env.ETHEREAL_PASS ?? "placeholder",
      },
    ];
    console.log("[seed] Using configured Ethereal credentials.");
  }

  await prisma.sender.createMany({
    data: senders.map((s) => ({ ...s, userId: user.id })),
  });

  console.log(`[seed] Seeded ${senders.length} sender(s) for dev user.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
