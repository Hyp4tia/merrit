import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { Check, ChevronDown, Link2, Link2Off, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Account, ClientSummary } from "./api";
import { ConnectionDot, cx } from "./status";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

/** The brand the operator is working on. One custom picker, not a form select. */
export function BrandPicker({
  clients,
  activeSlug,
  onSelect,
}: {
  clients: ClientSummary[];
  activeSlug: string;
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = clients.find((entry) => entry.slug === activeSlug);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Brand"
        render={<Button variant="ghost" size="sm" className="h-9 gap-2 px-2" />}
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-accent text-merrit-footnote font-semibold">
          {initials(active?.name ?? "Merrit")}
        </span>
        <span className="text-merrit-caption font-medium">{active?.name ?? "Choose brand"}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {clients.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            onClick={() => {
              onSelect(entry.slug);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-accent text-merrit-footnote font-semibold">
              {initials(entry.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-merrit-caption">{entry.name}</span>
              <span className="block text-merrit-footnote text-muted-foreground">
                {entry.needsReview} waiting
              </span>
            </span>
            {entry.slug === activeSlug ? <Check className="size-3.5 text-success" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The posting identity. Status is derived on the server from token presence, so this picker only
 * reports what it was told. Connecting is switched off in the beta and the picker says so instead
 * of offering a flow that would not work.
 */
export function AccountPicker({
  accounts,
  activeId,
  onSelect,
}: {
  accounts: Account[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [explain, setExplain] = useState(false);
  const active = accounts.find((entry) => entry.id === activeId) ?? accounts[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Account"
        aria-describedby={active?.connected ? undefined : "account-state"}
        render={<Button variant="ghost" size="sm" className="h-9 gap-2 px-2" />}
      >
        <ConnectionDot connected={Boolean(active?.connected)} />
        <span className="text-merrit-caption">
          {active?.connected ? active.label : `${active?.label ?? "No account"} · not connected`}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        {accounts.map((entry) => {
          const blocked = entry.permission === "blocked";
          return (
            <div
              key={entry.id}
              className={cx(
                "rounded-md px-2 py-2",
                entry.id === active?.id ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(entry.id);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 text-left"
              >
                <span className="mt-0.5 flex size-6 items-center justify-center rounded-full bg-muted text-merrit-footnote font-semibold">
                  {initials(entry.label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-merrit-caption font-medium">{entry.label}</span>
                    <Badge variant="secondary" className="text-merrit-footnote">
                      {entry.kind === "person" ? "Profile" : "Page"}
                    </Badge>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-merrit-footnote text-muted-foreground">
                    <ConnectionDot connected={entry.connected} />
                    {entry.connected ? "Connected" : "Not connected"}
                    {blocked ? " · needs page approval" : ""}
                  </span>
                  {!entry.connected && entry.reason ? (
                    <span className="mt-1 block text-merrit-footnote text-faint-foreground">
                      {entry.reason}
                    </span>
                  ) : null}
                </span>
                {entry.id === active?.id ? (
                  <Check className="mt-1 size-3.5 shrink-0 text-success" />
                ) : null}
              </button>

              {entry.connected ? null : (
                <div className="mt-1.5 flex items-center gap-2 pl-8">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setExplain(true)}
                    className="gap-1"
                  >
                    {blocked ? <Link2Off className="size-3" /> : <Link2 className="size-3" />}
                    Connect
                  </Button>
                  {explain ? (
                    <span className="text-merrit-footnote text-faint-foreground">
                      Connecting is off during the beta. Nothing sends until it is on.
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}

        {active && !active.connected ? (
          <p
            id="account-state"
            className="mt-1 flex items-start gap-1.5 border-t border-border px-2 py-2 text-merrit-footnote text-muted-foreground"
          >
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            Nothing falls back to another account. A test send still shows the preview and names the
            author.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
