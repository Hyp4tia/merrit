import { Badge, Disclosure, Separator } from "@rakazo/ui-web";
import { Inbox, Lock, MessageSquare } from "lucide-react";
import type { ThreadSummary } from "./api";
import { ConnectionDot, cx } from "./status";

interface BotSidebarProps {
  brandName: string;
  threads: ThreadSummary[];
  activeBotId: string | null;
  onSelectBot: (id: string) => void;
  view: "chat" | "queue";
  onView: (view: "chat" | "queue") => void;
  draftsWaiting: number;
  accountConnected: boolean;
  accountLabel: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Left rail: the two bots that work today, one line for the rest, and the way into the queue.
 * Counters say what they count, because an unlabelled badge is a puzzle.
 */
export function BotSidebar({
  brandName,
  threads,
  activeBotId,
  onSelectBot,
  view,
  onView,
  draftsWaiting,
  accountConnected,
  accountLabel,
}: BotSidebarProps) {
  const working = threads.filter((entry) => entry.bot.active);
  const coming = threads.filter((entry) => !entry.bot.active);

  return (
    <aside
      aria-label="Bots"
      className="flex w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:w-60"
    >
      <p className="hidden px-3 pt-4 pb-2 text-merrit-footnote font-medium tracking-wide text-muted-foreground uppercase md:block">
        {brandName}
      </p>

      <ul className="space-y-0.5 px-2">
        {working.map(({ bot, messageCount }) => {
          const active = view === "chat" && bot.id === activeBotId;
          return (
            <li key={bot.id}>
              <button
                type="button"
                onClick={() => {
                  onSelectBot(bot.id);
                  onView("chat");
                }}
                aria-label={bot.name}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60",
                )}
              >
                <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-merrit-footnote font-semibold">
                  {initials(bot.name)}
                  <ConnectionDot
                    connected={accountConnected}
                    className="absolute -right-0.5 -bottom-0.5 ring-2 ring-sidebar"
                  />
                </span>
                <span className="hidden min-w-0 flex-1 md:block">
                  <span className="block truncate text-merrit-caption font-medium">{bot.name}</span>
                  <span className="block text-merrit-footnote text-faint-foreground">
                    {counted(messageCount, "message")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {coming.length > 0 ? (
        <div className="hidden px-3 pt-2 md:block">
          <Disclosure
            summary={
              <span className="text-merrit-footnote text-muted-foreground">
                {coming.length} more bots, coming soon
              </span>
            }
            summaryClassName="text-merrit-footnote"
          >
            <ul className="mt-1.5 space-y-1">
              {coming.map(({ bot }) => (
                <li
                  key={bot.id}
                  className="flex items-center gap-1.5 px-1 text-merrit-footnote text-faint-foreground"
                >
                  <Lock className="size-3 shrink-0" />
                  <span className="truncate">{bot.name}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      ) : null}

      <div className="px-3 py-3">
        <Separator />
      </div>

      <nav className="space-y-1 px-2" aria-label="Surfaces">
        <button
          type="button"
          onClick={() => onView("chat")}
          aria-label="Chat"
          aria-current={view === "chat" ? "page" : undefined}
          className={cx(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-merrit-caption transition-colors",
            view === "chat" ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
          )}
        >
          <MessageSquare className="size-3.5" />
          <span className="hidden md:inline">Chat</span>
        </button>
        <button
          type="button"
          onClick={() => onView("queue")}
          aria-label="Drafts"
          aria-current={view === "queue" ? "page" : undefined}
          className={cx(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-merrit-caption transition-colors",
            view === "queue" ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
          )}
        >
          <Inbox className="size-3.5" />
          <span className="hidden md:inline">Drafts</span>
          <Badge
            variant="secondary"
            className="ml-auto hidden text-merrit-footnote tabular-nums md:inline-flex"
          >
            {draftsWaiting} waiting
          </Badge>
        </button>
      </nav>

      <p className="mt-auto hidden items-center gap-1.5 px-3 py-3 text-merrit-footnote text-faint-foreground md:flex">
        <ConnectionDot connected={accountConnected} />
        {accountConnected ? `${accountLabel} connected` : `${accountLabel} not connected`}
      </p>
    </aside>
  );
}
