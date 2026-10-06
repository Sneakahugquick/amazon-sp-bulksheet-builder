import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { defaultAutomaticSettings, defaultBatchSettings, SP_HEADERS, todayYmd } from "../src/lib/constants.js";
import { buildSpRows, createBulksheet, entityCounts, inspectTemplate } from "../src/lib/bulksheet.js";
import { generateKeywordTiers, keywordPlanSummary, keywordTierPlanKey, validateKeywordPlan, validateKeywordSetup } from "../src/lib/keyword-campaigns.js";
import { generateAutomaticCampaigns, validateAutomaticCampaigns } from "../src/lib/automatic.js";
import { decryptDraft, encryptDraft, hydrateDraft, serializeDraft } from "../src/lib/draft.js";
import { readReportWorkbook } from "./helpers/sp-workbook.js";

const templatePath = new URL("../reference/AdvertisingBulksheetTemplate-seller.xlsx", import.meta.url);
const templateMetadata = { buffer: new Uint8Array([1]), valid: true, dataRowCount: 0 };
const skus = ["QA-000001", "QA-000002", "000003"];
const terms = () => [
  { id: "kw-1", text: "gold art", matchType: "exact", bid: "0.68" },
  { id: "kw-2", text: "gold art", matchType: "phrase", bid: "0.61" },
  { id: "kw-3", text: "nature decor", matchType: "exact", bid: "0.54" },
  { id: "kw-4", text: "moon decor", matchType: "broad", bid: "0.42" },
];
const negatives = [
  { id: "neg-1", text: "irrelevant phrase", matchType: "negativePhrase" },
  { id: "neg-2", text: "poster", matchType: "negativeExact" },
];

function settings(overrides = {}) {
  const result = { ...defaultBatchSettings(), sku: skus.join("\n"), dailyBudget: "12.37", creationMode: "waterfall", waterfallBaseBid: "0.50", waterfallBidInterval: "0.01", waterfallTierCount: "3", ...overrides };
  result.waterfallTiers = generateKeywordTiers(result);
  result.waterfallPlanKey = keywordTierPlanKey(result);
  return result;
}

function customSettings() {
  const result = settings();
  result.waterfallTiers = result.waterfallTiers.map((tier, index) => ({ ...tier, bid: ["0.50", "0.39", "0.28"][index], dailyBudget: ["12.37", "8.23", "4.19"][index] }));
  return result;
}

function assertCampaignLinks(rows, expectedSkus) {
  const campaigns = rows.filter(row => row.Entity === "Campaign");
  assert.equal(new Set(campaigns.map(row => row["Campaign ID"])).size, campaigns.length);
  for (const campaign of campaigns) {
    const members = rows.filter(row => row["Campaign ID"] === campaign["Campaign ID"]);
    const groups = members.filter(row => row.Entity === "Ad Group");
    assert.equal(groups.length, 1);
    assert.deepEqual(members.filter(row => row.Entity === "Product Ad").map(row => row.SKU), expectedSkus);
    assert.ok(members.filter(row => row.Entity !== "Campaign").every(row => row["Ad Group ID"] === groups[0]["Ad Group ID"]));
    const keywords = members.filter(row => row.Entity === "Keyword");
    assert.equal(new Set(keywords.map(row => row["Match Type"])).size, 1);
  }
}

test("legacy single mode preserves keyword-match isolation, per-word bids and shared multiple SKUs", () => {
  const config = settings({ creationMode: "single" });
  const rows = buildSpRows(config, terms(), negatives);
  assert.deepEqual(entityCounts(rows), { Campaign: 4, "Ad Group": 4, "Product Ad": 12, Keyword: 4, "Negative Keyword": 8 });
  assert.deepEqual(rows.filter(row => row.Entity === "Keyword").map(row => row.Bid), [0.68, 0.61, 0.54, 0.42]);
  assert.deepEqual(rows.filter(row => row.Entity === "Campaign").map(row => row["Campaign ID"]), ["gold art-exact", "gold art-phrase", "nature decor-exact", "moon decor-broad"]);
  assertCampaignLinks(rows, skus);
  assert.equal(keywordPlanSummary(config, terms(), negatives).totalDailyBudget, "49.48");
});

