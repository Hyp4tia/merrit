import { Badge } from "@rakazo/ui-web";
import type { Language, MerritStatus } from "./api";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export const STATUS_LABEL: Record<MerritStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
  manual: "Manual",
  dry_run: "Dry run",
  deleted: "Deleted",
};

// Tones reuse the shell's semantic tokens, so the queue matches the rest of the app without a
// new palette.
const STATUS_TONE: Record<MerritStatus, string> = {
  pending: "border-warning/40 bg-warning/10 text-warning",
  approved: "border-success/40 bg-success/10 text-success",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  scheduled: "border-status-working/40 bg-status-working/10 text-status-working",
  published: "border-link/40 bg-link/10 text-link",
  manual: "border-border bg-muted text-muted-foreground",
  dry_run: "border-warning/40 bg-warning/10 text-warning",
  deleted: "border-border bg-muted text-faint-foreground line-through",
};

export function StatusChip({ status }: { status: MerritStatus }) {
  return (
    <Badge variant="outline" className={cx("font-medium", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export const CHANNEL_LABEL: Record<string, string> = {
  linkedin_personal: "LinkedIn, personal",
  linkedin_company: "LinkedIn, page",
  instagram: "Instagram",
  x: "X",
};

export function LanguageChip({ language }: { language: Language }) {
  return (
    <Badge variant="secondary" className="uppercase">
      {language}
    </Badge>
  );
}

/** Only these statuses can produce a payload, and only through a dry run. */
export function canDryRun(status: MerritStatus): boolean {
  return status === "approved" || status === "scheduled" || status === "manual";
}

export function canEdit(status: MerritStatus): boolean {
  return status !== "published" && status !== "deleted";
}
