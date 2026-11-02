import { Badge, Button, ScrollArea, Textarea } from "@rakazo/ui-web";
import { ArrowRightLeft, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import type { Bot, Delegation, ThreadMessage } from "./api";
import { cx } from "./status";

interface ChatViewProps {
  bot: Bot | null;
  messages: ThreadMessage[];
  delegations: Delegation[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  accountLabel: string;
  accountConnected: boolean;
  onSend: (message: string) => void;
  /** Moves to the other side of a delegation, keeping the same brand context. */
  onOpenDelegation: (delegation: Delegation) => void;
  botName: (botId: string) => string;
}

const STARTERS: Record<string, string[]> = {
  lead: [
    "Draft a post that answers the cheap-site objection.",
    "What is on the queue waiting for me?",
  ],
  copywriter: ["Make it shorter.", "Open with the booking failure instead.", "Drop the last line."],
};

function DelegationCard({
  delegation,
  onOpen,
  botName,
  here,
}: {
  delegation: Delegation;
  onOpen: () => void;
  botName: (botId: string) => string;
  /** The thread this card is rendered in, so the button points at the other side. */
  here: string;
}) {
  const other = delegation.fromBot === here ? delegation.toBot : delegation.fromBot;
  return (
    <div className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ArrowRightLeft className="size-3.5" />
        Delegation · {botName(delegation.fromBot)} to {botName(delegation.toBot)}
      </p>
      <p className="mt-1 text-sm">{delegation.request}</p>
      <div className="mt-2 flex items-center gap-2">
        {delegation.itemId ? (
          <Badge variant="outline" className="font-mono text-xs">
            item {delegation.itemId.slice(0, 8)}
          </Badge>
        ) : null}
        <Badge variant="secondary">{delegation.status}</Badge>
        <Button size="xs" variant="outline" className="ml-auto" onClick={onOpen}>
          Open {botName(other)}
        </Button>
      </div>
    </div>
  );
}

/** The conversation with one bot. Delegation cards appear in both threads, from one row. */
export function ChatView({
  bot,
  messages,
  delegations,
  loading,
  sending,
  error,
  accountLabel,
  accountConnected,
  onSend,
  onOpenDelegation,
  botName,
}: ChatViewProps) {
  const [draft, setDraft] = useState("");
  const byId = new Map(delegations.map((delegation) => [delegation.id, delegation]));
  const end = useRef<HTMLDivElement | null>(null);

  // A new turn lands below the fold otherwise, which hides the very reply the owner is waiting for.
  useEffect(() => {
    if (typeof end.current?.scrollIntoView === "function") {
      end.current.scrollIntoView({ block: "end" });
    }
  }, [bot?.id, messages.length, sending]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
  };

  const starters = STARTERS[bot?.role ?? ""] ?? [];

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat with the bot">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 pt-6 pb-10">
          {loading ? <p className="text-sm text-muted-foreground">Loading the thread…</p> : null}

          {!loading && messages.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm font-medium">{bot?.name ?? "This bot"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{bot?.description}</p>
              {starters.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {starters.map((starter) => (
                    <Button
                      key={starter}
                      size="sm"
                      variant="outline"
                      onClick={() => onSend(starter)}
                      disabled={sending}
                    >
                      {starter}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {messages.map((message) => {
            const mine = message.role === "user";
            const delegation = message.delegationId ? byId.get(message.delegationId) : undefined;

            return (
              <div
                key={message.id}
                className={cx("flex flex-col gap-1", mine ? "items-end" : "items-start")}
              >
                <div
                  className={cx(
                    "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-card-foreground",
                  )}
                >
                  {message.content}
                </div>
                <p className="text-xs text-faint-foreground">
                  {mine ? "You" : botName(message.bot)} · {formatRelativeTime(message.at)}
                  {message.itemId ? ` · item ${message.itemId.slice(0, 8)}` : ""}
                </p>
                {delegation ? (
                  <DelegationCard
                    delegation={delegation}
                    botName={botName}
                    here={bot?.id ?? delegation.fromBot}
                    onOpen={() => onOpenDelegation(delegation)}
                  />
                ) : null}
              </div>
            );
          })}

          {sending ? (
            <p className="text-sm text-muted-foreground">{bot?.name} is working…</p>
          ) : null}
          <div ref={end} />
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border px-6 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Message the bot"
              placeholder={`Message ${bot?.name ?? "the bot"}.`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className="min-h-16 resize-none text-sm"
            />
            <Button
              onClick={send}
              disabled={sending || draft.trim().length === 0}
              className="h-16 px-4"
            >
              <SendHorizontal className="size-4" />
              Send
            </Button>
          </div>
          <p className="mt-2 text-xs text-faint-foreground">
            Drafting only. Every draft lands in the review queue as one item, and publishing stays
            disabled.{" "}
            {accountConnected
              ? `Rehearsals would resolve to ${accountLabel}.`
              : `${accountLabel} is not connected, so no payload can be produced for it.`}
          </p>
        </div>
      </div>
    </section>
  );
}