test("one waterfall tier groups all exact keywords and SKUs into one Campaign and one Ad Group", () => {
  const config = settings({ waterfallTierCount: "1" });
  const keywords = terms().filter(row => row.matchType === "exact").map(row => ({ ...row, bid: "" }));
  assert.deepEqual(validateKeywordSetup(config, keywords, negatives, templateMetadata, todayYmd()), []);
  const rows = buildSpRows(config, keywords, negatives);
  assert.deepEqual(entityCounts(rows), { Campaign: 1, "Ad Group": 1, "Product Ad": 3, Keyword: 2, "Negative Keyword": 2 });
  assertCampaignLinks(rows, skus);
  assert.equal(rows[0]["Campaign Name"], "KW-T0001-exact-BID-0.50");
  assert.equal(keywordPlanSummary(config, keywords).totalDailyBudget, "12.37");
});

test("three waterfall tiers keep match types separate and repeat each keyword only once per tier", () => {
  const config = settings();
  const rows = buildSpRows(config, terms(), negatives);
  assert.deepEqual(entityCounts(rows), { Campaign: 9, "Ad Group": 9, "Product Ad": 27, Keyword: 12, "Negative Keyword": 18 });
  assert.equal(rows.length, 75);
  assertCampaignLinks(rows, skus);
  for (let index = 0; index < 3; index += 1) {
    const bid = [0.50, 0.49, 0.48][index];
    const prefix = `KW-T${String(index + 1).padStart(4, "0")}-`;
    const members = rows.filter(row => row["Campaign ID"].startsWith(prefix));
    assert.equal(members.filter(row => row.Entity === "Keyword").length, 4);
    assert.ok(members.filter(row => row.Entity === "Keyword").every(row => row.Bid === bid));
    assert.ok(members.filter(row => row.Entity === "Ad Group").every(row => row["Ad Group Default Bid"] === bid));
    assert.deepEqual(members.filter(row => row.Entity === "Negative Keyword").map(row => row["Match Type"]), Array.from({ length: 3 }, () => ["negativePhrase", "negativeExact"]).flat());
  }
});

test("custom tier bids and budgets are applied once per match campaign, independently of SKU count", () => {
  const config = customSettings();
  assert.deepEqual(validateKeywordPlan(config, terms(), negatives), []);
  for (const sku of [skus[0], skus.join("\n")]) {
    const current = { ...config, sku };
    const rows = buildSpRows(current, terms(), negatives);
    assert.equal(keywordPlanSummary(current, terms(), negatives).totalDailyBudget, "74.37");
    assert.equal(rows.filter(row => row.Entity === "Campaign").reduce((sum, row) => sum + row["Daily Budget"], 0).toFixed(2), "74.37");
    assert.deepEqual(rows.filter(row => row.Entity === "Ad Group").map(row => row["Ad Group Default Bid"]), [0.50, 0.50, 0.50, 0.39, 0.39, 0.39, 0.28, 0.28, 0.28]);
  }
});

test("duplicate SKUs produce one Product Ad per unique SKU and preserve text and leading zeros", () => {
  const config = settings({ sku: " QA-000001\nqa-000001\n000003;000003", waterfallTierCount: "1" });
  const rows = buildSpRows(config, [terms()[0]]);
  assertCampaignLinks(rows, ["QA-000001", "000003"]);
});

test("duplicate keyword-match pairs block both modes while the same term in another match type remains valid", () => {
  for (const creationMode of ["single", "waterfall"]) {
    const config = settings({ creationMode });
    const duplicate = [...terms(), { ...terms()[0], id: "duplicate", text: " GOLD ART " }];
    const issues = validateKeywordSetup(config, duplicate, [], templateMetadata, todayYmd());
    assert.equal(issues.filter(item => item.path === "duplicate").length, 2);
    assert.deepEqual(validateKeywordSetup(config, terms(), [], templateMetadata, todayYmd()), []);
  }
});

test("empty SKU or keyword inputs block export and do not create campaign rows", () => {
  const config = settings({ sku: " ;,\n\t" });
  assert.ok(validateKeywordPlan(config, terms()).some(item => item.path === "sku"));
  assert.deepEqual(buildSpRows(config, terms()), []);
  assert.ok(validateKeywordSetup(settings(), [{ id: "blank", text: "", matchType: "exact", bid: "" }], [], templateMetadata, todayYmd()).some(item => item.path === "keywords"));
  assert.deepEqual(buildSpRows(settings(), []), []);
});

