import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { MessageStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: MessageStatus }) {
  switch (status) {
    case "PENDING":
    case "PROCESSING":
      return (
        <Badge tone="amber">
          <Clock className="h-3 w-3" />
          {status === "PENDING" ? "Scheduled" : "Sending"}
        </Badge>
      );
    case "SENT":
      return (
        <Badge tone="gray">
          <CheckCircle2 className="h-3 w-3" />
          Sent
        </Badge>
      );
    case "FAILED":
      return (
        <Badge tone="red">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge tone="gray">
          <XCircle className="h-3 w-3" />
          Cancelled
        </Badge>
      );
  }
}
