import type { Brand } from "../src/brand.ts";
import { brandFromYaml } from "../src/brand.ts";

// Mirrors the offers block of the real client brand file so the guard is exercised against
// the figures the business actually sells. Kept small on purpose: these tests are about the
// mechanism, not about one client's copy.
const FIXTURE = `
client:
  name: Kōt Dynamics
  category: AI, software and data consulting
positioning:
  one_liner: Kōt Dynamics builds AI, software, and data systems that hold up in production.
  register: established firm
  differentiators:
    - production-grade engineering, not vibe-coded prototypes
audience:
  primary: owners of small businesses in Egypt
  objections_to_answer:
    - why not a cheap Wix site
voice:
  tone: direct, technical, calm, no hype
  sentence_length: short
  person: we for Kōt
  claim_style: specific and checkable, numbers over adjectives
  avoid: startup enthusiasm, exclamation marks, emoji in body copy
  good_examples:
    - We rebuilt the booking flow so a no-show costs one tap to refill.
  bad_examples:
    - Unlock your business potential with cutting-edge AI solutions!
languages:
  en:
    dialect: neutral international English
  ar:
    dialect: Modern Standard Arabic
    note: Egyptian colloquial is only for WhatsApp outreach
banned:
  - game changer
  - revolutionary
  - unlock
  - cutting-edge
  - passionate
  - trusted by or our clients
proof:
  allowed:
    - Leng was built at Nile University, public repo
  never:
    - Soma described as shipped or on the App Store
cta:
  primary: book a call
cadence:
  linkedin_personal: 3 posts per week
offers:
  lead_offer:
    name: Site plus marketing (Lane B)
    site_price_egp: 12000
    site_payment_split: 6000 signing, 6000 launch
    site_price_paid_in_full_egp: 10000
    marketing_retainer_egp_month: 6000
    marketing_note: brand page, both branches in one feed, month to month, no lock-in
  site_only:
    price_egp: 12000
    share: 10% of site-attributed jobs for 12 months, settled monthly against a weekly log
    no_log_rule: no weekly log means no percentage, and the site price becomes 15000
  extras:
    photo_shoot_egp: 4000
    extra_page_egp: 3000
    booking_with_reminders_egp: 6000
  rules:
    - never guarantee customers, only guarantee the work
    - never free work, in any form
    - nothing starts before the deposit clears
    - build floor is 12000
commitments:
  promises: []
`;

// Pass promises to exercise the commitments path. An empty list is the real client's current
// state: nothing may be promised.
export function testBrand(promises: string[] = []): Brand {
  const yaml = promises.length
    ? FIXTURE.replace(
        "  promises: []",
        `  promises:\n${promises.map((promise) => `    - ${JSON.stringify(promise)}`).join("\n")}`,
      )
    : FIXTURE;
  return brandFromYaml(yaml, "kot");
}
