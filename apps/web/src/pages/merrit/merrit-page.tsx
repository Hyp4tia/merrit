import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Filters } from "./api";
import { merritApi, merritKeys } from "./api";
import { BotSidebar } from "./bot-sidebar";
import { ChatView } from "./chat-view";
import { ItemDetail } from "./detail";
import { AccountPicker, BrandPicker } from "./identities";
import { Queue } from "./queue";
import { cx } from "./status";

/**
 * Merrit, the marketing operator, inside the shell.
 *
 * Chat is the home: the roster on the left, the conversation in the centre, and the draft as an
 * artifact you can approve where it was written. Drafts and their detail are one click away and
 * nothing publishes: this is a preview-only beta.
 *
 * Mounted at /merrit outside the auth and billing gates because both are out of scope for this
 * build and SubscriptionGate would paywall the page. Local only: close this route before hosting.
 */
export function MerritPage() {
  const queryClient = useQueryClient();
  const [clientSlug, setClientSlug] = useState("");
  const [accountId, setAccountId] = useState("");
  const [botId, setBotId] = useState("");
  const [view, setView] = useState<"chat" | "queue">("chat");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    client: "",
    status: "all",
    channel: "all",
    language: "all",
    q: "",
  });

  const clients = useQuery({ queryKey: merritKeys.clients, queryFn: merritApi.clients });

  const client = clients.data?.find((entry) => entry.slug === clientSlug) ?? clients.data?.[0];
  const activeSlug = client?.slug ?? "";
  const accounts = client?.accounts ?? [];
  const account = accounts.find((entry) => entry.id === accountId) ?? accounts[0] ?? null;
  const activeBots = (client?.bots ?? []).filter((entry) => entry.active);
  const bot = activeBots.find((entry) => entry.id === botId) ?? activeBots[0] ?? null;
  const botName = (id: string) => client?.bots.find((entry) => entry.id === id)?.name ?? id;

  const threads = useQuery({
    queryKey: merritKeys.threads(activeSlug),
    queryFn: () => merritApi.threads(activeSlug),
    enabled: Boolean(activeSlug),
  });

  const thread = useQuery({
    queryKey: merritKeys.thread(activeSlug, bot?.id ?? ""),
    queryFn: () => merritApi.thread(activeSlug, bot?.id ?? ""),
    enabled: Boolean(activeSlug && bot),
  });

  // One unfiltered query feeds the queue, the counters and the draft cards in chat, so the three
  // can never disagree about how many drafts there are. Filtering happens below, in memory, so a
  // draft keeps the same number whichever filter is on.
  const allFilters: Filters = {
    client: activeSlug,
    status: "all",
    channel: "all",
    language: "all",
    q: "",
  };
  const items = useQuery({
    queryKey: merritKeys.items(allFilters),
    queryFn: () => merritApi.items(allFilters),
    enabled: Boolean(activeSlug),
  });

  const detail = useQuery({
    queryKey: merritKeys.item(selectedId),
    queryFn: () => merritApi.item(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const allItems = useMemo(() => items.data ?? [], [items.data]);

  const visibleItems = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    return allItems
      .filter(
        (item) =>
          (filters.status === "all" || item.status === filters.status) &&
          (filters.channel === "all" || item.channel === filters.channel) &&
          (filters.language === "all" || item.language === filters.language) &&
          (needle === "" || `${item.angle} ${item.body}`.toLowerCase().includes(needle)),
      )
      .sort((left, right) => {
        // Work waiting for a decision first, then the rest newest first.
        const rank = (status: string) => (status === "pending" ? 0 : 1);
        const byRank = rank(left.status) - rank(right.status);
        return byRank !== 0 ? byRank : right.created_at.localeCompare(left.created_at);
      });
  }, [allItems, filters]);

  // "Draft #12" has to mean one thing across the chat, the queue and the detail.
  const draftNumbers = useMemo(() => {
    const ordered = [...allItems].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
    return new Map(ordered.map((item, index) => [item.id, index + 1]));
  }, [allItems]);

  const itemsById = useMemo(() => new Map(allItems.map((item) => [item.id, item])), [allItems]);

  // The detail pane is never empty: the first draft waiting for a decision is selected on load.
  useEffect(() => {
    if (selectedId || visibleItems.length === 0) return;
    setSelectedId(visibleItems[0]?.id ?? null);
  }, [visibleItems, selectedId]);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["merrit"] }),
    [queryClient],
  );

  const send = useMutation({
    mutationFn: (message: string) => merritApi.postMessage(activeSlug, bot?.id ?? "", message),
    onSuccess: () => refresh(),
    onError: () => refresh(),
  });

  const approve = useMutation({
    mutationFn: (id: string) => merritApi.approve(id),
    onSuccess: () => refresh(),
    onError: () => refresh(),
  });

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) => merritApi.reject(input.id, input.reason),
    onSuccess: () => refresh(),
    onError: () => refresh(),
  });

  const save = useMutation({
    mutationFn: (input: { id: string; body: string }) => merritApi.saveBody(input.id, input.body),
    onSuccess: () => refresh(),
    onError: () => refresh(),
  });

  const openItem = (id: string) => {
    setSelectedId(id);
    setView("queue");
  };

  // J/K move, A approves, R sends back, Enter opens the selected draft. Typing in a field wins.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      const index = visibleItems.findIndex((item) => item.id === selectedId);
      const move = (delta: number) => {
        if (visibleItems.length === 0) return;
        const next = Math.min(Math.max(index + delta, 0), visibleItems.length - 1);
        setSelectedId(visibleItems[next]?.id ?? null);
        setView("queue");
      };

      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        move(index === -1 ? 0 : 1);
      } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        move(index === -1 ? 0 : -1);
      } else if (event.key === "Enter") {
        if (event.target instanceof HTMLElement && event.target.tagName === "BUTTON") return;
        event.preventDefault();
        setView("queue");
        if (selectedId) setRejectOpen(false);
      } else if ((event.key === "a" || event.key === "A") && selectedId) {
        const item = allItems.find((entry) => entry.id === selectedId);
        if (item?.status === "pending") {
          event.preventDefault();
          approve.mutate(selectedId);
        }
      } else if ((event.key === "r" || event.key === "R") && selectedId) {
        event.preventDefault();
        setView("queue");
        setRejectOpen(true);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allItems, visibleItems, selectedId, approve]);

  const waiting = allItems.filter((item) => item.status === "pending").length;
  const connected = Boolean(account?.connected);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-merrit-footnote font-bold text-primary-foreground">
          M
        </span>
        <div className="flex items-baseline gap-2">
          <span className="text-merrit-body font-semibold tracking-tight">Merrit</span>
          <span className="text-merrit-footnote text-muted-foreground">Marketing operator</span>
        </div>

        <div className="ml-4 flex items-center gap-1">
          <BrandPicker
            clients={clients.data ?? []}
            activeSlug={activeSlug}
            onSelect={(slug) => {
              setClientSlug(slug);
              setAccountId("");
              setBotId("");
              setSelectedId(null);
            }}
          />
          <AccountPicker accounts={accounts} activeId={account?.id ?? ""} onSelect={setAccountId} />
        </div>

        {/* One status line for the whole surface. */}
        <span
          role="status"
          className={cx(
            "ml-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-merrit-footnote",
            connected
              ? "border-border bg-muted text-muted-foreground"
              : "border-warning/50 bg-warning/10 text-warning",
          )}
        >
          {connected ? <ShieldCheck className="size-3" /> : <TriangleAlert className="size-3" />}
          {connected
            ? "Test mode · nothing sends"
            : `Preview only · ${account?.label ?? "no account"} not connected`}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <BotSidebar
          brandName={client?.name ?? "Merrit"}
          threads={threads.data ?? []}
          activeBotId={bot?.id ?? null}
          onSelectBot={setBotId}
          view={view}
          onView={setView}
          draftsWaiting={waiting}
          accountConnected={connected}
          accountLabel={account?.label ?? "No account"}
        />

        {clients.isError ? (
          <div className="flex flex-1 items-center justify-center p-6 text-merrit-secondary text-destructive">
            Cannot reach the operator. Is the local service running? {String(clients.error)}
          </div>
        ) : view === "chat" ? (
          <ChatView
            bot={bot}
            messages={thread.data?.messages ?? []}
            delegations={thread.data?.delegations ?? []}
            items={itemsById}
            draftNumbers={draftNumbers}
            authorName={client?.name ?? "Merrit"}
            accountLabel={account?.label ?? "No account"}
            loading={thread.isLoading}
            sending={send.isPending}
            busy={approve.isPending || reject.isPending || save.isPending}
            error={send.isError ? String(send.error) : null}
            onSend={(message) => send.mutate(message)}
            botName={botName}
            onApprove={(id) => approve.mutate(id)}
            onReject={(id, reason) => reject.mutate({ id, reason })}
            onSave={(id, body) => save.mutate({ id, body })}
            onOpenItem={openItem}
            onOpenDelegation={(delegation) => {
              const other = delegation.fromBot === bot?.id ? delegation.toBot : delegation.fromBot;
              setBotId(other);
              setView("chat");
            }}
          />
        ) : (
          <>
            <Queue
              items={visibleItems}
              filters={{ ...filters, client: activeSlug }}
              loading={items.isLoading}
              selectedId={selectedId}
              draftNumbers={draftNumbers}
              busy={approve.isPending}
              onFilters={setFilters}
              onSelect={(id) => {
                setSelectedId(id);
                setRejectOpen(false);
              }}
              onApprove={(id) => approve.mutate(id)}
              onSendBack={(id) => {
                setSelectedId(id);
                setRejectOpen(true);
              }}
            />
            <ItemDetail
              item={detail.data?.item ?? null}
              events={detail.data?.events ?? []}
              number={selectedId ? draftNumbers.get(selectedId) : undefined}
              loading={detail.isLoading}
              onChanged={refresh}
              rejectOpen={rejectOpen}
              onRejectOpen={setRejectOpen}
              account={
                account
                  ? {
                      id: account.id,
                      label: account.label,
                      permission: account.permission,
                      connected: account.connected,
                      memberUrn: account.member_urn,
                      reason: account.reason,
                    }
                  : null
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