test("invalid planning inputs never produce tiers, including nonpositive last bids and unsafe numbers", () => {
  for (const [field, value] of [["waterfallBaseBid", "0"], ["waterfallBaseBid", "0.001"], ["waterfallBaseBid", "99999999999999999999999"], ["waterfallBidInterval", "-0.01"], ["waterfallTierCount", "0"], ["waterfallTierCount", "1.5"], ["waterfallTierCount", "10001"], ["dailyBudget", "NaN"]]) {
    assert.deepEqual(generateKeywordTiers(settings({ [field]: value })), [], `${field}=${value}`);
  }
  assert.deepEqual(generateKeywordTiers(settings({ waterfallBaseBid: "0.02", waterfallTierCount: "3" })), []);
});

test("invalid individual tier bid or budget, ascending bids, stale plans and mismatched tier counts are blocked", () => {
  const cases = [
    config => { config.waterfallTiers[0].bid = "0"; },
    config => { config.waterfallTiers[1].bid = "0.501"; },
    config => { config.waterfallTiers[1].bid = "0.50"; },
    config => { config.waterfallTiers[0].dailyBudget = "-1"; },
    config => { config.waterfallTierCount = "4"; },
    config => { config.waterfallBaseBid = "0.60"; },
    config => { config.dailyBudget = "20.00"; },
    config => { config.waterfallTiers[1].id = config.waterfallTiers[0].id; },
  ];
  for (const mutate of cases) {
    const config = settings(); mutate(config);
    const snapshot = JSON.stringify(config);
    assert.ok(validateKeywordPlan(config, terms()).length);
    assert.deepEqual(buildSpRows(config, terms()), []);
    assert.equal(JSON.stringify(config), snapshot);
  }
});

test("large SKU expansions and excessive match-tier campaign counts are blocked before allocating output", () => {
  const manyKeywords = Array.from({ length: 1000 }, (_, index) => ({ ...terms()[0], id: `keyword-${index}`, text: `test term ${index}` }));
  const manySkus = Array.from({ length: 1000 }, (_, index) => `QA-${index}`).join("\n");
  const config = settings({ creationMode: "single", sku: manySkus });
  assert.ok(validateKeywordPlan(config, manyKeywords).some(item => item.path === "outputRows"));
  assert.deepEqual(buildSpRows(config, manyKeywords), []);
  const waterfall = settings({ waterfallTierCount: "4000", waterfallBaseBid: "50.00" });
  assert.ok(validateKeywordPlan(waterfall, terms()).some(item => item.path === "waterfallTierCount"));
  assert.deepEqual(buildSpRows(waterfall, terms()), []);
});

function draftValue(config = customSettings()) {
  const automaticSettings = { ...defaultAutomaticSettings(), skuText: "AUTO-QA-000001\nAUTO-QA-000002", dailyBudget: "10.00", baseBid: "0.50", tierCount: "1" };
  return serializeDraft({ keywordSettings: config, keywords: terms(), negativeKeywords: negatives, automaticSettings,
    automaticCampaigns: generateAutomaticCampaigns(automaticSettings), automaticNegativeKeywords: [], automaticNegativeProducts: [] });
}

test("legacy v2/v3/v4 single-mode drafts retain their mode, word bids and SKU", () => {
  const single = { sku: "OLD-QA-000001", dailyBudget: "12.37", biddingStrategy: "Fixed bid", state: "paused" };
  for (const version of [2, 3, 4]) {
    const value = version === 2 ? { version, settings: single, keywords: terms() } : { version, keyword: { settings: single, keywords: terms() } };
    const restored = hydrateDraft(value);
    assert.equal(restored.keywordSettings.creationMode, "single");
    assert.deepEqual(restored.keywords.map(row => row.bid), terms().map(row => row.bid));
    assert.deepEqual(entityCounts(buildSpRows(restored.keywordSettings, restored.keywords)), { Campaign: 4, "Ad Group": 4, "Product Ad": 4, Keyword: 4 });
  }
});

test("waterfall drafts preserve custom tiers and independent automatic settings, and revalidate after restore", () => {
  const value = draftValue();
  const restored = hydrateDraft(value);
  assert.deepEqual(restored.keywordSettings.waterfallTiers, customSettings().waterfallTiers);
  assert.equal(restored.keywordSettings.creationMode, "waterfall");
  assert.deepEqual(validateKeywordSetup(restored.keywordSettings, restored.keywords, restored.negativeKeywords, templateMetadata, todayYmd()), []);
  assert.deepEqual(validateAutomaticCampaigns(restored.automaticCampaigns, restored.automaticSettings.dailyBudget, restored.automaticSettings), []);
  assert.equal(keywordPlanSummary(restored.keywordSettings, restored.keywords).totalDailyBudget, "74.37");
  assert.equal(value.keyword.schemaVersion, 2);
  assert.equal("campaigns" in value.keyword, false);
  value.keyword.settings.waterfallTierCount = "4";
  const stale = hydrateDraft(value);
  assert.ok(validateKeywordPlan(stale.keywordSettings, stale.keywords).some(item => item.path === "waterfallTiers"));
  assert.deepEqual(buildSpRows(stale.keywordSettings, stale.keywords), []);
});

