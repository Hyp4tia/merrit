// Screenshot and acceptance harness for the Merrit surfaces.
//
// Run against a live dev stack (5173 for the web app, 3300 for the operator):
//   node apps/web/scripts/merrit-ui-check.mjs [output-directory]
//
// It drives the real UI at two viewports, captures every surface, and prints the measurements the
// design pass was judged on: type sizes in computed styles, how many rows sit above the fold, and
// whether the two decisions are reachable without scrolling. It never publishes, and the only
// outbound path it touches is the test send.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const out = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "../../../.artifacts/merrit-ui"),
);
const base = process.env.MERRIT_WEB_URL ?? "http://127.0.0.1:5173";
mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORTS[0] });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

const chat = () => page.getByRole("region", { name: "Chat with the bot" });
const queue = () => page.getByRole("region", { name: "Draft queue" });
const detail = () => page.getByRole("complementary", { name: "Draft detail" });

async function shot(name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot ${file}`);
}

async function box(node) {
  return node.boundingBox();
}

/** Is the element rendered inside the viewport, so a person sees it without scrolling? */
async function inViewport(node) {
  const rect = await box(node);
  const height = page.viewportSize()?.height ?? 0;
  return Boolean(rect && rect.y >= 0 && rect.y + rect.height <= height + 1);
}

try {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${base}/merrit`, { waitUntil: "networkidle" });
    await chat().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);

    // 1. Home, lead thread.
    await shot(`home-${viewport.name}`);

    // 2. The copywriter, where the draft is an artifact rather than prose.
    await page.getByRole("button", { name: "Kōt copywriter", exact: true }).click();
    await page.waitForTimeout(700);
    const card = page.locator('article[aria-label="Draft"]').first();
    const hasCard = await card.count();
    if (hasCard) {
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(`copywriter-${viewport.name}`);
      if (viewport.width === 1440) {
        const metrics = await page.evaluate(() => {
          const article = document.querySelector('article[aria-label="Draft"]');
          const post = article?.querySelector("p");
          const caption = document.querySelector(".text-merrit-caption");
          const pill = article?.querySelector("header span");
          const size = (node) => (node ? Number.parseFloat(getComputedStyle(node).fontSize) : null);
          return {
            post: size(post),
            caption: size(caption),
            pill: size(pill),
            statusLines: document.querySelectorAll('[role="status"]').length,
            chars: (post?.textContent ?? "").length,
          };
        });
        console.log(
          `card metrics: post ${metrics.post}px, caption ${metrics.caption}px, header ${metrics.pill}px, status lines ${metrics.statusLines}, body ${metrics.chars} chars`,
        );
      }
    } else {
      console.log("no draft card in the copywriter thread");
    }

    // 3. The queue, with the first draft already selected.
    await page.getByRole("button", { name: "Drafts", exact: true }).click();
    await queue().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(700);
    await shot(`queue-${viewport.name}`);

    const rows = page.locator('section[aria-label="Draft queue"] li');
    const total = await rows.count();
    let aboveFold = 0;
    for (let index = 0; index < total; index += 1) {
      const rect = await rows.nth(index).boundingBox();
      if (rect && rect.y + rect.height <= viewport.height + 1) aboveFold += 1;
    }
    console.log(`queue ${viewport.name}: ${total} rows, ${aboveFold} fully above the fold`);

    const approveVisible = await inViewport(detail().getByRole("button", { name: "Approve" }));
    const sendBackVisible = await inViewport(detail().getByRole("button", { name: "Send back" }));
    console.log(
      `queue ${viewport.name}: approve in view ${approveVisible}, send back in view ${sendBackVisible}`,
    );

    if (viewport.width === 1440) {
      const sizes = await page.evaluate(() => {
        const sizeOf = (selector) => {
          const node = document.querySelector(selector);
          return node ? getComputedStyle(node).fontSize : null;
        };
        const titles = Array.from(document.querySelectorAll("h1, h2")).map((node) => ({
          text: (node.textContent ?? "").slice(0, 30),
          size: getComputedStyle(node).fontSize,
        }));
        return {
          queueTitle: sizeOf('section[aria-label="Draft queue"] h1'),
          detailTitle: sizeOf('aside[aria-label="Draft detail"] h2'),
          body: sizeOf('aside[aria-label="Draft detail"] p.text-merrit-body'),
          titles,
        };
      });
      console.log(
        `type scale: queue title ${sizes.queueTitle}, detail title ${sizes.detailTitle}, body ${sizes.body}`,
      );
    }

    // 4. The detail with its preview, then the test send behind its disclosure.
    await detail().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await shot(`detail-${viewport.name}`);

    // A preview needs an approved draft, which is the documented order: approve, then test send.
    // The harness approves the selected draft the way the owner would, and says so.
    const showPreview = detail().getByRole("button", { name: "Show the preview" });
    const testSend = detail().getByText("Test send", { exact: true }).first();
    await testSend.click();
    await page.waitForTimeout(300);

    const enablePreview = async () => {
      const approve = detail().getByRole("button", { name: "Approve" });
      if ((await approve.count()) > 0 && (await approve.isEnabled())) {
        await approve.click();
        await page.waitForTimeout(1200);
        console.log("harness approved the selected draft so a preview could be shown");
        return true;
      }
      // Nothing pending left: open an already approved draft instead.
      // The status pill, not the filter option with the same word.
      const approvedRow = queue().locator('[data-status="approved"]').first();
      if ((await approvedRow.count()) > 0) {
        await approvedRow.click();
        await page.waitForTimeout(800);
        await detail().getByText("Test send", { exact: true }).first().click();
        await page.waitForTimeout(300);
        console.log("harness opened an approved draft so a preview could be shown");
        return true;
      }
      return false;
    };

    if ((await showPreview.count()) > 0 && !(await showPreview.isEnabled())) {
      await enablePreview();
    }
    if ((await showPreview.count()) > 0 && (await showPreview.isEnabled())) {
      await showPreview.click();
      await page.waitForTimeout(1200);
      await shot(`payload-${viewport.name}`);
      const payloadText = await detail().innerText();
      const author = payloadText.split("\n").find((line) => line.includes("urn:li:person")) ?? "?";
      console.log(`payload author: ${author.trim()}`);
    } else {
      console.log("test send not available for the selected draft");
    }
  }

  // 5. Language and structure checks on the primary surface, at the default viewport.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/merrit`, { waitUntil: "networkidle" });
  await chat().waitFor({ timeout: 20_000 });
  const text = await page.locator("body").innerText();
  const jargon = ["payload", "rehearsal", "dry run", "token on file", "this build"].filter((word) =>
    new RegExp(word, "i").test(text),
  );
  const statusLines = await page.locator('[role="status"]').count();
  console.log(`status lines on home: ${statusLines}`);
  console.log(`developer wording found: ${jargon.length === 0 ? "none" : jargon.join(", ")}`);

  console.log(`console errors: ${problems.length}`);
  for (const problem of problems.slice(0, 8)) console.log(`  ! ${problem}`);
} finally {
  await browser.close();
}
