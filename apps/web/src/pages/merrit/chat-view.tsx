import { Badge, Button, ScrollArea, Textarea } from "@rakazo/ui-web";
import { ArrowRightLeft, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ApprovalItem, Bot, Delegation, ThreadMessage } from "./api";
import { DraftCard } from "./draft-card";
import { cx, draftLabel } from "./status";

interface ChatViewProps {
  bot: Bot | null;
  messages: ThreadMessage[];
  delegations: Delegation[];
  items: Map<string, ApprovalItem>;
  draftNumbers: Map<string, number>;
  authorName: string;
  accountLabel: string;
  loading: boolean;
  sending: boolean;
  busy: boolean;
  error: string | null;
  onSend: (message: string) => void;
  /** Moves to the other side of a delegation, keeping the same brand context. */
  onOpenDelegation: (delegation: Delegation) => void;
  botName: (botId: string) => string;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onSave: (id: string, body: string) => void;
  onOpenItem: (id: string) => void;
}

const STARTERS: Record<string, string[]> = {
  lead: ["Draft a post that answers the cheap-site objection.", "What is waiting for me?"],
  copywriter: ["Make it shorter.", "Open with the booking failure.", "Drop the last line."],
};

// A message that carries a whole post is the artifact. A one or two sentence reply is a bubble.
const DRAFT_LENGTH = 200;

function DelegationCard({
  delegation,
  onOpen,
  botName,
  here,
  number,
}: {
  delegation: Delegation;
  onOpen: () => void;
  botName: (botId: string) => string;
  here: string;
  number: number | undefined;
}) {
  const other = delegation.fromBot === here ? delegation.toBot : delegation.fromBot;
  return (
    <div className="mt-1.5 w-full rounded-lg border border-border bg-muted/40 p-2.5">
      <p className="flex items-center gap-1.5 text-merrit-footnote font-medium text-muted-foreground">
        <ArrowRightLeft className="size-3.5" />
        {botName(delegation.fromBot)} handed this to {botName(delegation.toBot)}
      </p>
      <p className="mt-1 text-merrit-caption">{delegation.request}</p>
      <div className="mt-2 flex items-center gap-2">
        <Badge variant="outline" className="text-merrit-footnote">
          {draftLabel(number)}
        </Badge>
        <Button size="xs" variant="outline" className="ml-auto" onClick={onOpen}>
          Open {botName(other)}
        </Button>
      </div>
    </div>
  );
}

/** The conversation with one bot, with drafts rendered as artifacts you can act on. */
export function ChatView({
  bot,
  messages,
  delegations,
  items,
  draftNumbers,
  authorName,
  accountLabel,
  loading,
  sending,
  busy,
  error,
  onSend,
  onOpenDelegation,
  botName,
  onApprove,
  onReject,
  onSave,
  onOpenItem,
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Chat with the bot">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 pt-6 pb-10">
          <header className="border-b border-border pb-3">
            <h1 className="text-merrit-title font-semibold tracking-tight">
              {bot?.name ?? "Merrit"}
            </h1>
            <p className="mt-0.5 text-merrit-secondary text-muted-foreground">{bot?.description}</p>
          </header>

          {loading ? (
            <p className="text-merrit-secondary text-muted-foreground">Loading the thread…</p>
          ) : null}

          {!loading && messages.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-merrit-body">
                {bot?.role === "lead"
                  ? "Tell me what you need written. I hand it to the copywriter and bring the draft back here."
                  : "I draft and edit from the brand file. Anything you send me edits the current draft."}
              </p>
              {starters.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {starters.map((starter) => (
                    <Button
                      key={starter}
                      size="sm"
                      variant="outline"
                      onClick={() => onSend(starter)}
                      disabled={sending}
                      className="text-merrit-caption"
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
            const item = message.itemId ? (items.get(message.itemId) ?? null) : null;
            const isDraft =
              message.role === "assistant" &&
              Boolean(message.itemId) &&
              message.content.trim().length >= DRAFT_LENGTH;

            return (
              <div
                key={message.id}
                className={cx("flex flex-col gap-1", mine ? "items-end" : "items-start")}
              >
                {isDraft && message.itemId ? (
                  <DraftCard
                    item={item}
                    number={draftNumbers.get(message.itemId)}
                    fallbackBody={message.content}
                    authorName={authorName}
                    accountLabel={accountLabel}
                    busy={busy}
                    onApprove={onApprove}
                    onReject={onReject}
                    onSave={onSave}
                    onOpen={onOpenItem}
                  />
                ) : (
                  <div
                    className={cx(
                      "max-w-[85%] rounded-xl px-3.5 py-2.5 text-merrit-body whitespace-pre-wrap",
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-card-foreground",
                    )}
                  >
                    {message.content}
                  </div>
                )}
                <p className="text-merrit-footnote text-faint-foreground">
                  {mine ? "You" : botName(message.bot)} · {formatRelativeTime(message.at)}
                  {message.itemId ? ` · ${draftLabel(draftNumbers.get(message.itemId))}` : ""}
                </p>
                {delegation ? (
                  <DelegationCard
                    delegation={delegation}
                    botName={botName}
                    here={bot?.id ?? delegation.fromBot}
                    number={delegation.itemId ? draftNumbers.get(delegation.itemId) : undefined}
                    onOpen={() => onOpenDelegation(delegation)}
                  />
                ) : null}
              </div>
            );
          })}

          {sending ? (
            <p className="text-merrit-secondary text-muted-foreground">{bot?.name} is working…</p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-merrit-caption text-destructive">
              {error}
            </p>
          ) : null}
          <div ref={end} />
        </div>
      </ScrollArea>

      <div className="border-t border-border px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
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
            className="min-h-14 resize-none text-merrit-body"
          />
          <Button
            onClick={send}
            disabled={sending || draft.trim().length === 0}
            className="h-14 px-4"
          >
            <SendHorizontal className="size-4" />
            Send
          </Button>
        </div>
      </div>
    </section>
  );
}
