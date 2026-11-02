import { Badge, Separator } from "@rakazo/ui-web";
import { Inbox, Lock, MessageSquare } from "lucide-react";
import type { ThreadSummary } from "./api";
import { cx } from "./status";

interface BotSidebarProps {
  brandName: string;
  threads: ThreadSummary[];
  activeBotId: string | null;
  onSelectBot: (id: string) => void;
  view: "chat" | "queue";
  onView: (view: "chat" | "queue") => void;
  needsReview: number;
  accountConnected: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * Left rail: the declared roster. Active bots open a thread; the rest are listed and visibly
 * inactive, because a bot that is declared but not built should never look available.
 */
export function BotSidebar({
  brandName,
  threads,
  activeBotId,
  onSelectBot,
  view,
  onView,
  needsReview,
  accountConnected,
}: BotSidebarProps) {
  return (
    <aside
      aria-label="Bots"
      className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
    >
      <p className="px-3 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {brandName}
      </p>

      <ul className="space-y-0.5 px-2">
        {threads.map(({ bot, messageCount }) => {
          const active = view === "chat" && bot.id === activeBotId;
          const selectable = bot.active;
          return (
            <li key={bot.id}>
              <button
                type="button"
                disabled={!selectable}
                onClick={() => {
                  onSelectBot(bot.id);
                  onView("chat");
                }}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : selectable
                      ? "hover:bg-sidebar-accent/60"
                      : "cursor-not-allowed opacity-50",
                )}
              >
                <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold">
                  {initials(bot.name)}
                  {bot.active ? (
                    <span
                      className={cx(
                        "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
                        accountConnected ? "bg-success" : "bg-warning",
                      )}
                      aria-hidden
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm">{bot.name}</span>
                    {bot.active ? null : <Lock className="size-3 shrink-0" aria-hidden />}
                  </span>
                  <span className="line-clamp-2 block text-xs text-faint-foreground">
                    {bot.description}
                  </span>
                </span>
                {bot.active && messageCount > 0 ? (
                  <Badge variant="secondary" className="tabular-nums">
                    {messageCount}
                  </Badge>
                ) : null}
                {bot.active ? null : (
                  <Badge variant="outline" className="text-faint-foreground">
                    inactive
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="px-3 py-3">
        <Separator />
      </div>

      <nav className="space-y-1 px-2" aria-label="Surfaces">
        <button
          type="button"
          onClick={() => onView("chat")}
          aria-current={view === "chat" ? "page" : undefined}
          className={cx(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            view === "chat" ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
          )}
        >
          <MessageSquare className="size-3.5" />
          Chat
        </button>
        <button
          type="button"
          onClick={() => onView("queue")}
          aria-current={view === "queue" ? "page" : undefined}
          className={cx(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            view === "queue" ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
          )}
        >
          <Inbox className="size-3.5" />
          Review queue
          {needsReview > 0 ? (
            <Badge variant="secondary" className="ml-auto tabular-nums">
              {needsReview}
            </Badge>
          ) : null}
        </button>
      </nav>
    </aside>
  );
}
