// Screenshot and click-through harness for the Merrit surfaces.
//
// Run against a live dev stack (5173 for the web app, 3300 for the operator):
//   node apps/web/scripts/merrit-ui-check.mjs [output-directory]
//
// It drives the real UI: the chat home with the bot roster, the account selector and its
// disconnected state, the queue, and the draft detail. It never publishes, and the only payload
// path it touches is the dry run.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const out = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "../../../.artifacts/merrit-ui"),
);
const base = process.env.MERRIT_WEB_URL ?? "http://127.0.0.1:5173";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

const chat = () => page.getByRole("region", { name: "Chat with the bot" });
const queue = () => page.getByRole("region", { name: "Approval queue" });
const detail = () => page.getByRole("complementary", { name: "Draft detail" });

async function shot(name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot ${file}`);
}

try {
  await page.goto(`${base}/merrit`, { waitUntil: "networkidle" });
  await page.getByText("Dry run only. Publishing is disabled").waitFor({ timeout: 20_000 });

  // 1. Home: bot roster, brand and account in the navbar, the conversation in the centre.
  await chat().waitFor({ timeout: 20_000 });
  const roster = (await page.getByRole("complementary", { name: "Bots" }).innerText())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  console.log(`bot roster: ${roster.join(" | ")}`);

  const accounts = page.getByRole("combobox", { name: "Account" });
  console.log(
    `accounts: ${await accounts
      .locator("option")
      .allInnerTexts()
      .then((list) => list.join(" | "))}`,
  );
  const turns = await chat().locator("p, div").count();
  console.log(`chat rendered, elements: ${turns}`);
  await shot("01-home-chat");

  // 2. The page account: visible, selectable, and obviously not usable.
  await accounts.selectOption("kot-page");
  await page.waitForTimeout(600);
  await shot("02-account-not-connected");
  const banner = await page
    .getByText(/is not connected/)
    .first()
    .innerText()
    .catch(() => "");
  console.log(`disconnected banner: ${banner.replace(/\s+/g, " ").slice(0, 140)}`);

  // 3. The delegation loop, driven through the real UI. The lead routes, the copywriter drafts,
  // and a reply from the owner revises the same item instead of creating another.
  await accounts.selectOption("kot-personal");
  await page.waitForTimeout(400);

  const composer = chat().getByRole("textbox", { name: "Message the bot" });
  const sendButton = chat().getByRole("button", { name: "Send" });

  await composer.fill("Draft a post that answers the cheap-site objection.");
  await sendButton.click();
  await chat()
    .getByText(/Delegation ·/)
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const leadThread = await chat().innerText();
  console.log(
    `lead thread: ${leadThread.split("\n").filter(Boolean).slice(0, 9).join(" | ").slice(0, 400)}`,
  );
  const card = await chat()
    .getByText(/Delegation ·/)
    .first()
    .innerText();
  console.log(`card: ${card.replace(/\s+/g, " ").slice(0, 200)}`);
  await shot("05-lead-delegation");

  // 4. Click the card: the copywriter's thread holds the request and the draft.
  await chat()
    .getByRole("button", { name: /^Open / })
    .first()
    .click();
  await chat()
    .getByText(/Delegation ·/)
    .first()
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  const copyThread = await chat().innerText();
  console.log(`copywriter thread length: ${copyThread.length}`);
  await shot("06-copywriter-draft");

  // 5. Revise in the copywriter's thread: one item, edited in place.
  await composer.fill("make it shorter");
  await sendButton.click();
  await chat()
    .getByText(/Revised\. Still one item/)
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  const revised = await chat()
    .getByText(/Revised\. Still one item/)
    .first()
    .innerText();
  console.log(`revision: ${revised.replace(/\s+/g, " ").slice(0, 160)}`);
  await shot("07-copywriter-revision");

  // 6. Back to the queue to prove the item count moved by exactly one and the dry run still works.
  await page
    .getByRole("button", { name: /Kōt lead/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Review queue" }).click();
  await queue().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  console.log(`queue cards: ${await queue().locator("button").count()}`);
  await shot("03-queue");

  // 4. Detail, approve, then the dry run. A rehearsal needs no credential, so the payload is
  // produced with the author explicitly unresolved instead of being blocked.
  const cards = queue().locator("button").filter({ hasText: "Pending" });
  if ((await cards.count()) > 0) {
    await cards.first().click();
    await detail().getByRole("textbox", { name: "Draft body" }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(600);

    const dryRun = detail().getByRole("button", { name: "Dry run, show payload" });
    console.log(`dry-run disabled before approval: ${await dryRun.isDisabled()}`);
    const caption = await detail()
      .getByText(/with the author unresolved|Publishing is disabled/)
      .first()
      .innerText()
      .catch(() => "");
    console.log(`caption: ${caption.replace(/\s+/g, " ").slice(0, 170)}`);

    await detail().getByRole("button", { name: "Approve" }).click();
    await detail().getByText("Approved. Publishing stays disabled").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    console.log(`dry-run disabled after approval: ${await dryRun.isDisabled()}`);

    await dryRun.click();
    await detail().getByText("Payload that would be sent").waitFor({ timeout: 30_000 });
    await detail().getByText("Payload that would be sent").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const payload = await detail().innerText();
    const author =
      payload.split("\n").find((line) => line.includes("urn:li:person")) ??
      payload.split("\n").find((line) => line.includes("unresolved")) ??
      "?";
    console.log(`payload author: ${author.trim()}`);
    await shot("04-dry-run-payload");
  } else {
    console.log("no pending draft to open");
  }

  console.log(`console errors: ${problems.length}`);
  for (const problem of problems.slice(0, 8)) console.log(`  ! ${problem}`);
} finally {
  await browser.close();
}
