import { Button, NativeSelect, NativeSelectOption } from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Filters } from "./api";
import { merritApi, merritKeys } from "./api";
import { BrandRail } from "./brand-rail";
import { ItemDetail } from "./detail";
import { Queue } from "./queue";

/**
 * Merrit, the marketing operator, inside the shell.
 *
 * Mounted at /merrit outside the auth and billing gates because both are out of scope for this
 * build and SubscriptionGate would paywall the page. It reuses the shell's primitives and tokens,
 * not its auth. Local only: close this route before the app is hosted anywhere.
 */
export function MerritPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    client: "",
    status: "all",
    channel: "all",
    language: "all",
    q: "",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [count, setCount] = useState(3);

  const clients = useQuery({ queryKey: merritKeys.clients, queryFn: merritApi.clients });
  const firstSlug = clients.data?.[0]?.slug ?? "";
  const activeClient = filters.client || firstSlug;

  useEffect(() => {
    if (!filters.client && firstSlug) setFilters((current) => ({ ...current, client: firstSlug }));
  }, [firstSlug, filters.client]);

  const items = useQuery({
    queryKey: merritKeys.items(filters),
    queryFn: () => merritApi.items(filters),
    enabled: Boolean(filters.client),
  });

  const detail = useQuery({
    queryKey: merritKeys.item(selectedId),
    queryFn: () => merritApi.item(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const generate = useMutation({
    mutationFn: (input: { client: string; count: number }) =>
      merritApi.generate(input.client, input.count),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merrit"] }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["merrit"] });
  const clientName =
    clients.data?.find((entry) => entry.slug === activeClient)?.name ?? activeClient;

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
            value={activeClient}
            onChange={(event) =>
              setFilters((current) => ({ ...current, client: event.target.value }))
            }
            className="h-8 w-48 text-xs"
          >
            {(clients.data ?? []).map((client) => (
              <NativeSelectOption key={client.slug} value={client.slug}>
                {client.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="Drafts per batch"
            value={String(count)}
            onChange={(event) => setCount(Number(event.target.value))}
            className="h-8 w-20 text-xs"
          >
            {[1, 3, 7].map((value) => (
              <NativeSelectOption key={value} value={String(value)}>
                {value}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <Button
            size="sm"
            disabled={generate.isPending || !activeClient}
            onClick={() => generate.mutate({ client: activeClient, count })}
          >
            <Sparkles className="size-3.5" />
            {generate.isPending ? "Generating…" : `Generate ${count}`}
          </Button>
        </div>
      </header>

      {/* Impossible to miss on purpose: no publish control exists, and this says so everywhere. */}
      <div
        className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-xs font-medium text-warning"
        role="status"
      >
        <ShieldAlert className="size-4 shrink-0" />
        Dry run only. Publishing is disabled in this build: the only action that produces a payload
        is a rehearsal, and it sends nothing to any platform.
      </div>

      <div className="flex min-h-0 flex-1">
        <BrandRail
          clients={clients.data ?? []}
          selected={activeClient}
          onSelect={(slug) => {
            setFilters((current) => ({ ...current, client: slug }));
            setSelectedId(null);
          }}
        />

        {clients.isError ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
            Cannot reach the operator API. Is it running on 3300? {String(clients.error)}
          </div>
        ) : (
          <>
            <Queue
              items={items.data ?? []}
              filters={{ ...filters, client: activeClient }}
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
            />
          </>
        )}
      </div>

      {generate.isError || generate.data?.failures.length ? (
        <footer className="shrink-0 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {generate.isError
            ? String(generate.error)
            : `Some drafts failed: ${generate.data?.failures.map((failure) => failure.angle).join(", ")}`}
        </footer>
      ) : null}

      {generate.isSuccess ? (
        <footer className="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Drafted {generate.data.created} for {clientName}
          {generate.data.flagged > 0 ? `, ${generate.data.flagged} flagged for review` : ""}.
        </footer>
      ) : null}
    </div>
  );
}
