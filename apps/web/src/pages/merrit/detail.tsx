import { Badge, Button, Disclosure, Input, ScrollArea, Separator, Textarea } from "@rakazo/ui-web";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, History, Pencil, PlayCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ApprovalItem, DryRunPayload, ItemEvent, Violation } from "./api";
import { merritApi } from "./api";
import {
  ChannelLabel,
  canDryRun,
  canEdit,
  cx,
  draftLabel,
  LanguageTag,
  StatusPill,
} from "./status";

interface DetailProps {
  item: ApprovalItem | null;
  events: ItemEvent[];
  number: number | undefined;
  loading: boolean;
  onChanged: () => void;
  /** The account a test send would resolve. Permission decides availability, not connectivity. */
  account: {
    id: string;
    label: string;
    permission: "granted" | "blocked";
    connected: boolean;
    memberUrn: string;
    reason: string;
  } | null;
  rejectOpen: boolean;
  onRejectOpen: (open: boolean) => void;
}

function GuardList({
  title,
  tone,
  violations,
}: {
  title: string;
  tone: "warning" | "destructive";
  violations: Violation[];
}) {
  if (violations.length === 0) return null;
  return (
    <div
      className={cx(
        "rounded-md border px-3 py-2 text-merrit-caption",
        tone === "warning"
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-3.5" />
        {title}
      </p>
      <ul className="mt-1 space-y-0.5 pl-4">
        {violations.map((violation) => (
          <li key={`${violation.rule}:${violation.detail}`} className="list-disc">
            {violation.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Right panel: the draft as it will be read, the guards, the decision, and a test send. */
export function ItemDetail({
  item,
  events,
  number,
  loading,
  onChanged,
  account,
  rejectOpen,
  onRejectOpen,
}: DetailProps) {
  const [draft, setDraft] = useState(item?.body ?? "");
  const [reason, setReason] = useState("");
  const [payload, setPayload] = useState<DryRunPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [brandViolations, setBrandViolations] = useState<Violation[]>([]);
  const [commercialViolations, setCommercialViolations] = useState<Violation[]>([]);
  const reasonRef = useRef<HTMLInputElement | null>(null);

  const itemId = item?.id ?? null;
  const client = item?.client ?? "";
  const language = item?.language ?? "en";
  const status = item?.status ?? "pending";

  // The body follows the record when it changes on the server, but a refetch that returns the
  // same text must not clobber what the owner is typing.
  useEffect(() => {
    setDraft(item?.body ?? "");
  }, [item?.id, item?.body]);

  // Notices and previews belong to one draft and one visit, so they clear only when the selection
  // changes, not when a mutation refetches the item.
  useEffect(() => {
    setReason("");
    setPayload(null);
    setNotice(null);
    setMode("preview");
  }, [item?.id]);

  useEffect(() => {
    if (rejectOpen && typeof reasonRef.current?.focus === "function") reasonRef.current.focus();
  }, [rejectOpen]);

  // Guards run on the text as it is being edited, not only at generation time, so a manual edit
  // cannot quietly introduce a banned phrase or an invented price.
  useEffect(() => {
    if (!itemId || !canEdit(status)) {
      setBrandViolations([]);
      setCommercialViolations([]);
      return;
    }
    const handle = setTimeout(() => {
      merritApi
        .check(client, language, draft)
        .then((result) => {
          setBrandViolations(result.brandViolations);
          setCommercialViolations(result.commercialViolations);
        })
        .catch(() => {
          setBrandViolations([]);
          setCommercialViolations([]);
        });
    }, 450);
    return () => clearTimeout(handle);
  }, [itemId, client, language, draft, status]);

  const approve = useMutation({
    mutationFn: (id: string) => merritApi.approve(id),
    onSuccess: () => {
      setNotice("Approved. Nothing sends in beta; the next step is a test send.");
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) => merritApi.reject(input.id, input.reason),
    onSuccess: (result) => {
      setNotice(
        result.replacement
          ? "Sent back, and a new draft was written from that reason."
          : `Sent back. ${result.error ?? ""}`,
      );
      onRejectOpen(false);
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const save = useMutation({
    mutationFn: (input: { id: string; body: string }) => merritApi.saveBody(input.id, input.body),
    onSuccess: () => {
      setNotice("Saved.");
      setMode("preview");
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const dryRun = useMutation({
    mutationFn: (id: string) => merritApi.dryRun(id, account?.id ?? ""),
    onSuccess: (result) => {
      setPayload(result.payload);
      setNotice("Test send ready. Nothing was sent to LinkedIn.");
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  if (!item) {
    return (
      <aside
        aria-label="Draft detail"
        className="hidden w-full shrink-0 items-center justify-center border-l border-border bg-card p-6 md:flex md:w-[520px]"
      >
        <p className="text-merrit-secondary text-muted-foreground">
          {loading ? "Loading draft…" : "Pick a draft to review it."}
        </p>
      </aside>
    );
  }

  const dirty = draft.trim() !== item.body.trim();
  const busy = approve.isPending || reject.isPending || save.isPending || dryRun.isPending;
  const blockedCopy =
    account?.permission !== "granted"
      ? (account?.reason ?? "No account in this brand may post.")
      : !account.connected
        ? `${account.label} is not connected.`
        : null;

  return (
    <aside
      aria-label="Draft detail"
      className="flex min-h-0 w-full shrink-0 flex-col border-l border-border bg-card md:w-[520px]"
    >
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-merrit-footnote text-faint-foreground">{draftLabel(number)}</span>
          <StatusPill status={item.status} />
          <span className="ml-auto flex items-center gap-1.5 text-merrit-footnote text-muted-foreground">
            <ChannelLabel channel={item.channel} />
            <span>·</span>
            <LanguageTag language={item.language} />
            <span>·</span>
            <span>{formatRelativeTime(item.created_at)}</span>
          </span>
        </div>
        <h2
          dir="auto"
          className="mt-1 line-clamp-2 text-merrit-headline font-semibold tracking-tight"
        >
          {item.angle}
        </h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {item.review_reason ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-merrit-caption text-warning">
              Needs a look: {item.review_reason}
            </p>
          ) : null}

          {/* Warnings sit above the text, so the owner reads them before the draft. */}
          <GuardList title="Brand rules" tone="destructive" violations={brandViolations} />
          <GuardList
            title="Price and promise guard"
            tone="warning"
            violations={commercialViolations}
          />

          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant={mode === "preview" ? "secondary" : "ghost"}
              onClick={() => setMode("preview")}
            >
              Preview
            </Button>
            <Button
              size="xs"
              variant={mode === "edit" ? "secondary" : "ghost"}
              disabled={!canEdit(item.status)}
              onClick={() => setMode("edit")}
            >
              <Pencil className="size-3" />
              Edit
            </Button>
            <span className="ml-auto text-merrit-footnote text-faint-foreground tabular-nums">
              {draft.trim().length} characters
            </span>
          </div>

          {mode === "preview" ? (
            <div className="rounded-lg border border-border bg-background">
              <div className="flex items-center gap-2 px-3 pt-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-merrit-footnote font-semibold">
                  {item.client.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-merrit-caption font-medium">
                    {account?.label ?? item.client}
                  </span>
                  <span className="block text-merrit-footnote text-muted-foreground">now</span>
                </span>
                <Badge variant="outline" className="ml-auto text-merrit-footnote">
                  LinkedIn
                </Badge>
              </div>
              <p
                dir={item.language === "ar" ? "rtl" : "ltr"}
                className="line-clamp-[3] px-3 pt-2 pb-1 text-merrit-body whitespace-pre-wrap"
              >
                {draft}
              </p>
              <p className="px-3 pb-2 text-merrit-caption text-muted-foreground">…see more</p>
            </div>
          ) : (
            <>
              <Textarea
                aria-label="Draft body"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                dir={item.language === "ar" ? "rtl" : "ltr"}
                readOnly={!canEdit(item.status)}
                className="min-h-64 text-merrit-body leading-relaxed"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!dirty}
                  onClick={() => setDraft(item.body)}
                >
                  Revert
                </Button>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={!dirty || busy || !canEdit(item.status)}
                  onClick={() => save.mutate({ id: item.id, body: draft })}
                >
                  Save changes
                </Button>
              </div>
            </>
          )}

          <Disclosure summary={<span className="text-merrit-caption">Test send</span>}>
            <div className="mt-2 space-y-2">
              <p className="text-merrit-caption text-muted-foreground">
                Shows exactly what would be sent and to whom. Nothing leaves the machine.
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !canDryRun(item.status) || account?.permission !== "granted"}
                onClick={() => dryRun.mutate(item.id)}
              >
                <PlayCircle className="size-3.5" />
                Show the preview
              </Button>
              {!canDryRun(item.status) ? (
                <p className="text-merrit-footnote text-faint-foreground">
                  Approve the draft first.
                </p>
              ) : null}

              {payload ? (
                <div className="rounded-md border border-status-working/40 bg-status-working/10 p-3">
                  <p className="text-merrit-caption font-medium text-status-working">
                    What would be sent
                  </p>
                  <dl className="mt-2 space-y-1 text-merrit-footnote text-muted-foreground">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0">To</dt>
                      <dd className="break-all font-mono">{payload.wouldPostTo}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0">Account</dt>
                      <dd>{payload.accountLabel}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0">Author</dt>
                      <dd className="break-all font-mono">{payload.authorUrn}</dd>
                    </div>
                  </dl>
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-background/60 p-2 font-sans text-merrit-footnote whitespace-pre-wrap">
                    {payload.body}
                  </pre>
                </div>
              ) : null}
            </div>
          </Disclosure>

          <Disclosure summary={<span className="text-merrit-caption">History</span>}>
            <ul className="mt-2 space-y-1.5">
              {events.map((event) => (
                <li key={event.id} className="flex gap-2 text-merrit-footnote">
                  <span className="w-20 shrink-0 text-faint-foreground">
                    {formatRelativeTime(event.at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{event.action.replace(/_/g, " ")}</span>
                    {event.detail ? (
                      <span className="block truncate text-muted-foreground">{event.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
              {events.length === 0 ? (
                <li className="text-merrit-footnote text-muted-foreground">
                  Nothing recorded yet.
                </li>
              ) : null}
            </ul>
          </Disclosure>

          {notice ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-merrit-caption text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </div>
      </ScrollArea>

      {/* Sticky: the two decisions never sit below a long draft. */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        {rejectOpen ? (
          <div className="flex items-center gap-2">
            <Input
              ref={reasonRef}
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
              disabled={busy || reason.trim().length < 3}
              onClick={() => reject.mutate({ id: item.id, reason: reason.trim() })}
            >
              Send back
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onRejectOpen(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || item.status !== "pending"}
              onClick={() => approve.mutate(item.id)}
            >
              <Check className="size-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={busy || item.status !== "pending"}
              onClick={() => onRejectOpen(true)}
            >
              <X className="size-3.5" />
              Send back
            </Button>
            <p className="ml-auto flex items-center gap-1 text-merrit-footnote text-faint-foreground">
              <History className="size-3" />
              Preview only. Nothing sends in beta.
            </p>
          </div>
        )}

        {blockedCopy ? (
          <Disclosure
            summary={
              <span className="mt-2 block text-merrit-footnote text-warning">{blockedCopy}</span>
            }
            summaryClassName="text-merrit-footnote"
            className="mt-2"
          >
            <p className="mt-1 text-merrit-footnote text-muted-foreground">
              {account?.reason || blockedCopy} Nothing falls back to another account. A test send
              still names the author and shows the text.
            </p>
            <Separator className="my-2" />
            <p className="text-merrit-footnote text-faint-foreground">
              Connecting is off during the beta.
            </p>
          </Disclosure>
        ) : null}
      </div>
    </aside>
  );
}
