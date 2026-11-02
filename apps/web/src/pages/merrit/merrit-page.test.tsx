// @vitest-environment jsdom

import type * as UiWeb from "@rakazo/ui-web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  clients: vi.fn(),
  items: vi.fn(),
  item: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  saveBody: vi.fn(),
  dryRun: vi.fn(),
  check: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("./api", () => ({
  merritApi: api,
  merritKeys: {
    clients: ["merrit", "clients"],
    items: (filters: unknown) => ["merrit", "items", filters],
    item: (id: string | null) => ["merrit", "item", id],
    check: (client: string, language: string, body: string) => [
      "merrit",
      "check",
      client,
      language,
      body,
    ],
  },
}));

vi.mock("../../lib/relative-time", () => ({ formatRelativeTime: () => "5m ago" }));

// The shell's primitives wrap base-ui and radix, which need real layout. The page is tested for
// wiring, so each primitive becomes its plain HTML equivalent.
vi.mock("@rakazo/ui-web", async (importOriginal) => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({ children, ...props }: ComponentProps<"button">) => (
      <button {...props}>{children}</button>
    ),
    ButtonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
    Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    NativeSelect: ({ children, ...props }: ComponentProps<"select">) => (
      <select {...props}>{children}</select>
    ),
    NativeSelectOption: (props: ComponentProps<"option">) => <option {...props} />,
    ScrollArea: Passthrough,
    Separator: () => <hr />,
    Skeleton: () => <div />,
  };
});

const { MerritPage } = await import("./merrit-page");

const KOT = "11111111-1111-1111-1111-111111111111";

const clients = [
  {
    slug: "kot",
    name: "Kōt Dynamics",
    file: "/b/kot.yaml",
    note: "Live brand.",
    counts: { pending: 1 },
    needsReview: 1,
  },
  {
    slug: "barq",
    name: "BARQ Auto Spa",
    file: "/b/barq.yaml",
    note: "Demo brand.",
    counts: { pending: 1 },
    needsReview: 1,
  },
];

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: KOT,
    client: "kot",
    channel: "linkedin_personal",
    language: "en" as const,
    angle: "A cheap site is a deferred bill",
    body: "A cheap site is not a cheaper site. It is a deferred bill, paid in pieces.",
    status: "pending",
    reject_reason: null,
    review_reason: null,
    model: "stub",
    attempts: 1,
    scheduled_for: null,
    published_url: null,
    platform_post_id: null,
    published_at: null,
    kit_path: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MerritPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  return container;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((button) =>
    (button.textContent ?? "").includes(text),
  );
  if (!match) throw new Error(`No button containing "${text}"`);
  return match;
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  api.clients.mockResolvedValue(clients);
  api.items.mockResolvedValue([item()]);
  api.item.mockResolvedValue({
    item: item(),
    events: [{ id: 1, action: "created", detail: "angle", at: new Date().toISOString() }],
  });
  api.check.mockResolvedValue({ brandViolations: [], commercialViolations: [] });
});

describe("Merrit page", () => {
  it("renders every brand with its review count and the live queue", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("Kōt Dynamics");
    expect(container.textContent).toContain("BARQ Auto Spa");
    expect(container.textContent).toContain("A cheap site is a deferred bill");
    expect(container.textContent).toContain("Dry run only");
    expect(api.items).toHaveBeenCalledWith(expect.objectContaining({ client: "kot" }));
  });

  it("offers no publish control at all", async () => {
    const container = await renderPage();
    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent ?? "",
    );
    expect(labels.some((label) => /publish/i.test(label))).toBe(false);
  });

  it("switches brand from the rail and refetches that brand's queue", async () => {
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "BARQ Auto Spa").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    expect(api.items).toHaveBeenLastCalledWith(expect.objectContaining({ client: "barq" }));
  });

  it("opens a draft and approves it", async () => {
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    expect(container.textContent).toContain("Both guards pass on this text");

    api.approve.mockResolvedValue(item({ status: "approved" }));
    await act(async () => {
      buttonByText(container, "Approve").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(api.approve).toHaveBeenCalledWith(KOT);
    expect(container.textContent).toContain("Approved. Publishing stays disabled");
  });

  it("requires a reason before rejecting, then sends it", async () => {
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    expect(buttonByText(container, "Reject").disabled).toBe(true);

    const reason = container.querySelector(
      'input[aria-label="Rejection reason"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(reason, "Reads like a headline");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    api.reject.mockResolvedValue({
      replacement: true,
      error: null,
      item: item({ status: "rejected" }),
    });
    await act(async () => {
      buttonByText(container, "Reject").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(api.reject).toHaveBeenCalledWith(KOT, "Reads like a headline");
    expect(container.textContent).toContain("replacement draft was written");
  });

  it("shows the dry-run payload and never a publish result", async () => {
    api.items.mockResolvedValue([item({ status: "approved" })]);
    api.item.mockResolvedValue({
      item: item({ status: "approved" }),
      events: [{ id: 2, action: "status:approved", detail: null, at: new Date().toISOString() }],
    });
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    api.dryRun.mockResolvedValue({
      kit: "/tmp/kit",
      item: item({ status: "dry_run" }),
      payload: {
        itemId: KOT,
        channel: "linkedin_personal",
        language: "en",
        body: "A cheap site is not a cheaper site.",
        authorUrn: "urn:li:person:TEST",
        kitPath: "/tmp/kit",
        wouldPostTo: "https://api.linkedin.com/rest/posts",
      },
    });

    await act(async () => {
      buttonByText(container, "Dry run, show payload").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    expect(api.dryRun).toHaveBeenCalledWith(KOT);
    expect(container.textContent).toContain("Payload that would be sent");
    expect(container.textContent).toContain("https://api.linkedin.com/rest/posts");
    expect(container.textContent).toContain("urn:li:person:TEST");
  });

  it("surfaces brand and commercial warnings on the draft", async () => {
    api.check.mockResolvedValue({
      brandViolations: [{ rule: "dashes", detail: "contains an em dash" }],
      commercialViolations: [
        { rule: "commercial-amount", detail: '"500" is not in the brand file' },
      ],
    });
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // The inline guard check is debounced by 450ms, so the test waits past the timer.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await flush();

    expect(container.textContent).toContain("Brand rule warnings");
    expect(container.textContent).toContain("Commercial guard warnings");
    expect(container.textContent).toContain("commercial-amount");
  });

  it("keeps the detail panel idle until a draft is chosen", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("Select a draft to review it");
    expect(api.item).not.toHaveBeenCalled();
  });

  it("generates a batch for the active brand", async () => {
    api.generate.mockResolvedValue({ created: 3, flagged: 0, failures: [] });
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "Generate").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(api.generate).toHaveBeenCalledWith("kot", 3);
    expect(container.textContent).toContain("Drafted 3 for Kōt Dynamics");
  });
});
