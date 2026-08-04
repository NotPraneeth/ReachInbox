import { EmailListView } from "@/components/emails/EmailListView";

export const metadata = { title: "Sent · ReachInbox" };

export default function SentPage() {
  return <EmailListView kind="sent" title="Sent" />;
}
