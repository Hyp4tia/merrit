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

  // 3. Back to Personal, then into the queue from the sidebar.
  await accounts.selectOption("kot-personal");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Review queue" }).click();
  await queue().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(700);
  console.log(`queue cards: ${await queue().locator("button").count()}`);
  await shot("03-queue");

  // 4. Detail: the dry-run control and its honest state for the selected account.
  const cards = queue().locator("button").filter({ hasText: "Pending" });
  if ((await cards.count()) > 0) {
    await cards.first().click();
    await detail().getByRole("textbox", { name: "Draft body" }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(700);
    const dryRun = detail().getByRole("button", { name: "Dry run, show payload" });
    console.log(`dry-run button disabled: ${await dryRun.isDisabled()}`);
    const caption = await detail()
      .getByText(/Publishing is disabled|not connected|No LinkedIn token/)
      .last()
      .innerText()
      .catch(() => "");
    console.log(`caption: ${caption.replace(/\s+/g, " ").slice(0, 160)}`);
    await shot("04-detail");
  } else {
    console.log("no pending draft to open");
  }

  console.log(`console errors: ${problems.length}`);
  for (const problem of problems.slice(0, 8)) console.log(`  ! ${problem}`);
} finally {
  await browser.close();
}
