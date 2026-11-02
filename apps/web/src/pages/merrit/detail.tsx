import { Button, Input, ScrollArea, Separator, Textarea } from "@rakazo/ui-web";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, History, PlayCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import type { ApprovalItem, DryRunPayload, ItemEvent, Violation } from "./api";
import { merritApi } from "./api";
import { CHANNEL_LABEL, canDryRun, canEdit, cx, LanguageChip, StatusChip } from "./status";

interface DetailProps {
  item: ApprovalItem | null;
  events: ItemEvent[];
  loading: boolean;
  onChanged: () => void;
  /** The account the dry run would resolve. Permission decides availability, not connectivity. */
  account: {
    id: string;
    label: string;
    permission: "granted" | "blocked";
    connected: boolean;
    memberUrn: string;
    reason: string;
  } | null;
}

function ViolationList({
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
        "rounded-md border px-3 py-2 text-xs",
        tone === "warning"
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-3.5" />
        {title} ({violations.length})
      </p>
      <ul className="mt-1 space-y-0.5 pl-5">
        {violations.map((violation) => (
          <li key={`${violation.rule}:${violation.detail}`} className="list-disc">
            <span className="font-medium">{violation.rule}</span>: {violation.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Right panel: the draft, the guards, the two human decisions, and a dry run. */
export function ItemDetail({ item, events, loading, onChanged, account }: DetailProps) {
  const [draft, setDraft] = useState(item?.body ?? "");
  const [reason, setReason] = useState("");
  const [payload, setPayload] = useState<DryRunPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [brandViolations, setBrandViolations] = useState<Violation[]>([]);
  const [commercialViolations, setCommercialViolations] = useState<Violation[]>([]);
  const payloadRef = useRef<HTMLDivElement | null>(null);

  const itemId = item?.id ?? null;
  const client = item?.client ?? "";
  const language = item?.language ?? "en";
  const status = item?.status ?? "pending";

  // The body follows the record when it changes on the server, but a refetch that returns the
  // same text must not clobber what the owner is typing.
  useEffect(() => {
    setDraft(item?.body ?? "");
  }, [item?.id, item?.body]);

  // Notices and payloads belong to one draft and one visit, so they clear only when the
  // selection changes, not when a mutation refetches the item.
  useEffect(() => {
    setReason("");
    setPayload(null);
    setNotice(null);
  }, [item?.id]);

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
      setNotice("Approved. Publishing stays disabled in this build; the next step is a dry run.");
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) => merritApi.reject(input.id, input.reason),
    onSuccess: (result) => {
      setNotice(
        result.replacement
          ? "Rejected, and a replacement draft was written from that reason."
          : `Rejected. ${result.error ?? ""}`,
      );
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const save = useMutation({
    mutationFn: (input: { id: string; body: string }) => merritApi.saveBody(input.id, input.body),
    onSuccess: () => {
      setNotice("Saved.");
      onChanged();
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const dryRun = useMutation({
    mutationFn: (id: string) => merritApi.dryRun(id, account?.id ?? ""),
    onSuccess: (result) => {
      setPayload(result.payload);
      setNotice("Dry run complete. Nothing was sent to LinkedIn.");
      onChanged();
      // The payload is the point of the action, so bring it into view instead of leaving it
      // under a long body editor.
      requestAnimationFrame(() => {
        const node = payloadRef.current;
        // jsdom has no scrollIntoView, and a missing scroll is not worth failing a render over.
        if (node && typeof node.scrollIntoView === "function")
          node.scrollIntoView({ block: "nearest" });
      });
    },
    onError: (error: Error) => setNotice(error.message),
  });

  if (!item) {
    return (
      <aside
        aria-label="Draft detail"
        className="flex w-[440px] shrink-0 items-center justify-center border-l border-border bg-card p-6"
      >
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading draft…" : "Select a draft to review it."}
        </p>
      </aside>
    );
  }

  const dirty = draft.trim() !== item.body.trim();
  const busy = approve.isPending || reject.isPending || save.isPending || dryRun.isPending;

  return (
    <aside
      aria-label="Draft detail"
      className="flex w-[440px] shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.angle}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <LanguageChip language={item.language} />
            <span>{CHANNEL_LABEL[item.channel] ?? item.channel}</span>
            <span>·</span>
            <span>{formatRelativeTime(item.created_at)}</span>
          </p>
        </div>
        <StatusChip status={item.status} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {item.review_reason ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Flagged for review: {item.review_reason}
            </div>
          ) : null}

          <Textarea
            aria-label="Draft body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            dir={item.language === "ar" ? "rtl" : "ltr"}
            readOnly={!canEdit(item.status)}
            className="min-h-56 text-sm leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {draft.trim().length} characters
            </span>
            <span className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || busy}
                onClick={() => setDraft(item.body)}
              >
                Revert
              </Button>
              <Button
                size="sm"
                disabled={!dirty || busy || !canEdit(item.status)}
                onClick={() => save.mutate({ id: item.id, body: draft })}
              >
                Save draft
              </Button>
            </span>
          </div>

          <Separator />

          <ViolationList
            title="Brand rule warnings"
            tone="destructive"
            violations={brandViolations}
          />
          <ViolationList
            title="Commercial guard warnings"
            tone="warning"
            violations={commercialViolations}
          />
          {brandViolations.length === 0 && commercialViolations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Both guards pass on this text. Nothing invented, nothing banned.
            </p>
          ) : null}

          <Separator />

          <div className="space-y-2">
            {item.status === "pending" ? (
              <>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => approve.mutate(item.id)}
                  >
                    <Check className="size-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => reject.mutate({ id: item.id, reason: reason.trim() })}
                  >
                    <X className="size-3.5" />
                    Reject
                  </Button>
                </div>
                <Input
                  aria-label="Rejection reason"
                  placeholder="Reason for rejection, required, drives the rewrite"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="h-8 text-xs"
                />
              </>
            ) : null}

            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={busy || !canDryRun(item.status) || account?.permission !== "granted"}
              title={
                account?.permission !== "granted"
                  ? (account?.reason ?? "No account in this brand may post.")
                  : canDryRun(item.status)
                    ? "Show the exact payload without sending it"
                    : "Approve the draft before rehearsing a publish"
              }
              onClick={() => dryRun.mutate(item.id)}
            >
              <PlayCircle className="size-3.5" />
              Dry run, show payload
            </Button>
            <p className="text-xs text-faint-foreground">
              {account?.permission !== "granted"
                ? (account?.reason ?? "No account in this brand may post.")
                : account.connected || account.memberUrn
                  ? `Publishing is disabled in this build. A dry run names ${account.label} as the author and never contacts LinkedIn.`
                  : `A dry run will show the exact payload with the author unresolved: ${account.reason}`}
            </p>
          </div>

          {payload ? (
            <div
              ref={payloadRef}
              className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs"
            >
              <p className="font-medium text-warning">Payload that would be sent</p>
              <dl className="mt-2 space-y-1 text-muted-foreground">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0">POST to</dt>
                  <dd className="break-all font-mono">{payload.wouldPostTo}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0">account</dt>
                  <dd>
                    {payload.accountLabel} ({payload.accountId})
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0">author</dt>
                  <dd className="break-all font-mono">{payload.authorUrn}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0">channel</dt>
                  <dd>
                    {CHANNEL_LABEL[payload.channel] ?? payload.channel} ({payload.language})
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0">kit</dt>
                  <dd className="break-all font-mono">{payload.kitPath}</dd>
                </div>
              </dl>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-background/60 p-2 font-sans whitespace-pre-wrap">
                {payload.body}
              </pre>
            </div>
          ) : null}

          {notice ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <Separator />

          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <History className="size-3.5" />
              History
            </p>
            <ul className="mt-2 space-y-1.5">
              {events.map((event) => (
                <li key={event.id} className="flex gap-2 text-xs">
                  <span className="w-24 shrink-0 text-faint-foreground">
                    {formatRelativeTime(event.at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{event.action}</span>
                    {event.detail ? (
                      <span className="block truncate text-muted-foreground">{event.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
              {events.length === 0 ? (
                <li className="text-xs text-muted-foreground">No transitions recorded yet.</li>
              ) : null}
            </ul>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
