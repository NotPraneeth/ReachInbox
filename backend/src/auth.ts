import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import RedisStore from "connect-redis";
import { Request, Response, NextFunction } from "express";
import nodemailer from "nodemailer";
import { config } from "./config";
import { prisma } from "./db";
import redis from "./redis";

/**
 * Auto-provisions Ethereal test senders for a user who has none.
 * Called after every successful Google login so new users get a working
 * Compose → From dropdown immediately without needing to run the seed.
 * Non-fatal: a failure here is logged but never blocks the login.
 */
async function ensureSenders(userId: string, displayName: string): Promise<void> {
  const existing = await prisma.sender.count({ where: { userId } });
  if (existing > 0) return;

  if (!config.ethereal.autoCreate) {
    console.warn("[auth] New user has no senders and ETHEREAL_AUTO_CREATE=false — set credentials manually.");
    return;
  }

  try {
    const accounts = await Promise.all([
      nodemailer.createTestAccount(),
      nodemailer.createTestAccount(),
    ]);
    await prisma.sender.createMany({
      data: accounts.map((acct, i) => ({
        userId,
        displayName: `${displayName} ${i + 1}`,
        email: acct.user,
        smtpHost: acct.smtp.host,
        smtpPort: acct.smtp.port,
        smtpUser: acct.user,
        smtpPass: acct.pass,
      })),
    });
    console.log(`[auth] Auto-created 2 Ethereal senders for user ${userId}`);
  } catch (err) {
    console.error("[auth] Failed to auto-create Ethereal senders:", err);
  }
}

export function configurePassport() {
  passport.serializeUser((user, done) => {
    done(null, (user as { id: string }).id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user ?? false);
    } catch (err) {
      done(err as Error, false);
    }
  });

  if (config.google.clientId && config.google.clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl,
          scope: ["profile", "email"],
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const googleId = profile.id;
            const email = profile.emails?.[0]?.value;
            const name = profile.displayName;
            const avatarUrl = profile.photos?.[0]?.value;

            if (!email) {
              return done(new Error("Google profile missing email"), false);
            }

            let user = await prisma.user.findUnique({ where: { googleId } });

            if (!user) {
              user = await prisma.user.findUnique({ where: { email } });
              if (user) {
                user = await prisma.user.update({
                  where: { id: user.id },
                  data: { googleId },
                });
              } else {
                user = await prisma.user.create({
                  data: { googleId, email, name, avatarUrl },
                });
              }
            }

            // Ensure every Google user has at least one sender so the
            // Compose form works on first login without a manual seed step.
            await ensureSenders(user.id, user.name);

            return done(null, user);
          } catch (err) {
            return done(err as Error, false);
          }
        },
      ),
    );
  }
}

export const sessionMiddleware = session({
  store: new RedisStore({ client: redis, prefix: "sess:" }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    sameSite: "lax",
  },
});

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

declare global {
  namespace Express {
    interface User {
      id: string;
      googleId: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      createdAt: Date;
    }
  }
}