import { Badge, ScrollArea } from "@rakazo/ui-web";
import type { ClientSummary } from "./api";
import { cx } from "./status";

interface BrandRailProps {
  clients: ClientSummary[];
  selected: string;
  onSelect: (slug: string) => void;
}

/** Left rail: every brand in the registry, its review load, and the switch. */
export function BrandRail({ clients, selected, onSelect }: BrandRailProps) {
  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      aria-label="Brands"
    >
      <p className="px-4 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Brands
      </p>
      <ScrollArea className="flex-1">
        <ul className="px-2 pb-4">
          {clients.map((client) => {
            const active = client.slug === selected;
            return (
              <li key={client.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(client.slug)}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/60",
                  )}
                >
                  <span
                    className={cx(
                      "size-2 shrink-0 rounded-full",
                      client.needsReview > 0 ? "bg-warning" : "bg-success",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{client.name}</span>
                  {client.needsReview > 0 ? (
                    <Badge variant="secondary" className="tabular-nums">
                      {client.needsReview}
                    </Badge>
                  ) : null}
                </button>
                {active && client.note ? (
                  <p className="pr-2 pb-2 pl-6 text-xs leading-snug text-faint-foreground">
                    {client.note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </aside>
  );
}
