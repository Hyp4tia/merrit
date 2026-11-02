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
  threads: vi.fn(),
  thread: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock("./api", () => ({
  merritApi: api,
  merritKeys: {
    clients: ["merrit", "clients"],
    threads: (client: string) => ["merrit", "threads", client],
    thread: (client: string, botId: string) => ["merrit", "thread", client, botId],
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
    // Base UI primitives are not worth rendering in jsdom: the popover content is asserted through
    // the trigger, and the disclosure content is always rendered.
    Popover: Passthrough,
    PopoverTrigger: ({ children, ...props }: ComponentProps<"button">) => (
      <button {...props}>{children}</button>
    ),
    PopoverContent: Passthrough,
    Disclosure: ({ summary, children }: { summary: ReactNode; children?: ReactNode }) => (
      <div>
        {summary}
        {children}
      </div>
    ),
    buttonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
  };
});

const { MerritPage } = await import("./merrit-page");

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const SECOND_ID = "22222222-2222-2222-2222-222222222222";
const THIRD_ID = "33333333-3333-3333-3333-333333333333";
const DELEGATION_ID = "44444444-4444-4444-4444-444444444444";

const LONG_BODY =
  "The objection is plain: someone quoted less than 12000 EGP for a site, so why pay ours. " +
  "12000 EGP is our build floor. 6000 to start, 6000 at launch, or 10000 paid in full. " +
  "That covers pages that load on a 3G phone, a booking flow a receptionist can run, and a form " +
  "that delivers mail instead of quietly failing.";

// Permission comes from the registry, connectivity from the server. Personal is permitted but has
// no token in this beta, which is exactly the state the UI has to render honestly.
const PERSON = {
  id: "kot-personal",
  label: "Personal",
  kind: "person" as const,
  permission: "granted" as const,
  member_urn: "urn:li:person:TESTURN",
  note: "The founder profile.",
  connected: false,
  reason: "Not connected. Authorize this account before it can post.",
};

const PAGE = {
  id: "kot-page",
  label: "Kōt page",
  kind: "organization" as const,
  permission: "blocked" as const,
  member_urn: "",
  note: "Page posting needs approval.",
  connected: false,
  reason: "Page posting needs Community Management API approval, which this beta does not have.",
};

const LEAD = {
  id: "kot-lead",
  name: "Kōt lead",
  role: "lead",
  active: true,
  description: "Routes the request and reports the outcome. Never writes the post.",
};

const COPY = {
  id: "kot-copywriter",
  name: "Kōt copywriter",
  role: "copywriter",
  active: true,
  description: "Drafts and revises posts from the brand file.",
};

const INACTIVE = ["kot-strategist", "kot-designer", "kot-ads"].map((id) => ({
  id,
  name: id.replace("kot-", "Kōt "),
  role: id.replace("kot-", ""),
  active: false,
  description: "Coming soon.",
}));

const client = {
  slug: "kot",
  name: "Kōt Dynamics",
  file: "/b/kot.yaml",
  note: "Live brand.",
  counts: { pending: 2 },
  needsReview: 2,
  accounts: [PERSON, PAGE],
  bots: [LEAD, COPY, ...INACTIVE],
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    client: "kot",
    channel: "linkedin_personal",
    language: "en" as const,
    angle: "A cheap site is a deferred bill",
    body: LONG_BODY,
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
    created_at: "2026-11-02T18:00:00.000Z",
    updated_at: "2026-11-02T18:00:00.000Z",
    ...overrides,
  };
}

const ITEMS = [
  item(),
  item({
    id: SECOND_ID,
    angle: "The booking log is the asset",
    status: "approved",
    created_at: "2026-11-02T18:10:00.000Z",
  }),
  item({
    id: THIRD_ID,
    angle: "Pricing is not the objection",
    created_at: "2026-11-02T18:20:00.000Z",
  }),
];

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
        <MemoryRouter initialEntries={["/merrit"]}>
          <MerritPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  return container;
}

// Sidebar buttons carry an avatar, a name and a counter, so matching is by contained text rather
// than exact equality. The shortest match wins when a label appears twice in one scope.
function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const matches = Array.from(container.querySelectorAll("button"))
    .filter((button) => (button.textContent ?? "").includes(text))
    .sort((left, right) => (left.textContent ?? "").length - (right.textContent ?? "").length);
  const found = matches[0];
  if (!found) throw new Error(`No button with text "${text}"`);
  return found as HTMLButtonElement;
}

