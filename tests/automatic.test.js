import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  allocateDailyBudgets,
  buildAutomaticSpRows,
  generateAutomaticCampaigns,
  parseSkuList,
  validateAutomaticCampaigns,
  validateAutomaticSetup,
} from "../src/lib/automatic.js";
import {
  decryptDraft,
  encryptDraft,
  hydrateDraft,
  isEncryptedDraft,
  serializeDraft,
} from "../src/lib/draft.js";
import {
  createBulksheet,
  entityCounts,
  inspectGeneratedWorkbook,
} from "../src/lib/bulksheet.js";

const templatePath = new URL("../reference/AdvertisingBulksheetTemplate-seller.xlsx", import.meta.url);

function fixture() {
  return {
    skuText: "CANVAS-001\nCANVAS-002",
    totalDailyBudget: "10.03",
    selectedTargetingTypes: ["close-match", "substitutes"],
    bidTiers: [
      { id: "tier-low", label: "探索档", bid: "0.35" },
      { id: "tier-high", label: "进取档", bid: "0.72" },
    ],
    startDate: "20260913",
    endDate: "",
    biddingStrategy: "Dynamic bids - down only",
    state: "paused",
    portfolioId: "",
    offAmazon: "",
  };
}

test("parses a full SKU list without sampling and removes only duplicates", () => {
  assert.deepEqual(
    parseSkuList(" SKU-1\nSKU-2\t sku-1 ; SKU-3,SKU-4 "),
    ["SKU-1", "SKU-2", "SKU-3", "SKU-4"],
  );
});

test("allocates integer cents deterministically and preserves the exact total", () => {
  const budgets = allocateDailyBudgets("10.03", 8);
  assert.deepEqual(budgets, ["1.26", "1.26", "1.26", "1.25", "1.25", "1.25", "1.25", "1.25"]);
  assert.equal(budgets.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0), 1003);
});

test("requires every visible bid tier to be complete before generation", () => {
  const settings = fixture();
  settings.bidTiers.push({ id: "tier-empty", label: "", bid: "" });
  const issues = validateAutomaticSetup(settings, "20260913");
  assert.ok(issues.some((item) => item.path === "tierLabel" && item.rowId === "tier-empty"));
  assert.ok(issues.some((item) => item.path === "tierBid" && item.rowId === "tier-empty"));
});

test("generates the complete SKU x target type x bid tier matrix", () => {
  const settings = fixture();
  assert.deepEqual(validateAutomaticSetup(settings, "20260913"), []);
  const campaigns = generateAutomaticCampaigns(settings);
  assert.equal(campaigns.length, 8);
  assert.equal(new Set(campaigns.map((campaign) => campaign.temporaryId)).size, 8);
  assert.deepEqual(
    campaigns.map(({ sku, targetingType, tierLabel }) => [sku, targetingType, tierLabel]),
    [
      ["CANVAS-001", "close-match", "探索档"],
      ["CANVAS-001", "close-match", "进取档"],
      ["CANVAS-001", "substitutes", "探索档"],
      ["CANVAS-001", "substitutes", "进取档"],
      ["CANVAS-002", "close-match", "探索档"],
      ["CANVAS-002", "close-match", "进取档"],
      ["CANVAS-002", "substitutes", "探索档"],
      ["CANVAS-002", "substitutes", "进取档"],
    ],
  );
  assert.deepEqual(validateAutomaticCampaigns(campaigns, settings.totalDailyBudget), []);
});

test("builds four template-compatible rows for every isolated automatic campaign", () => {
  const settings = fixture();
  const campaigns = generateAutomaticCampaigns(settings);
  campaigns[0] = {
    ...campaigns[0],
    campaignName: "Edited automatic campaign",
    adGroupName: "Edited automatic ad group",
    bid: "0.44",
  };
  const rows = buildAutomaticSpRows(settings, campaigns);
  assert.equal(rows.length, 32);
  assert.deepEqual(entityCounts(rows), {
    Campaign: 8,
    "Ad Group": 8,
    "Product Ad": 8,
    "Product Targeting": 8,
  });
  assert.deepEqual(rows.slice(0, 4).map((row) => row.Entity), [
    "Campaign", "Ad Group", "Product Ad", "Product Targeting",
  ]);
  assert.equal(rows[0]["Targeting Type"], "AUTO");
  assert.equal(rows[0]["Campaign Name"], "Edited automatic campaign");
  assert.equal(rows[0]["Daily Budget"], 1.26);
  assert.equal(rows[1]["Ad Group Default Bid"], 0.44);
  assert.equal(rows[2].SKU, "CANVAS-001");
  assert.equal(rows[3].Bid, 0.44);
  assert.equal(rows[3]["Product Targeting Expression"], "close-match");
});

