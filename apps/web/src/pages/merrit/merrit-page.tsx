import { NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Filters } from "./api";
import { merritApi, merritKeys } from "./api";
import { BotSidebar } from "./bot-sidebar";
import { ChatView } from "./chat-view";
import { ItemDetail } from "./detail";
import { Queue } from "./queue";

/**
 * Merrit, the marketing operator, inside the shell.
 *
 * The home surface is a chat with the brand's bot: left rail is the bot roster, the navbar holds
 * the brand and account, and the centre is the conversation. The review queue and the draft
 * detail stay one click away and never publish anything.
 *
 * Mounted at /merrit outside the auth and billing gates because both are out of scope for this
 * build and SubscriptionGate would paywall the page. It reuses the shell's primitives and tokens,
 * not its auth. Local only: close this route before the app is hosted anywhere.
 */
export function MerritPage() {
  const queryClient = useQueryClient();
  const [clientSlug, setClientSlug] = useState("");
  const [accountId, setAccountId] = useState("");
  const [botId, setBotId] = useState("");
  const [view, setView] = useState<"chat" | "queue">("chat");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const bot = client?.bots.find((entry) => entry.id === botId) ?? client?.bots[0] ?? null;

  const chat = useQuery({
    queryKey: merritKeys.chat(activeSlug, bot?.id ?? ""),
    queryFn: () => merritApi.chat(activeSlug, bot?.id ?? ""),
    enabled: Boolean(activeSlug && bot),
  });

  const items = useQuery({
    queryKey: merritKeys.items({ ...filters, client: activeSlug }),
    queryFn: () => merritApi.items({ ...filters, client: activeSlug }),
    enabled: view === "queue" && Boolean(activeSlug),
  });

  const detail = useQuery({
    queryKey: merritKeys.item(selectedId),
    queryFn: () => merritApi.item(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["merrit"] });

  const send = useMutation({
    mutationFn: (message: string) =>
      merritApi.sendChat({
        client: activeSlug,
        bot: bot?.id ?? "",
        account: account?.id ?? "",
        message,
      }),
    onSuccess: () => refresh(),
    onError: () => refresh(),
  });

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Merrit</span>
          <span className="text-xs text-muted-foreground">Content operator</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <NativeSelect
            aria-label="Brand"
            value={activeSlug}
            onChange={(event) => {
              setClientSlug(event.target.value);
              setAccountId("");
              setBotId("");
              setSelectedId(null);
            }}
            className="h-8 w-44 text-xs"
          >
            {(clients.data ?? []).map((entry) => (
              <NativeSelectOption key={entry.slug} value={entry.slug}>
                {entry.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="Account"
            value={account?.id ?? ""}
            onChange={(event) => setAccountId(event.target.value)}
            className="h-8 w-56 text-xs"
          >
            {accounts.map((entry) => (
              <NativeSelectOption key={entry.id} value={entry.id}>
                {entry.label}
                {entry.connected ? " · connected" : " · not connected"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </header>

      {/* Impossible to miss on purpose: no publish control exists anywhere in this build. */}
      <div
        className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-xs font-medium text-warning"
        role="status"
      >
        <ShieldAlert className="size-4 shrink-0" />
        Dry run only. Publishing is disabled in this build: the only action that produces a payload
        is a rehearsal, and it sends nothing to any platform.
      </div>

      {account && !account.connected ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {account.label} is not connected. {account.reason} Nothing will fall back to another
          account.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <BotSidebar
          brandName={client?.name ?? "Merrit"}
          bots={client?.bots ?? []}
          activeBotId={bot?.id ?? null}
          onSelectBot={setBotId}
          view={view}
          onView={setView}
          needsReview={client?.needsReview ?? 0}
          accountConnected={Boolean(account?.connected)}
        />

        {clients.isError ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
            Cannot reach the operator API. Is it running on 3300? {String(clients.error)}
          </div>
        ) : view === "chat" ? (
          <ChatView
            botName={bot?.name ?? "the bot"}
            messages={chat.data ?? []}
            loading={chat.isLoading}
            sending={send.isPending}
            error={send.isError ? String(send.error) : null}
            accountLabel={account?.label ?? "No account"}
            accountConnected={Boolean(account?.connected)}
            onSend={(message) => send.mutate(message)}
          />
        ) : (
          <>
            <Queue
              items={items.data ?? []}
              filters={{ ...filters, client: activeSlug }}
              loading={items.isLoading}
              selectedId={selectedId}
              onFilters={setFilters}
              onSelect={setSelectedId}
            />
            <ItemDetail
              item={detail.data?.item ?? null}
              events={detail.data?.events ?? []}
              loading={detail.isLoading}
              onChanged={refresh}
              account={
                account
                  ? {
                      id: account.id,
                      label: account.label,
                      connected: account.connected,
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
