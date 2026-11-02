import { Button, ScrollArea, Textarea } from "@rakazo/ui-web";
import { SendHorizontal } from "lucide-react";
import { useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ChatTurn } from "./api";
import { cx } from "./status";

interface ChatViewProps {
  botName: string;
  messages: ChatTurn[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  accountLabel: string;
  accountConnected: boolean;
  onSend: (message: string) => void;
}

const STARTERS = [
  "Draft three posts for this week.",
  "What does an engagement with us cost, exactly?",
  "Write one post that answers the cheap-site objection.",
];

/** The home surface: a conversation with the brand's bot. */
export function ChatView({
  botName,
  messages,
  loading,
  sending,
  error,
  accountLabel,
  accountConnected,
  onSend,
}: ChatViewProps) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft("");
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat with the bot">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
          {loading ? <p className="text-sm text-muted-foreground">Loading the thread…</p> : null}

          {!loading && messages.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-sm font-medium">{botName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask for drafts, or ask what the brand file allows. Everything I write lands in the
                review queue, and nothing is ever posted from here.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {STARTERS.map((starter) => (
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
            </div>
          ) : null}

          {messages.map((message) => {
            const mine = message.role === "user";
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
                  {message.body}
                </div>
                <p className="text-xs text-faint-foreground">
                  {mine ? "You" : botName} · {formatRelativeTime(message.at)}
                  {message.action === "draft" && message.created > 0
                    ? ` · queued ${message.created}`
                    : ""}
                </p>
              </div>
            );
          })}

          {sending ? <p className="text-sm text-muted-foreground">{botName} is writing…</p> : null}
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
              placeholder={`Message ${botName}. Ask for drafts or ask what the brand allows.`}
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
            Drafting only. Nothing is posted, and publishing stays disabled.{" "}
            {accountConnected
              ? `Rehearsals would resolve to ${accountLabel}.`
              : `${accountLabel} is not connected, so no payload can be produced for it.`}
          </p>
        </div>
      </div>
    </section>
  );
}
