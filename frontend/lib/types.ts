export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Sender {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export interface ConfigDefaults {
  delayBetweenEmailsSec: { min: number; max: number; default: number };
  hourlyLimit: { min: number; max: number; default: number };
}

export type MessageStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "CANCELLED";

export interface EmailMessage {
  id: string;
  recipientEmail: string;
  status: MessageStatus;
  scheduledAt: string;
  sentAt: string | null;
  failReason: string | null;
  attemptCount: number;
  subject: string;
  senderName: string;
  senderEmail: string;
}

export interface PaginatedEmails {
  items: EmailMessage[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Counts {
  scheduledCount: number;
  sentCount: number;
}

export interface ParseLeadsResult {
  validEmails: string[];
  invalidCount: number;
  totalDetected: number;
}

export interface CreateCampaignResult {
  campaignId: string;
  totalRecipients: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
}

export interface CreateCampaignInput {
  senderId: string;
  subject: string;
  bodyHtml: string;
  recipients: string[];
  startTime: string;
  delayBetweenEmailsSec: number;
  hourlyLimit: number;
}
