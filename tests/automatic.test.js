import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  automaticOutputRowCount,
  buildAutomaticSpRows,
  combinationCount,
  generateAutomaticCampaigns,
  parseSkuList,
  planAutomaticBids,
  validateAutomaticCampaigns,
  validateAutomaticOutputSize,
  validateAutomaticSetup,
} from "../src/lib/automatic.js";
import {
  removeProblemNegativeKeywordRows,
  removeProblemNegativeProductRows,
  validateNegativeKeywords,
  validateNegativeProducts,
} from "../src/lib/validation.js";
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
    dailyBudget: "10.03",
    selectedTargetingTypes: ["close-match", "substitutes"],
    baseBid: "0.50",
    bidInterval: "0.01",
    tierCount: "2",
    startDate: "20260913",
    endDate: "",
    biddingStrategy: "Dynamic bids - down only",
    state: "paused",
    portfolioId: "",
    offAmazon: "",
  };
}

function tieredFixture() {
  return {
    skuText: "CANVAS-001\nCANVAS-002",
    dailyBudget: "20.00",
    selectedTargetingTypes: ["close-match", "substitutes"],
    baseBid: "0.50",
    bidInterval: "0.01",
    tierCount: "10",
    startDate: "20260913",
    endDate: "",
    biddingStrategy: "Dynamic bids - down only",
    state: "paused",
    portfolioId: "",
    offAmazon: "",
  };
}

test("ten bid tiers create ten campaigns with the same products, targets and budget", () => {
  const settings = tieredFixture();
  assert.deepEqual(validateAutomaticSetup(settings, "20260913"), []);
  const campaigns = generateAutomaticCampaigns(settings);
  assert.equal(campaigns.length, 10);
  assert.deepEqual(campaigns.map((campaign) => campaign.bid), [
    "0.50", "0.49", "0.48", "0.47", "0.46", "0.45", "0.44", "0.43", "0.42", "0.41",
  ]);
  assert.ok(campaigns.every((campaign) => campaign.dailyBudget === "20.00"));
  assert.ok(campaigns.every((campaign) => (
    campaign.skus.join(",") === "CANVAS-001,CANVAS-002"
    && campaign.targetingTypes.join(",") === "close-match,substitutes"
  )));
  const rows = buildAutomaticSpRows(settings, campaigns);
  assert.equal(rows.length, 60);
  assert.deepEqual(entityCounts(rows), {
    Campaign: 10,
    "Ad Group": 10,
    "Product Ad": 20,
    "Product Targeting": 20,
  });
  assert.deepEqual(validateAutomaticCampaigns(campaigns, settings.dailyBudget), []);
});

test("parses a full SKU list without sampling and removes only duplicates", () => {
  assert.deepEqual(
    parseSkuList(" SKU-1\nSKU-2\t sku-1 ; SKU-3,SKU-4 "),
    ["SKU-1", "SKU-2", "SKU-3", "SKU-4"],
  );
});

test("plans bids in exact cents and rejects a zero or negative last tier", () => {
  assert.deepEqual(planAutomaticBids("0.50", "0.01", "10"), [
    "0.50", "0.49", "0.48", "0.47", "0.46", "0.45", "0.44", "0.43", "0.42", "0.41",
  ]);
  assert.deepEqual(planAutomaticBids("0.03", "0.01", "4"), []);
  assert.deepEqual(planAutomaticBids("0.50", "0.01", "1e1"), []);
  assert.equal(combinationCount({ tierCount: "1e1" }), 0);
});

test("validates base bid, decrement and tier count before generation", () => {
  const settings = fixture();
  settings.baseBid = "0.03";
  settings.tierCount = "4";
  const issues = validateAutomaticSetup(settings, "20260913");
  assert.ok(issues.some((item) => item.path === "bidInterval" && /末档出价/.test(item.message)));
  settings.tierCount = "1.5";
  assert.ok(validateAutomaticSetup(settings, "20260913").some((item) => item.path === "tierCount"));
});

test("generates one campaign per tier with all SKUs and selected target types", () => {
  const settings = fixture();
  assert.deepEqual(validateAutomaticSetup(settings, "20260913"), []);
  const campaigns = generateAutomaticCampaigns(settings);
  assert.equal(campaigns.length, 2);
  assert.equal(new Set(campaigns.map((campaign) => campaign.temporaryId)).size, 2);
  assert.deepEqual(campaigns.map((campaign) => campaign.bid), ["0.50", "0.49"]);
  assert.ok(campaigns.every((campaign) => campaign.dailyBudget === "10.03"));
  assert.ok(campaigns.every((campaign) => campaign.skus.join(",") === "CANVAS-001,CANVAS-002"));
  assert.ok(campaigns.every((campaign) => campaign.targetingTypes.join(",") === "close-match,substitutes"));
  assert.deepEqual(validateAutomaticCampaigns(campaigns, settings.dailyBudget), []);
});