function click(node: HTMLElement) {
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => {
  for (const spy of Object.values(api)) spy.mockReset?.();
  api.clients.mockResolvedValue([client]);
  api.items.mockResolvedValue(ITEMS);
  api.item.mockImplementation((id: string) =>
    Promise.resolve({ item: ITEMS.find((entry) => entry.id === id) ?? ITEMS[0], events: [] }),
  );
  api.check.mockResolvedValue({ brandViolations: [], commercialViolations: [] });
  api.approve.mockResolvedValue({ ok: true });
  api.reject.mockResolvedValue({ ok: true, replacement: null });
  api.saveBody.mockResolvedValue({ ok: true });
  api.dryRun.mockResolvedValue({ payload: null, kit: null });
  api.postMessage.mockResolvedValue({
    reply: "On it.",
    messages: [],
    delegation: null,
    itemId: null,
  });

  api.threads.mockResolvedValue([
    { threadId: "thread-lead", bot: LEAD, messageCount: 2, lastMessageAt: null },
    { threadId: "thread-copy", bot: COPY, messageCount: 5, lastMessageAt: null },
    ...INACTIVE.map((bot) => ({
      threadId: null,
      bot,
      messageCount: 0,
      lastMessageAt: null,
    })),
  ]);

  api.thread.mockImplementation((_: string, botId: string) => {
    const delegation = {
      id: DELEGATION_ID,
      fromBot: "kot-lead",
      toBot: "kot-copywriter",
      request: "Draft a post that answers the cheap-site objection.",
      itemId: ITEM_ID,
      status: "done",
      at: new Date().toISOString(),
    };
    if (botId === "kot-copywriter") {
      return Promise.resolve({
        threadId: "thread-copy",
        bot: COPY,
        messages: [
          {
            id: 1,
            role: "delegation",
            bot: "kot-copywriter",
            content: delegation.request,
            itemId: ITEM_ID,
            delegationId: DELEGATION_ID,
            at: new Date().toISOString(),
          },
          {
            id: 2,
            role: "assistant",
            bot: "kot-copywriter",
            content: LONG_BODY,
            itemId: ITEM_ID,
            delegationId: DELEGATION_ID,
            at: new Date().toISOString(),
          },
        ],
        delegations: [delegation],
      });
    }
    return Promise.resolve({
      threadId: "thread-lead",
      bot: LEAD,
      messages: [
        {
          id: 3,
          role: "user",
          bot: "kot-lead",
          content: delegation.request,
          itemId: null,
          delegationId: null,
          at: new Date().toISOString(),
        },
        {
          id: 4,
          role: "assistant",
          bot: "kot-lead",
          content: "Sent that to the copywriter. The draft is with you for review.",
          itemId: ITEM_ID,
          delegationId: DELEGATION_ID,
          at: new Date().toISOString(),
        },
      ],
      delegations: [delegation],
    });
  });
});

