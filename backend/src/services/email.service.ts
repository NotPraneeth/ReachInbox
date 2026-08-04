import nodemailer, { Transporter } from "nodemailer";

export interface SenderCredentials {
  id: string;
  displayName: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export interface SendResult {
  messageId: string;
  testMessageUrl: string | null;
}

const transportCache = new Map<string, Transporter>();

export function getTransport(sender: SenderCredentials): Transporter {
  const existing = transportCache.get(sender.id);
  if (existing) return existing;

  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: {
      user: sender.smtpUser,
      pass: sender.smtpPass,
    },
  });

  transportCache.set(sender.id, transport);
  return transport;
}

export interface SendEmailInput {
  sender: SenderCredentials;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
}

/** Sends a single email via the sender's SMTP transport (Ethereal for testing). */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const transport = getTransport(input.sender);
  const info = await transport.sendMail({
    from: `"${input.sender.displayName}" <${input.sender.email}>`,
    to: input.recipientEmail,
    subject: input.subject,
    html: input.bodyHtml,
  });

  return {
    messageId: info.messageId,
    testMessageUrl: nodemailer.getTestMessageUrl(info) || null,
  };
}