test("switching between single and waterfall modes retains source word bids and restores each mode's budget semantics", () => {
  const config = customSettings();
  const keywords = terms();
  const snapshot = JSON.stringify(keywords);
  for (const creationMode of ["single", "waterfall", "single", "waterfall"]) {
    const current = { ...config, creationMode };
    assert.deepEqual(validateKeywordSetup(current, keywords, negatives, templateMetadata, todayYmd()), []);
    const rows = buildSpRows(current, keywords, negatives);
    assert.equal(entityCounts(rows).Campaign, creationMode === "single" ? 4 : 9);
    assert.equal(keywordPlanSummary(current, keywords).totalDailyBudget, creationMode === "single" ? "49.48" : "74.37");
  }
  assert.equal(JSON.stringify(keywords), snapshot);
});

test("unknown or malformed cross-mode draft settings cannot silently fall back to a different export plan", () => {
  const value = draftValue();
  value.keyword.settings.creationMode = "automatic";
  const unknown = hydrateDraft(value);
  assert.equal(unknown.keywordSettings.creationMode, "automatic");
  assert.ok(validateKeywordPlan(unknown.keywordSettings, unknown.keywords).some(item => item.path === "creationMode"));
  assert.deepEqual(buildSpRows(unknown.keywordSettings, unknown.keywords), []);
  value.keyword.settings.creationMode = "waterfall";
  value.keyword.settings.waterfallTiers = [null, { bid: "0.30" }];
  const malformed = hydrateDraft(value);
  assert.ok(validateKeywordPlan(malformed.keywordSettings, malformed.keywords).length);
  assert.deepEqual(buildSpRows(malformed.keywordSettings, malformed.keywords), []);
});

test("encrypted waterfall drafts round-trip custom budgets, modes and independent automatic campaigns", async () => {
  const value = draftValue();
  const encrypted = await encryptDraft(value, "fictional-waterfall-qa");
  const restored = hydrateDraft(await decryptDraft(encrypted, "fictional-waterfall-qa"));
  assert.equal(restored.keywordSettings.creationMode, "waterfall");
  assert.deepEqual(restored.keywordSettings.waterfallTiers, value.keyword.settings.waterfallTiers);
  assert.deepEqual(validateKeywordSetup(restored.keywordSettings, restored.keywords, restored.negativeKeywords, templateMetadata, todayYmd()), []);
  assert.deepEqual(validateAutomaticCampaigns(restored.automaticCampaigns, restored.automaticSettings.dailyBudget, restored.automaticSettings), []);
});

test("real XLSX readback retains all shared SKU links, tier names, custom bids/budgets and negative match types", async () => {
  const config = customSettings();
  const bytes = await readFile(templatePath);
  const metadata = await inspectTemplate(bytes);
  assert.deepEqual(validateKeywordSetup(config, terms(), negatives, metadata, todayYmd()), []);
  const output = await createBulksheet(bytes, buildSpRows(config, terms(), negatives));
  const sheets = await readReportWorkbook(output);
  const sheet = sheets.find(item => item.sheetName === "Sponsored Products Campaigns");
  const headers = sheet.rows[0].cells.map(cell => cell?.text || "");
  assert.deepEqual(headers, SP_HEADERS);
  const rows = sheet.rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row.cells[index]?.text || ""])));
  assert.equal(rows.length, 75);
  assert.deepEqual(entityCounts(rows), { Campaign: 9, "Ad Group": 9, "Product Ad": 27, Keyword: 12, "Negative Keyword": 18 });
  assertCampaignLinks(rows, skus);
  assert.equal(rows.filter(row => row.Entity === "Campaign").reduce((sum, row) => sum + Number(row["Daily Budget"]), 0).toFixed(2), "74.37");
  for (const keyword of rows.filter(row => row.Entity === "Keyword")) {
    const bid = keyword["Campaign ID"].match(/-BID-(.+)$/)[1];
    assert.equal(Number(keyword.Bid), Number(bid));
  }
  assert.ok(rows.every(row => row.State === "paused"));
});
