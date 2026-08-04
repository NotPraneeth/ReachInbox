import crypto from "crypto";
import redis from "../src/redis";
import { prisma } from "../src/db";
import { config } from "../src/config";

/**
 * Dev helper: creates a valid session for the seeded dev user and prints a
 * `Cookie: connect.sid=...` header you can paste into curl requests to test
 * the auth-protected /api/* endpoints without a Google login.
 *
 * Usage: npm run dev-session
 */
function sign(val: string, secret: string): string {
  return (
    val +
    "." +
    crypto.createHmac("sha256", secret).update(val).digest("base64").replace(/=+$/, "")
  );
}

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("[dev-session] No user found — run `npm run seed` first.");
    process.exit(1);
  }

  const sid = crypto.randomBytes(24).toString("base64url");
  const sessionData = JSON.stringify({
    cookie: {
      originalMaxAge: 1000 * 60 * 60 * 24 * 7,
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    },
    passport: { user: user.id },
  });

  await redis.set(`sess:${sid}`, sessionData);

  const signed = `s:${sign(sid, config.sessionSecret)}`;
  console.log("SESSION_COOKIE=" + signed);
  console.log("USER_ID=" + user.id);
  console.log("USER_EMAIL=" + user.email);
  console.log("");
  console.log("Example: curl -b 'connect.sid=$env:SESSION_COOKIE' http://localhost:4000/api/me");

  await redis.disconnect();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await redis.disconnect();
  await prisma.$disconnect();
  process.exit(1);
});