test("writes automatic campaigns into the existing official workbook package", async () => {
  const settings = fixture();
  const campaigns = generateAutomaticCampaigns(settings);
  const source = await readFile(templatePath);
  const output = await createBulksheet(source, buildAutomaticSpRows(settings, campaigns));
  const metadata = await inspectGeneratedWorkbook(output, "automatic-sample.xlsx");
  assert.equal(metadata.valid, true);
  assert.equal(metadata.dataRowCount, 32);
});

test("hydrates a legacy v2 keyword draft and serializes both builders in v4", () => {
  const legacy = hydrateDraft({
    settings: { sku: "LEGACY-SKU", dailyBudget: "18.00" },
    keywords: [{ id: "legacy-row", text: "legacy keyword", matchType: "exact", bid: "0.50" }],
  });
  assert.equal(legacy.keywordSettings.sku, "LEGACY-SKU");
  assert.equal(legacy.keywords[0].text, "legacy keyword");
  assert.equal(legacy.negativeKeywords[0].text, "");
  assert.equal(legacy.automaticCampaigns.length, 0);

  const encoded = serializeDraft({
    ...legacy,
    automaticSettings: fixture(),
    automaticCampaigns: generateAutomaticCampaigns(fixture()),
  });
  assert.equal(encoded.version, 4);
  assert.equal(encoded.keyword.keywords[0].text, "legacy keyword");
  assert.equal(encoded.keyword.negativeKeywords[0].text, "");
  assert.equal(encoded.automatic.campaigns.length, 8);
  assert.equal("startDate" in encoded.keyword.settings, false);
  assert.equal("startDate" in encoded.automatic.settings, false);
});

test("migrates the earlier per-keyword negative fields into the independent batch", () => {
  const migrated = hydrateDraft({
    version: 3,
    keyword: {
      settings: { sku: "MIGRATE-SKU", dailyBudget: "20.00" },
      keywords: [{
        id: "keyword-row",
        text: "wall art",
        matchType: "exact",
        bid: "0.50",
        negativeText: "poster",
        negativeMatchType: "negativePhrase",
      }],
    },
    automatic: { settings: fixture(), campaigns: [] },
  });
  assert.equal(migrated.keywords[0].text, "wall art");
  assert.equal("negativeText" in migrated.keywords[0], false);
  assert.deepEqual(
    migrated.negativeKeywords.map(({ text, matchType }) => ({ text, matchType })),
    [{ text: "poster", matchType: "negativePhrase" }],
  );
});

test("encrypts complete drafts with a user passphrase and rejects a wrong passphrase", async () => {
  const value = serializeDraft({
    keywordSettings: { ...fixture(), sku: "PRIVATE-SKU", dailyBudget: "18.00" },
    keywords: [{ id: "secret-row", text: "private keyword", matchType: "exact", bid: "0.55" }],
    negativeKeywords: [{ id: "negative-row", text: "private negative", matchType: "negativePhrase" }],
    automaticSettings: fixture(),
    automaticCampaigns: generateAutomaticCampaigns(fixture()),
  });
  const envelope = await encryptDraft(value, "correct horse battery staple");
  assert.equal(isEncryptedDraft(envelope), true);
  assert.doesNotMatch(JSON.stringify(envelope), /PRIVATE-SKU|private keyword|private negative/);
  assert.deepEqual(await decryptDraft(envelope, "correct horse battery staple"), value);
  await assert.rejects(
    decryptDraft(envelope, "wrong password"),
    /密码错误或加密草稿已损坏/,
  );
});
