import { Badge, Separator } from "@rakazo/ui-web";
import { Inbox, MessageSquare } from "lucide-react";
import { cx } from "./status";

export interface SidebarBot {
  id: string;
  name: string;
  description: string;
}

interface BotSidebarProps {
  brandName: string;
  bots: SidebarBot[];
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
 * Left rail: the bots that work on this brand, plus the two surfaces. Each bot gets an avatar and
 * a status dot, so the rail reads as a roster rather than a menu.
 */
export function BotSidebar({
  brandName,
  bots,
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

      <ul className="px-2">
        {bots.map((bot) => {
          const active = view === "chat" && bot.id === activeBotId;
          return (
            <li key={bot.id}>
              <button
                type="button"
                onClick={() => {
                  onSelectBot(bot.id);
                  onView("chat");
                }}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60",
                )}
              >
                <span className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold">
                  {initials(bot.name)}
                  <span
                    className={cx(
                      "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
                      accountConnected ? "bg-success" : "bg-warning",
                    )}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{bot.name}</span>
                  <span className="line-clamp-2 block text-xs text-faint-foreground">
                    {bot.description}
                  </span>
                </span>
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
