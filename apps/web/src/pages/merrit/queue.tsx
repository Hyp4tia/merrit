import { Input, NativeSelect, NativeSelectOption, ScrollArea, Skeleton } from "@rakazo/ui-web";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ApprovalItem, Filters } from "./api";
import { CHANNEL_LABEL, cx, LanguageChip, STATUS_LABEL, StatusChip } from "./status";

const STATUSES = Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>;

interface QueueProps {
  items: ApprovalItem[];
  filters: Filters;
  loading: boolean;
  selectedId: string | null;
  onFilters: (next: Filters) => void;
  onSelect: (id: string) => void;
}

function QueueCard({
  item,
  active,
  onSelect,
}: {
  item: ApprovalItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cx(
        "w-full rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-ring/60 bg-accent/60"
          : "border-border bg-card hover:border-border/80 hover:bg-accent/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {CHANNEL_LABEL[item.channel] ?? item.channel}
        </span>
        <LanguageChip language={item.language} />
        <span className="ml-auto shrink-0">
          <StatusChip status={item.status} />
        </span>
      </div>
      {/* dir="auto" so an Arabic angle keeps its punctuation on the correct side. */}
      <p className="mt-2 line-clamp-1 text-sm font-medium" dir="auto">
        {item.angle}
      </p>
      <p
        className="mt-1 line-clamp-2 text-sm text-muted-foreground"
        dir={item.language === "ar" ? "rtl" : "ltr"}
      >
        {item.body}
      </p>
      <p className="mt-2 text-xs text-faint-foreground">
        {formatRelativeTime(item.created_at)}
        {item.review_reason ? " · flagged for review" : ""}
      </p>
    </button>
  );
}

/** Center column: filters over the queue for the selected brand. */
export function Queue({ items, filters, loading, selectedId, onFilters, onSelect }: QueueProps) {
  const patch = (next: Partial<Filters>) => onFilters({ ...filters, ...next });

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Approval queue">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <NativeSelect
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => patch({ status: event.target.value as Filters["status"] })}
          className="h-8 w-32 text-xs"
        >
          <NativeSelectOption value="all">All statuses</NativeSelectOption>
          {STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {STATUS_LABEL[status]}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Filter by channel"
          value={filters.channel}
          onChange={(event) => patch({ channel: event.target.value })}
          className="h-8 w-40 text-xs"
        >
          <NativeSelectOption value="all">All channels</NativeSelectOption>
          <NativeSelectOption value="linkedin_personal">LinkedIn, personal</NativeSelectOption>
          <NativeSelectOption value="linkedin_company">LinkedIn, page</NativeSelectOption>
          <NativeSelectOption value="instagram">Instagram</NativeSelectOption>
          <NativeSelectOption value="x">X</NativeSelectOption>
        </NativeSelect>

        <NativeSelect
          aria-label="Filter by language"
          value={filters.language}
          onChange={(event) => patch({ language: event.target.value as Filters["language"] })}
          className="h-8 w-36 text-xs"
        >
          <NativeSelectOption value="all">All languages</NativeSelectOption>
          <NativeSelectOption value="en">English</NativeSelectOption>
          <NativeSelectOption value="ar">Arabic</NativeSelectOption>
        </NativeSelect>

        <Input
          aria-label="Search drafts"
          placeholder="Search text or angle"
          value={filters.q}
          onChange={(event) => patch({ q: event.target.value })}
          className="h-8 w-56 text-xs"
        />

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {items.length} {items.length === 1 ? "draft" : "drafts"}
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-4">
          {loading
            ? [0, 1, 2].map((key) => <Skeleton key={key} className="h-28 w-full rounded-lg" />)
            : null}

          {!loading && items.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Nothing here yet. Generate a batch, or widen the filters.
            </div>
          ) : null}

          {items.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              active={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