test("writes every SKU and target into each tier's campaign", () => {
  const settings = fixture();
  const campaigns = generateAutomaticCampaigns(settings);
  campaigns[0] = {
    ...campaigns[0],
    campaignName: "Edited automatic campaign",
    adGroupName: "Edited automatic ad group",
    bid: "0.44",
  };
  const rows = buildAutomaticSpRows(settings, campaigns);
  assert.equal(rows.length, 12);
  assert.deepEqual(entityCounts(rows), {
    Campaign: 2,
    "Ad Group": 2,
    "Product Ad": 4,
    "Product Targeting": 4,
  });
  assert.deepEqual(rows.slice(0, 6).map((row) => row.Entity), [
    "Campaign", "Ad Group", "Product Ad", "Product Ad", "Product Targeting", "Product Targeting",
  ]);
  assert.equal(rows[0]["Targeting Type"], "AUTO");
  assert.equal(rows[0]["Campaign Name"], "Edited automatic campaign");
  assert.equal(rows[0]["Daily Budget"], 10.03);
  assert.equal(rows[1]["Ad Group Default Bid"], 0.44);
  assert.equal(rows[2].SKU, "CANVAS-001");
  assert.equal(rows[3].SKU, "CANVAS-002");
  assert.equal(rows[4].Bid, 0.44);
  assert.equal(rows[5].Bid, 0.44);
  assert.deepEqual(rows.slice(4, 6).map((row) => row["Product Targeting Expression"]), ["close-match", "substitutes"]);
  assert.equal(rows[6]["Daily Budget"], 10.03);
});

test("adds separate upfront negative keywords and negative products to every automatic ad group", () => {
  const settings = fixture();
  const campaigns = generateAutomaticCampaigns(settings);
  const negativeKeywords = [
    { id: "auto-negative-1", text: "poster", matchType: "negativeExact" },
    { id: "auto-negative-2", text: "framed", matchType: "negativePhrase" },
  ];
  const negativeProducts = [
    { id: "auto-product-1", asin: "b0abc12345" },
    { id: "auto-product-2", asin: "B0DEF67890" },
  ];
  const rows = buildAutomaticSpRows(settings, campaigns, negativeKeywords, negativeProducts);
  assert.equal(rows.length, 20);
  assert.equal(automaticOutputRowCount(campaigns, negativeKeywords, negativeProducts), 20);
  assert.deepEqual(entityCounts(rows), {
    Campaign: 2,
    "Ad Group": 2,
    "Product Ad": 4,
    "Product Targeting": 4,
    "Negative Keyword": 4,
    "Negative Product Targeting": 4,
  });
  assert.deepEqual(rows.slice(0, 10).map((row) => row.Entity), [
    "Campaign",
    "Ad Group",
    "Product Ad",
    "Product Ad",
    "Product Targeting",
    "Product Targeting",
    "Negative Keyword",
    "Negative Keyword",
    "Negative Product Targeting",
    "Negative Product Targeting",
  ]);
  assert.deepEqual(rows.slice(6, 8).map((row) => [row["Keyword Text"], row["Match Type"]]), [
    ["poster", "negativeExact"],
    ["framed", "negativePhrase"],
  ]);
  assert.deepEqual(rows.slice(8, 10).map((row) => row["Product Targeting Expression"]), [
    'asin="B0ABC12345"',
    'asin="B0DEF67890"',
  ]);
  assert.ok(rows.slice(6, 10).every((row) => row["Campaign ID"] === campaigns[0].temporaryId));
  assert.ok(rows.slice(6, 10).every((row) => row["Ad Group ID"] === `${campaigns[0].temporaryId}-AG`));
});

test("validates automatic negative-product ASINs and total expanded row count", () => {
  const issues = validateNegativeProducts([
    { id: "bad-asin", asin: "short" },
    { id: "duplicate-1", asin: "B0ABC12345" },
    { id: "duplicate-2", asin: "b0abc12345" },
  ]);
  assert.ok(issues.some((item) => item.path === "negativeProductAsin" && item.rowId === "bad-asin"));
  assert.equal(issues.filter((item) => item.path === "negativeProductDuplicate").length, 2);

  const campaigns = Array.from({ length: 10000 }, (_, index) => ({ id: `c-${index}`, skus: ["SKU-1"], targetingTypes: ["close-match"] }));
  const negatives = Array.from({ length: 7 }, (_, index) => ({
    id: `n-${index}`,
    text: `negative ${index}`,
    matchType: "negativeExact",
  }));
  assert.equal(validateAutomaticOutputSize(campaigns, negatives, []).length, 1);
});

