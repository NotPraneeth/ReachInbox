import { EmailListView } from "@/components/emails/EmailListView";

export const metadata = { title: "Scheduled · ReachInbox" };

export default function ScheduledPage() {
  return <EmailListView kind="scheduled" title="Scheduled" />;
}
