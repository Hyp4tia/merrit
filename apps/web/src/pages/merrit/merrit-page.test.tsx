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
  chat: vi.fn(),
  sendChat: vi.fn(),
}));

vi.mock("./api", () => ({
  merritApi: api,
  merritKeys: {
    clients: ["merrit", "clients"],
    chat: (client: string, bot: string) => ["merrit", "chat", client, bot],
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

vi.mock("@rakazo/ui-web", async (importOriginal) => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({ children, ...props }: ComponentProps<"button">) => (
      <button {...props}>{children}</button>
    ),
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
    buttonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
  };
});

const { MerritPage } = await import("./merrit-page");

const ITEM_ID = "11111111-1111-1111-1111-111111111111";

// Permission comes from the registry, connectivity from the server. Personal is permitted but has
// no token in this build, which is exactly the state the UI has to render honestly.
const PERSON = {
  id: "kot-personal",
  label: "Personal",
  kind: "person" as const,
  permission: "granted" as const,
  member_urn: "urn:li:person:TESTURN",
  note: "",
  connected: false,
  reason: "No LinkedIn token on file. Authorize the account before it can post.",
};
const PAGE = {
  id: "kot-page",
  label: "Kōt page",
  kind: "organization" as const,
  permission: "blocked" as const,
  member_urn: "",
  note: "",
  connected: false,
  reason:
    "Page posting needs LinkedIn Community Management API approval, which this build does not have.",
};

const client = {
  slug: "kot",
  name: "Kōt Dynamics",
  file: "/b/kot.yaml",
  note: "Live brand.",
  counts: { pending: 1 },
  needsReview: 1,
  accounts: [PERSON, PAGE],
  bots: [
    {
      id: "kot-writer",
      name: "Kōt writer",
      description: "Drafts posts from the brand file and holds them in the approval queue.",
    },
  ],
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    client: "kot",
    channel: "linkedin_personal",
    language: "en" as const,
    angle: "A cheap site is a deferred bill",
    body: "A cheap site is not a cheaper site. It is a deferred bill, paid in pieces.",
    status: "approved",
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
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

function selectByLabel(container: HTMLElement, label: string): HTMLSelectElement {
  const match = container.querySelector(`select[aria-label="${label}"]`);
  if (!match) throw new Error(`No select labelled "${label}"`);
  return match as HTMLSelectElement;
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  api.clients.mockResolvedValue([client]);
  api.items.mockResolvedValue([item()]);
  api.item.mockResolvedValue({
    item: item(),
    events: [{ id: 1, action: "created", detail: "angle", at: new Date().toISOString() }],
  });
  api.check.mockResolvedValue({ brandViolations: [], commercialViolations: [] });
  api.chat.mockResolvedValue([]);
});

describe("Merrit home", () => {
  it("is a chat: bot roster on the left, conversation in the centre", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("Kōt writer");
    expect(container.textContent).toContain("Drafts posts from the brand file");
    expect(container.textContent).toContain("Ask for drafts, or ask what the brand file allows");
    expect(container.textContent).toContain("Review queue");
    expect(container.querySelector('textarea[aria-label="Message the bot"]')).not.toBeNull();
  });

  it("shows the brand and the account, with the disconnected page account visible", async () => {
    const container = await renderPage();
    expect(selectByLabel(container, "Brand").value).toBe("kot");

    const accounts = selectByLabel(container, "Account");
    // Connectivity is derived at runtime, so both read as not connected while no token exists,
    // even though Personal is permitted to post once authorized.
    const labels = Array.from(accounts.options).map((option) => option.textContent);
    expect(labels).toEqual(["Personal · not connected", "Kōt page · not connected"]);
    expect(accounts.value).toBe("kot-personal");
  });

  it("makes the disconnected state obvious and refuses to imply it can post", async () => {
    const container = await renderPage();
    await act(async () => {
      choose(selectByLabel(container, "Account"), "kot-page");
    });
    await flush();

    expect(container.textContent).toContain("Kōt page is not connected");
    expect(container.textContent).toContain("Community Management API approval");
    expect(container.textContent).toContain("nothing");
    expect(container.textContent).toContain("will fall back to another account");
  });

  it("sends a message to the bot for the selected account", async () => {
    api.sendChat.mockResolvedValue({
      action: "draft",
      reply: "Queued 2 drafts for review.",
      created: 2,
      flagged: 0,
      failures: [],
      messages: [],
    });
    const container = await renderPage();

    await act(async () => {
      choose(selectByLabel(container, "Account"), "kot-page");
    });
    await flush();

    const box = container.querySelector(
      'textarea[aria-label="Message the bot"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(box, "Draft two posts about the page");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    await act(async () => {
      buttonByText(container, "Send").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(api.sendChat).toHaveBeenCalledWith({
      client: "kot",
      bot: "kot-writer",
      account: "kot-page",
      message: "Draft two posts about the page",
    });
  });

  it("offers no publish control anywhere", async () => {
    const container = await renderPage();
    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent ?? "",
    );
    expect(labels.some((label) => /publish/i.test(label))).toBe(false);
    expect(container.textContent).toContain("Publishing is disabled");
  });
});

describe("Merrit queue surface", () => {
  async function openQueue() {
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "Review queue").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    return container;
  }

  it("stays reachable from the sidebar and shows the queue", async () => {
    const container = await openQueue();
    expect(container.textContent).toContain("A cheap site is a deferred bill");
    expect(api.items).toHaveBeenCalledWith(expect.objectContaining({ client: "kot" }));
  });

  it("opens the detail panel and approves", async () => {
    // A pending draft, because only pending can be approved.
    api.items.mockResolvedValue([item({ status: "pending" })]);
    api.item.mockResolvedValue({
      item: item({ status: "pending" }),
      events: [{ id: 1, action: "created", detail: "angle", at: new Date().toISOString() }],
    });
    api.approve.mockResolvedValue(item({ status: "approved" }));
    const container = await openQueue();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    await act(async () => {
      buttonByText(container, "Approve").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(api.approve).toHaveBeenCalledWith(ITEM_ID);
    expect(container.textContent).toContain("Approved. Publishing stays disabled");
  });

  it("rehearses against the selected account and shows it in the payload", async () => {
    api.dryRun.mockResolvedValue({
      kit: "/tmp/kit",
      item: item({ status: "dry_run" }),
      payload: {
        itemId: ITEM_ID,
        channel: "linkedin_personal",
        language: "en",
        body: "body",
        accountId: "kot-personal",
        accountLabel: "Personal",
        authorUrn: "urn:li:person:TEST",
        kitPath: "/tmp/kit",
        wouldPostTo: "https://api.linkedin.com/rest/posts",
      },
    });
    const container = await openQueue();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    await act(async () => {
      buttonByText(container, "Dry run, show payload").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    expect(api.dryRun).toHaveBeenCalledWith(ITEM_ID, "kot-personal");
    expect(container.textContent).toContain("Payload that would be sent");
    expect(container.textContent).toContain("Personal (kot-personal)");
  });

  it("disables the rehearsal on a disconnected account instead of falling back", async () => {
    const container = await renderPage();
    await act(async () => {
      choose(selectByLabel(container, "Account"), "kot-page");
    });
    await flush();
    await act(async () => {
      buttonByText(container, "Review queue").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    const dryRun = buttonByText(container, "Dry run, show payload");
    expect(dryRun.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Page posting needs LinkedIn Community Management API approval",
    );
  });
});

describe("rehearsal without a credential", () => {
  it("runs on a permitted account and marks the author unresolved", async () => {
    api.dryRun.mockResolvedValue({
      kit: "/tmp/kit",
      item: item({ status: "dry_run" }),
      payload: {
        itemId: ITEM_ID,
        channel: "linkedin_personal",
        language: "en",
        body: "body",
        accountId: "kot-personal",
        accountLabel: "Personal",
        authorUrn: "urn:li:person:TESTURN",
        kitPath: "/tmp/kit",
        wouldPostTo: "https://api.linkedin.com/rest/posts",
      },
    });

    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "Review queue").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    const dryRun = buttonByText(container, "Dry run, show payload");
    expect(dryRun.disabled).toBe(false);
    // No token, but the registry carries a member urn, so the payload can name the author.
    expect(container.textContent).toContain("A dry run names Personal as the author");

    await act(async () => {
      dryRun.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(api.dryRun).toHaveBeenCalledWith(ITEM_ID, "kot-personal");
    expect(container.textContent).toContain("urn:li:person:TESTURN");
  });

  it("says unresolved only when there is no member urn either", async () => {
    api.clients.mockResolvedValue([{ ...client, accounts: [{ ...PERSON, member_urn: "" }, PAGE] }]);
    const container = await renderPage();
    await act(async () => {
      buttonByText(container, "Review queue").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();
    await act(async () => {
      buttonByText(container, "A cheap site is a deferred bill").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await flush();

    expect(container.textContent).toContain("with the author unresolved");
  });
});
