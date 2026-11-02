import { Badge, Button, Input, ScrollArea } from "@rakazo/ui-web";
import { Check, Search, X } from "lucide-react";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ApprovalItem, Filters, MerritStatus } from "./api";
import { ChannelLabel, cx, draftLabel, LanguageTag, StatusPill } from "./status";

interface QueueProps {
  items: ApprovalItem[];
  filters: Filters;
  loading: boolean;
  selectedId: string | null;
  draftNumbers: Map<string, number>;
  onFilters: (filters: Filters) => void;
  onSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onSendBack: (id: string) => void;
  busy: boolean;
}

const STATUS_OPTIONS: Array<{ value: MerritStatus | "all"; label: string }> = [
  { value: "all", label: "All drafts" },
  { value: "pending", label: "Waiting for you" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "dry_run", label: "Tested" },
  { value: "deleted", label: "Removed" },
];

/** The queue: one filter row, dense rows, and the two decisions on hover. */
export function Queue({
  items,
  filters,
  loading,
  selectedId,
  draftNumbers,
  onFilters,
  onSelect,
  onApprove,
  onSendBack,
  busy,
}: QueueProps) {
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border pb-2 md:border-b-0 md:pb-0"
      aria-label="Draft queue"
    >
      <header className="flex items-baseline gap-2 px-5 pt-4 pb-2">
        <h1 className="text-merrit-title font-semibold tracking-tight">Drafts</h1>
        <span className="text-merrit-caption text-muted-foreground">
          {items.length} {items.length === 1 ? "draft" : "drafts"}
        </span>
        <span className="ml-auto flex items-center gap-1 text-merrit-footnote text-faint-foreground">
          <kbd className="rounded border border-border px-1">J</kbd>
          <kbd className="rounded border border-border px-1">K</kbd> move
          <kbd className="ml-1.5 rounded border border-border px-1">A</kbd> approve
          <kbd className="rounded border border-border px-1">R</kbd> send back
        </span>
      </header>

      <div className="flex items-center gap-2 px-5 pb-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Search drafts"
            placeholder="Search drafts"
            value={filters.q}
            onChange={(event) => set({ q: event.target.value })}
            className="h-8 pl-7 text-merrit-caption"
          />
        </div>
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(event) => set({ status: event.target.value as Filters["status"] })}
          className="h-8 rounded-md border border-border bg-transparent px-2 text-merrit-caption"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Language"
          value={filters.language}
          onChange={(event) => set({ language: event.target.value as Filters["language"] })}
          className="h-8 rounded-md border border-border bg-transparent px-2 text-merrit-caption"
        >
          <option value="all">Any language</option>
          <option value="en">English</option>
          <option value="ar">Arabic</option>
        </select>
        <select
          aria-label="Channel"
          value={filters.channel}
          onChange={(event) => set({ channel: event.target.value as Filters["channel"] })}
          className="h-8 rounded-md border border-border bg-transparent px-2 text-merrit-caption"
        >
          <option value="all">Any channel</option>
          <option value="linkedin_personal">LinkedIn</option>
          <option value="linkedin_company">LinkedIn page</option>
        </select>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="px-2 pb-6">
          {loading ? (
            <li className="px-3 py-6 text-merrit-secondary text-muted-foreground">
              Loading drafts…
            </li>
          ) : null}
          {!loading && items.length === 0 ? (
            <li className="px-3 py-6 text-merrit-secondary text-muted-foreground">
              Nothing matches these filters.
            </li>
          ) : null}

          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <li key={item.id}>
                <div
                  className={cx(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                    selected ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={selected ? "true" : undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="w-16 shrink-0 text-merrit-footnote text-faint-foreground tabular-nums">
                      {draftLabel(draftNumbers.get(item.id))}
                    </span>
                    <span dir="auto" className="min-w-0 flex-1">
                      <span className="block truncate text-merrit-caption font-medium">
                        {item.angle}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-merrit-footnote text-muted-foreground">
                        <ChannelLabel channel={item.channel} />
                        <span>·</span>
                        <LanguageTag language={item.language} />
                        <span>·</span>
                        <span>{formatRelativeTime(item.created_at)}</span>
                        {item.review_reason ? (
                          <Badge variant="outline" className="ml-1 text-merrit-footnote">
                            needs a look
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <StatusPill status={item.status} />
                  </button>

                  {item.status === "pending" ? (
                    <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Approve ${draftLabel(draftNumbers.get(item.id))}`}
                        disabled={busy}
                        onClick={() => onApprove(item.id)}
                      >
                        <Check className="size-3" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Send back ${draftLabel(draftNumbers.get(item.id))}`}
                        disabled={busy}
                        className="border-destructive/40 text-destructive"
                        onClick={() => onSendBack(item.id)}
                      >
                        <X className="size-3" />
                      </Button>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </section>
  );
}
