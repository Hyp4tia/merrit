// Screenshot and click-through harness for the Merrit page.
//
// Run against a live dev stack (5173 for the web app, 3300 for the operator):
//   node apps/web/scripts/merrit-ui-check.mjs [output-directory]
//
// It proves three things by driving the real UI: the queue renders with live data, the detail
// panel opens, and approve, reject and dry run work end to end. It never publishes: the only
// payload path it touches is the dry run, which sends nothing.
//
// Approve and reject run against a demo brand, so the live Kōt queue is only read.
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

const queue = () => page.getByRole("region", { name: "Approval queue" });
const detail = () => page.getByRole("complementary", { name: "Draft detail" });

async function shot(name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot ${file}`);
}

async function openBrand(name) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await queue().waitFor();
  await page.waitForTimeout(700);
}

function pendingCards() {
  return queue().locator("button").filter({ hasText: "Pending" });
}

try {
  await page.goto(`${base}/merrit`, { waitUntil: "networkidle" });
  await page.getByText("Dry run only. Publishing is disabled").waitFor({ timeout: 20_000 });
  await queue().waitFor();

  // 1. Queue on the live brand, three brands in the rail.
  const rail = (await page.getByRole("complementary", { name: "Brands" }).innerText())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  console.log(`brand rail: ${rail.join(" | ")}`);
  console.log(`kot cards in queue: ${await queue().locator("button").count()}`);
  await shot("01-queue");

  // 2. Detail panel. Approve and reject run on a demo brand so the live queue stays read only,
  // and on whichever demo brand currently has work in it.
  let cards = pendingCards();
  let demoBrand = "";
  for (const candidate of ["BARQ Auto Spa", "NŪR Dental Studio"]) {
    await openBrand(candidate);
    cards = pendingCards();
    if ((await cards.count()) > 0) {
      demoBrand = candidate;
      break;
    }
  }
  const count = await cards.count();
  console.log(`demo brand with pending work: ${demoBrand || "none"} (${count} pending)`);
  if (!demoBrand) throw new Error("No pending demo draft to exercise. Generate one first.");

  await cards.first().click();
  const body = detail().getByRole("textbox", { name: "Draft body" });
  await body.waitFor({ timeout: 20_000 });
  console.log(
    `detail body starts: ${(await body.inputValue()).slice(0, 70).replace(/\s+/g, " ")}...`,
  );
  await shot("02-detail");

  // 3. Approve.
  await detail().getByRole("button", { name: "Approve" }).click();
  await detail().getByText("Approved. Publishing stays disabled").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
  const statusLine = (await detail().innerText()).includes("Approved") ? "approved" : "unexpected";
  console.log(`approved, panel reports: ${statusLine}`);
  await shot("03-approved");

  // 4. Dry run: the payload, and nothing sent.
  await detail().getByRole("button", { name: "Dry run, show payload" }).click();
  await detail().getByText("Payload that would be sent").waitFor({ timeout: 30_000 });
  await detail().getByText("Payload that would be sent").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const payloadText = await detail().innerText();
  const endpoint = payloadText.split("\n").find((line) => line.includes("api.linkedin.com")) ?? "?";
  const author = payloadText.split("\n").find((line) => line.includes("urn:li:person")) ?? "?";
  console.log(`dry run endpoint: ${endpoint.trim()}`);
  console.log(`dry run author:   ${author.trim()}`);
  await shot("04-dry-run-payload");

  // 5. Reject another draft on the same demo brand, with a written reason. It drives a rewrite.
  const remaining = pendingCards();
  if ((await remaining.count()) > 0) {
    await remaining.first().click();
    const panel = detail();
    await panel.getByRole("textbox", { name: "Draft body" }).waitFor({ timeout: 20_000 });
    await panel
      .getByRole("textbox", { name: "Rejection reason" })
      .fill(
        "Opens with a claim the brand file does not support. Start with the panel reading instead.",
      );
    await panel.getByRole("button", { name: "Reject" }).click();
    await panel.getByText(/replacement draft was written|Rejected\./).waitFor({ timeout: 90_000 });
    console.log("reject: accepted with a written reason, replacement requested");
    await page.waitForTimeout(900);
    await shot("05-rejected");
  } else {
    console.log("reject: no second pending draft available");
  }

  // 6. Switch brand, proving the rail and queue follow the switch.
  await openBrand("NŪR Dental Studio");
  await shot("06-brand-switch");

  console.log(`console errors: ${problems.length}`);
  for (const problem of problems.slice(0, 8)) console.log(`  ! ${problem}`);
} finally {
  await browser.close();
}