test("one-click negative keyword cleanup keeps the first valid duplicate and normal rows", () => {
  const rows = [
    { id: "first", text: "poster", matchType: "negativeExact" },
    { id: "duplicate", text: " POSTER ", matchType: "negativeExact" },
    { id: "different-match", text: "poster", matchType: "negativePhrase" },
    { id: "invalid", text: "bad/name", matchType: "negativeExact" },
    { id: "blank", text: "", matchType: "negativeExact" },
  ];
  const result = removeProblemNegativeKeywordRows(rows);
  assert.equal(result.removedCount, 2);
  assert.deepEqual(result.rows.map((row) => row.id), ["first", "different-match", "blank"]);
  assert.deepEqual(validateNegativeKeywords(result.rows), []);
  assert.equal(removeProblemNegativeKeywordRows(result.rows).removedCount, 0);
});

test("one-click negative product cleanup removes bad ASINs, extra duplicates and overflow", () => {
  const uniqueRows = Array.from({ length: 1001 }, (_, index) => ({
    id: `product-${index}`,
    asin: `B${String(index).padStart(9, "0")}`,
  }));
  const rows = [
    { id: "bad", asin: "short" },
    uniqueRows[0],
    { id: "duplicate", asin: uniqueRows[0].asin.toLowerCase() },
    ...uniqueRows.slice(1),
    { id: "blank", asin: "" },
  ];
  const result = removeProblemNegativeProductRows(rows);
  assert.equal(result.removedCount, 3);
  assert.equal(result.rows.length, 1001);
  assert.equal(result.rows[0].id, "product-0");
  assert.equal(result.rows.at(-1).id, "blank");
  assert.ok(!result.rows.some((row) => row.id === "product-1000"));
  assert.deepEqual(validateNegativeProducts(result.rows), []);
});

test("writes automatic campaigns into the existing official workbook package", async () => {
  const settings = fixture();
  const campaigns = generateAutomaticCampaigns(settings);
  const source = await readFile(templatePath);
  const output = await createBulksheet(source, buildAutomaticSpRows(settings, campaigns));
  const metadata = await inspectGeneratedWorkbook(output, "automatic-sample.xlsx");
  assert.equal(metadata.valid, true);
  assert.equal(metadata.dataRowCount, 12);
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
  assert.equal(encoded.automatic.campaigns.length, 2);
  assert.equal(encoded.automatic.negativeKeywords.length, 1);
  assert.equal(encoded.automatic.negativeProducts.length, 1);
  assert.equal("startDate" in encoded.keyword.settings, false);
  assert.equal("startDate" in encoded.automatic.settings, false);
});

test("keeps old automatic inputs and exclusions but requires regeneration after legacy draft restore", () => {
  const restored = hydrateDraft({
    version: 4,
    keyword: { settings: {}, keywords: [] },
    automatic: {
      settings: {
        skuText: "CANVAS-001\nCANVAS-002",
        totalDailyBudget: "20.00",
        selectedTargetingTypes: ["close-match", "substitutes"],
        bidTiers: [
          { id: "old-1", label: "A", bid: "0.50" },
          { id: "old-2", label: "B", bid: "0.49" },
        ],
      },
      campaigns: [{ id: "old-campaign", sku: "CANVAS-001", targetingType: "close-match" }],
      negativeKeywords: [{ id: "old-negative", text: "irrelevant", matchType: "negativeExact" }],
    },
  });
  assert.equal(restored.automaticNeedsRegeneration, true);
  assert.equal(restored.automaticSettings.skuText, "CANVAS-001\nCANVAS-002");
  assert.equal(restored.automaticSettings.dailyBudget, "");
  assert.equal(restored.automaticSettings.tierCount, "2");
  assert.equal(restored.automaticCampaigns.length, 0);
  assert.equal(restored.automaticNegativeKeywords[0].text, "irrelevant");
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
    automaticNegativeKeywords: [{ id: "auto-negative-row", text: "private auto negative", matchType: "negativeExact" }],
    automaticNegativeProducts: [{ id: "auto-negative-product", asin: "B0ABC12345" }],
  });
  const envelope = await encryptDraft(value, "correct horse battery staple");
  assert.equal(isEncryptedDraft(envelope), true);
  assert.doesNotMatch(JSON.stringify(envelope), /PRIVATE-SKU|private keyword|private negative|B0ABC12345/);
  assert.deepEqual(await decryptDraft(envelope, "correct horse battery staple"), value);
  await assert.rejects(
    decryptDraft(envelope, "wrong password"),
    /密码错误或加密草稿已损坏/,
  );
});
