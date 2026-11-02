import type { MerritStatus } from "./api";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/** Owner language, not system language: nobody outside the engine says "dry_run". */
export const STATUS_LABEL: Record<MerritStatus, string> = {
  pending: "Waiting for you",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
  manual: "Needs a look",
  dry_run: "Tested",
  deleted: "Removed",
};

// Shape carries the state as well as colour: a pill, a square, a dashed outline, a dotted one.
// Colour alone fails for anyone who cannot separate amber from green at this size.
const STATUS_SHAPE: Record<MerritStatus, string> = {
  pending: "rounded-full border-warning/50 bg-warning/10 text-warning",
  approved: "rounded-md border-success/50 bg-success/10 text-success",
  rejected: "rounded-md border-dashed border-destructive/50 bg-transparent text-destructive",
  scheduled: "rounded-full border-status-working/50 bg-status-working/10 text-status-working",
  published: "rounded-md border-link/50 bg-link/15 text-link",
  manual: "rounded-full border-dotted border-warning/60 bg-transparent text-warning",
  dry_run:
    "rounded-sm border-dotted border-status-working/60 bg-status-working/10 text-status-working",
  deleted: "rounded-md border-border bg-muted text-faint-foreground line-through",
};

export function StatusPill({ status, className }: { status: MerritStatus; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center border px-2 text-merrit-footnote font-medium whitespace-nowrap",
        STATUS_SHAPE[status],
        className,
      )}
      data-status={status}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export const CHANNEL_LABEL: Record<string, string> = {
  linkedin_personal: "LinkedIn",
  linkedin_company: "LinkedIn page",
  instagram: "Instagram",
  x: "X",
};

export function ChannelLabel({ channel }: { channel: string }) {
  return <span>{CHANNEL_LABEL[channel] ?? channel}</span>;
}

export function LanguageTag({ language }: { language: "en" | "ar" }) {
  return (
    <span className="text-merrit-caption text-muted-foreground uppercase">
      {language === "ar" ? "Arabic" : "English"}
    </span>
  );
}

/** Only these statuses can produce a preview payload, and only through a test send. */
export function canDryRun(status: MerritStatus): boolean {
  return status === "approved" || status === "scheduled" || status === "manual";
}

export function canEdit(status: MerritStatus): boolean {
  return status !== "published" && status !== "deleted";
}

/** A draft reads as "Draft #12", which is what a person would call it. */
export function draftLabel(index: number | undefined): string {
  return index === undefined ? "Draft" : `Draft #${index}`;
}

export function ConnectionDot({
  connected,
  className,
}: {
  connected: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "size-2 shrink-0 rounded-full",
        connected ? "bg-success" : "bg-destructive",
        className,
      )}
    />
  );
}