describe("Merrit home", () => {
  it("is a chat, and every counter says what it counts", async () => {
    const container = await renderPage();

    expect(container.textContent).toContain("Kōt lead");
    expect(container.textContent).toContain("Kōt copywriter");
    expect(container.textContent).toContain("2 messages");
    expect(container.textContent).toContain("5 messages");

    // Three bots are declared and not built: one line, not three rows in the primary navigation.
    expect(container.textContent).toContain("3 more bots, coming soon");
    expect(container.querySelector('button[aria-label="Message the bot"]')).toBeNull();
    expect(container.querySelector('textarea[aria-label="Message the bot"]')).not.toBeNull();
    expect(container.textContent).toContain("Drafts");
    // The rail counts what needs a decision, and says so, so it cannot be read as the total.
    expect(container.textContent).toContain("2 waiting");
  });

  it("keeps one status line for the whole surface", async () => {
    const container = await renderPage();

    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toContain("Preview only");
    expect(statuses[0]?.textContent).toContain("not connected");
    expect(container.textContent).not.toContain("Dry run only");
    expect(container.textContent).not.toMatch(/rehearsal/i);
  });

  it("offers identity as pickers, not form selects", async () => {
    const container = await renderPage();

    expect(container.querySelector('button[aria-label="Brand"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Account"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Brand"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Account"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Account"]')?.textContent).toContain(
      "Personal · not connected",
    );
  });

  it("shows the draft as a card in the copywriter thread, not as prose", async () => {
    const container = await renderPage();
    await act(async () => {
      click(buttonByText(container, "Kōt copywriter"));
    });
    await flush();

    const card = container.querySelector('article[aria-label="Draft"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Draft #1");
    expect(card?.textContent).toContain("characters");
    expect(card?.textContent).toContain("LinkedIn");
    expect(card?.textContent).toContain("…see more");
    for (const action of ["Approve", "Edit", "Reject", "Open"]) {
      expect(buttonByText(container, action)).toBeTruthy();
    }
  });

  it("approves a draft from the card without leaving the conversation", async () => {
    const container = await renderPage();
    await act(async () => {
      click(buttonByText(container, "Kōt copywriter"));
    });
    await flush();

    const card = container.querySelector('article[aria-label="Draft"]') as HTMLElement;
    const approveButton = Array.from(card.querySelectorAll("button")).find(
      (button) => (button.textContent ?? "").trim() === "Approve",
    ) as HTMLButtonElement;

    await act(async () => {
      click(approveButton);
    });
    await flush();

    expect(api.approve).toHaveBeenCalledWith(ITEM_ID);
    // Still in the chat: the queue surface never opened.
    expect(container.querySelector('section[aria-label="Chat with the bot"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="Draft queue"]')).toBeNull();
  });

  it("says nothing in developer language on the primary surface", async () => {
    const container = await renderPage();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/payload/i);
    expect(text).not.toMatch(/rehearsal/i);
    expect(text).not.toMatch(/dry run/i);
    expect(text).not.toMatch(/token on file/i);
    expect(text).not.toMatch(/this build/i);
    expect(text).not.toContain(ITEM_ID);
  });

  it("uses the Merrit type scale rather than 12px utility text", async () => {
    const container = await renderPage();
    const title = container.querySelector("h1");

    expect(title?.className).toContain("text-merrit-title");
    expect(container.querySelector(".text-merrit-secondary")).not.toBeNull();
    expect(container.querySelector(".text-merrit-footnote")).not.toBeNull();
  });
});

describe("Merrit drafts surface", () => {
  async function openQueue() {
    const container = await renderPage();
    await act(async () => {
      click(buttonByText(container, "Drafts"));
    });
    await flush();
    return container;
  }

  it("selects the first draft that needs a decision, and keeps the decisions in reach", async () => {
    const container = await openQueue();

    expect(container.querySelector('section[aria-label="Draft queue"]')).not.toBeNull();
    const detail = container.querySelector('aside[aria-label="Draft detail"]');
    expect(detail).not.toBeNull();
    // Work waiting for the owner comes first, newest of those at the top of that group.
    expect(detail?.textContent).toContain("Pricing is not the objection");

    // The sticky bar: both decisions, always rendered, never below a long body.
    expect(buttonByText(detail as HTMLElement, "Approve")).toBeTruthy();
    expect(buttonByText(detail as HTMLElement, "Send back")).toBeTruthy();
  });

  it("moves with J and K and approves with A", async () => {
    const container = await openQueue();

    await act(async () => {
      press("j");
    });
    await flush();
    expect(container.querySelector('aside[aria-label="Draft detail"]')?.textContent).toContain(
      "A cheap site is a deferred bill",
    );

    await act(async () => {
      press("k");
    });
    await flush();
    expect(container.querySelector('aside[aria-label="Draft detail"]')?.textContent).toContain(
      "Pricing is not the objection",
    );

    await act(async () => {
      press("a");
    });
    await flush();
    expect(api.approve).toHaveBeenCalledWith(THIRD_ID);
  });

  it("opens the send-back form from the keyboard", async () => {
    const container = await openQueue();

    await act(async () => {
      press("r");
    });
    await flush();

    expect(container.querySelector('input[aria-label="Why send it back"]')).not.toBeNull();
  });

  it("labels the status of a draft in words an owner uses", async () => {
    const container = await openQueue();
    const queue = container.querySelector('section[aria-label="Draft queue"]');

    expect(queue?.textContent).toContain("Waiting for you");
    expect(queue?.textContent).toContain("Approved");
    expect(queue?.textContent).not.toContain("pending");
  });

  it("shows the preview with the fold and keeps the test send folded away", async () => {
    const container = await openQueue();
    const detail = container.querySelector('aside[aria-label="Draft detail"]') as HTMLElement;

    expect(detail.textContent).toContain("…see more");
    expect(detail.textContent).toContain("Test send");
    expect(detail.textContent).toContain("Preview only. Nothing sends in beta.");
  });
});
