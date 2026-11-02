import { Badge, Button, Input, Textarea } from "@rakazo/ui-web";
import { ArrowUpRight, Check, MessageSquare, Pencil, Repeat2, ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import type { ApprovalItem } from "./api";
import { ChannelLabel, canEdit, cx, draftLabel, LanguageTag, StatusPill } from "./status";

interface DraftCardProps {
  item: ApprovalItem | null;
  number: number | undefined;
  /** Used only when the queue has not loaded the record yet, so the thread never shows a gap. */
  fallbackBody: string;
  authorName: string;
  accountLabel: string;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onSave: (id: string, body: string) => void;
  onOpen: (id: string) => void;
}

const FOLD_LINES = 3;

/**
 * The draft as an artifact inside the conversation: a preview the owner can act on without
 * leaving the thread. Approve, Edit, Reject and Open all call the same endpoints the queue does.
 */
export function DraftCard({
  item,
  number,
  fallbackBody,
  authorName,
  accountLabel,
  busy,
  onApprove,
  onReject,
  onSave,
  onOpen,
}: DraftCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [text, setText] = useState(item?.body ?? fallbackBody);
  const [reason, setReason] = useState("");

  const body = item?.body ?? fallbackBody;
  const status = item?.status ?? "pending";
  const chars = body.trim().length;
  const editable = item ? canEdit(item.status) : false;

  return (
    <article
      aria-label="Draft"
      className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
        <span className="text-merrit-caption font-medium">{draftLabel(number)}</span>
        <StatusPill status={status} />
        {item ? (
          <>
            <ChannelLabel channel={item.channel} />
            <LanguageTag language={item.language} />
          </>
        ) : null}
        <span className="ml-auto text-merrit-footnote text-muted-foreground tabular-nums">
          {chars} characters
        </span>
      </header>

      {editing ? (
        <div className="p-3">
          <Textarea
            aria-label="Edit draft"
            value={text}
            onChange={(event) => setText(event.target.value)}
            dir={item?.language === "ar" ? "rtl" : "ltr"}
            className="min-h-40 text-merrit-body leading-relaxed"
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-merrit-footnote text-muted-foreground tabular-nums">
              {text.trim().length} characters
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={busy || !item || text.trim() === body.trim()}
              onClick={() => {
                if (item) onSave(item.id, text.trim());
                setEditing(false);
              }}
            >
              Save changes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3">
          {/* A light LinkedIn frame: the work is judged the way it will be read. */}
          <div className="rounded-lg border border-border bg-background">
            <div className="flex items-center gap-2 px-3 pt-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-merrit-footnote font-semibold">
                {authorName.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-merrit-caption font-medium">{authorName}</span>
                <span className="block truncate text-merrit-footnote text-muted-foreground">
                  {accountLabel} · now
                </span>
              </span>
              <Badge variant="outline" className="ml-auto text-merrit-footnote">
                LinkedIn
              </Badge>
            </div>

            <div className="relative px-3 pt-2 pb-1">
              <p
                className={cx(
                  "text-merrit-body whitespace-pre-wrap",
                  expanded ? "" : "line-clamp-[3]",
                )}
                style={expanded ? undefined : { WebkitLineClamp: FOLD_LINES }}
              >
                {body}
              </p>
              {!expanded ? (
                <p className="mt-1 text-merrit-caption text-muted-foreground">…see more</p>
              ) : null}
            </div>

            <div className="flex items-center gap-4 border-t border-border/60 px-3 py-2 text-merrit-footnote text-muted-foreground">
              <span className="flex items-center gap-1">
                <ThumbsUp className="size-3.5" /> Like
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="size-3.5" /> Comment
              </span>
              <span className="flex items-center gap-1">
                <Repeat2 className="size-3.5" /> Repost
              </span>
              <span className="ml-auto">Preview</span>
            </div>
          </div>

          <Button
            size="xs"
            variant="link"
            className="mt-1 px-0 text-merrit-footnote"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show the fold" : "Show the full post"}
          </Button>
        </div>
      )}

      {rejecting ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Input
            aria-label="Why send it back"
            placeholder="Why send it back? This drives the rewrite."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="h-8 text-merrit-caption"
          />
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={busy || !item || reason.trim().length < 3}
            onClick={() => {
              if (item) onReject(item.id, reason.trim());
              setRejecting(false);
              setReason("");
            }}
          >
            Send back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <footer className="flex items-center gap-1.5 border-t border-border px-3 py-2">
          <Button
            size="sm"
            disabled={busy || status !== "pending"}
            onClick={() => item && onApprove(item.id)}
          >
            <Check className="size-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !editable || editing}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={busy || status !== "pending"}
            onClick={() => setRejecting(true)}
          >
            <X className="size-3.5" />
            Reject
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => item && onOpen(item.id)}
          >
            Open
            <ArrowUpRight className="size-3.5" />
          </Button>
        </footer>
      )}
    </article>
  );
}
