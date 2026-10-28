import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { defaultAutomaticSettings, defaultBatchSettings, todayYmd } from "../src/lib/constants.js";
import { buildSpRows, createBulksheet, inspectTemplate } from "../src/lib/bulksheet.js";
import { keywordCampaignName } from "../src/lib/naming.js";
import { generateKeywordTiers, keywordCampaignNameMap, keywordTierPlanKey, validateKeywordSetup } from "../src/lib/keyword-campaigns.js";
import { buildAutomaticSpRows, generateAutomaticCampaigns, validateAutomaticCampaigns, validateAutomaticSetup } from "../src/lib/automatic.js";
import { hydrateDraft, serializeDraft } from "../src/lib/draft.js";
import { readReportWorkbook } from "./helpers/sp-workbook.js";

const templatePath = new URL("../reference/AdvertisingBulksheetTemplate-seller.xlsx", import.meta.url);
const templateMetadata = { buffer: new Uint8Array([1]), valid: true, dataRowCount: 0 };
const TODAY = "20261028";
const fannyPack = { id: "fp", text: "fanny pack", matchType: "broad", bid: "0.15" };
const terms = () => [
  { id: "kw-1", text: "gold art", matchType: "exact", bid: "0.68" },
  { id: "kw-2", text: "gold art", matchType: "phrase", bid: "0.61" },
  { id: "kw-3", text: "moon decor", matchType: "broad", bid: "0.42" },
];
const keywordSettings = (overrides = {}) => ({
  ...defaultBatchSettings(), sku: "QA-000001", dailyBudget: "10.00", startDate: TODAY, ...overrides,
});
const automaticSettings = (overrides = {}) => ({
  ...defaultAutomaticSettings(), skuText: "QA-000001\nQA-000002", dailyBudget: "10.00", baseBid: "0.50", tierCount: "2", startDate: TODAY, ...overrides,
});
const check = (settings, keywords = terms()) => validateKeywordSetup(settings, keywords, [], templateMetadata, TODAY);
const where = issues => issues.map(item => [item.path, item.rowId]);
const campaignNames = rows => rows.filter(row => row.Entity === "Campaign").map(row => row["Campaign Name"]);

test("a blank prefix with the default settings keeps the original names", () => {
  assert.equal(keywordCampaignName(keywordSettings(), fannyPack), "fanny pack-broad");
  assert.equal(keywordCampaignName({}, fannyPack), "fanny pack-broad");
  assert.deepEqual(campaignNames(buildSpRows(keywordSettings(), terms())), ["gold art-exact", "gold art-phrase", "moon decor-broad"]);
  assert.deepEqual(check(keywordSettings()), []);
  assert.deepEqual(generateAutomaticCampaigns(automaticSettings()).map(item => [item.temporaryId, item.campaignName, item.adGroupName]), [
    ["AUTO-0001-BID-0.50", "AUTO-0001-BID-0.50", "AUTO-0001-BID-0.50-AG"],
    ["AUTO-0002-BID-0.49", "AUTO-0002-BID-0.49", "AUTO-0002-BID-0.49-AG"],
  ]);
});

test("the prefix comes first and each preset orders keyword, match type, bid and date", () => {
  const cases = [
    [{}, "FP01-fanny pack-broad"],
    [{ namePattern: "match-keyword" }, "FP01-broad-fanny pack"],
    [{ namePattern: "keyword-match-bid" }, "FP01-fanny pack-broad-0.15"],
    [{ namePattern: "keyword-match-date" }, "FP01-fanny pack-broad-20261028"],
    [{ nameSeparator: "_" }, "FP01_fanny pack_broad"],
    [{ nameSeparator: "|" }, "FP01|fanny pack|broad"],
    [{ nameSeparator: " | " }, "FP01 | fanny pack | broad"],
    [{ nameSeparator: " ", nameMatchStyle: "upper" }, "FP01 fanny pack BROAD"],
    [{ nameMatchStyle: "short" }, "FP01-fanny pack-BR"],
  ];
  for (const [overrides, expected] of cases) {
    assert.equal(keywordCampaignName(keywordSettings({ namePrefix: "FP01", ...overrides }), fannyPack), expected);
  }
  assert.equal(keywordCampaignName(keywordSettings({ namePattern: "keyword-match-date", nameSeparator: "_" }), fannyPack), "fanny pack_broad_20261028");
  assert.equal(keywordCampaignName(keywordSettings({ namePrefix: "  FP01 \n- " }), fannyPack), "FP01-fanny pack-broad");
});

test("custom templates fill variables and drop the separator an empty prefix leaves behind", () => {
  const custom = (nameTemplate, namePrefix = "") => keywordCampaignName(keywordSettings({ namePattern: "custom", nameTemplate, namePrefix }), fannyPack, 6);
  assert.equal(custom("{前缀}_{匹配}_{关键词}_{日期}", "FP01"), "FP01_broad_fanny pack_20261028");
  assert.equal(custom("{前缀}_{匹配}_{关键词}_{日期}"), "broad_fanny pack_20261028");
  assert.equal(custom("{关键词}-{前缀}-{匹配}"), "fanny pack-broad");
  assert.equal(custom("{关键词}-{匹配}-{前缀}"), "fanny pack-broad");
  assert.equal(custom("SP_{前缀}_kw_{关键词}"), "SP_kw_fanny pack");
  assert.equal(custom("{前缀}-{序号}-{关键词}-{出价}", "Q4"), "Q4-0007-fanny pack-0.15");
});

test("prefix and template problems are reported once on the setting, not on every keyword row", () => {
  const twoExact = [
    { id: "a", text: "gold art", matchType: "exact", bid: "0.50" },
    { id: "b", text: "moon decor", matchType: "exact", bid: "0.50" },
  ];
  assert.deepEqual(where(check(keywordSettings({ namePattern: "custom", nameTemplate: "{前缀}-{匹配}", namePrefix: "FP" }), twoExact)), [["nameTemplate", null]]);
  assert.deepEqual(check(keywordSettings({ namePattern: "custom", nameTemplate: "{前缀}-{匹配}-{序号}", namePrefix: "FP" }), twoExact), []);
  assert.deepEqual(where(check(keywordSettings({ namePrefix: "2026Q4" }))), [["namePrefix", null]]);
  assert.deepEqual(where(check(keywordSettings({ namePattern: "custom", nameTemplate: "{日期}-{关键词}-{匹配}" }))), [["nameTemplate", null]]);
  assert.deepEqual(where(check(keywordSettings({ namePattern: "custom", nameTemplate: "{关键字}-{匹配}" }))), [["nameTemplate", null]]);
  assert.deepEqual(where(check(keywordSettings({ namePattern: "custom", nameTemplate: "  " }))), [["nameTemplate", null]]);
  assert.deepEqual(where(check(keywordSettings({ namePrefix: "P".repeat(41) }))), [["namePrefix", null]]);
});

test("row checks catch over-long names and keywords that start with a digit", () => {
  const longKeyword = { id: "long", text: "a".repeat(80), matchType: "phrase", bid: "0.50" };
  assert.deepEqual(where(check(keywordSettings({ namePrefix: "P".repeat(40), namePattern: "keyword-match-date" }), [longKeyword, fannyPack])), [["campaignName", "long"]]);
  const digit = { id: "digit", text: "3d wall art", matchType: "exact", bid: "0.50" };
  const issues = check(keywordSettings(), [digit]);
  assert.deepEqual(where(issues), [["temporaryId", "digit"]]);
  assert.match(issues[0].message, /前缀/);
  assert.deepEqual(check(keywordSettings({ namePrefix: "FP" }), [digit]), []);
});

test("waterfall names keep the tier format with the prefix in front", () => {
  const settings = keywordSettings({ creationMode: "waterfall", waterfallBaseBid: "0.50", waterfallTierCount: "2", namePrefix: "FP01" });
  settings.waterfallTiers = generateKeywordTiers(settings);
  settings.waterfallPlanKey = keywordTierPlanKey(settings);
  assert.deepEqual(check(settings), []);
  const rows = buildSpRows(settings, terms());
  assert.deepEqual(campaignNames(rows).slice(0, 3), ["FP01-KW-T0001-exact-BID-0.50", "FP01-KW-T0001-phrase-BID-0.50", "FP01-KW-T0001-broad-BID-0.50"]);
  assert.equal(rows[0]["Campaign ID"], rows[0]["Campaign Name"]);
  assert.equal(rows.find(row => row.Entity === "Ad Group")["Ad Group Name"], "FP01-KW-T0001-exact-BID-0.50-AG");
  assert.deepEqual(where(check({ ...settings, namePrefix: "2026" })), [["namePrefix", null]]);
});

test("automatic campaigns carry the prefix in the name and temporary ID", () => {
  const settings = automaticSettings({ namePrefix: "FP01" });
  assert.deepEqual(validateAutomaticSetup(settings, TODAY), []);
  const campaigns = generateAutomaticCampaigns(settings);
  assert.deepEqual(campaigns.map(item => item.campaignName), ["FP01-AUTO-0001-BID-0.50", "FP01-AUTO-0002-BID-0.49"]);
  assert.deepEqual(validateAutomaticCampaigns(campaigns, settings.dailyBudget, settings), []);
  const rows = buildAutomaticSpRows(settings, campaigns);
  assert.equal(rows[0]["Campaign ID"], "FP01-AUTO-0001-BID-0.50");
  assert.equal(rows[1]["Ad Group ID"], "FP01-AUTO-0001-BID-0.50-AG");
  assert.equal(rows[1]["Ad Group Name"], "FP01-AUTO-0001-BID-0.50-AG");
  assert.ok(validateAutomaticSetup({ ...settings, namePrefix: "2026" }, TODAY).some(item => item.path === "namePrefix"));
});

test("old drafts restore with the original naming and new drafts keep the naming settings", () => {
  const old = hydrateDraft({ version: 4, keyword: { settings: { sku: "OLD-1", dailyBudget: "10.00" }, keywords: [fannyPack] }, automatic: { settings: {} } });
  assert.equal(old.keywordSettings.namePrefix, "");
  assert.equal(old.keywordSettings.namePattern, "keyword-match");
  assert.equal(old.automaticSettings.namePrefix, "");
  assert.deepEqual(campaignNames(buildSpRows(old.keywordSettings, old.keywords)), ["fanny pack-broad"]);

  const saved = serializeDraft({
    keywordSettings: keywordSettings({ namePrefix: "FP01", namePattern: "custom", nameTemplate: "{前缀}_{关键词}_{匹配}", nameMatchStyle: "upper" }),
    keywords: [fannyPack], negativeKeywords: [],
    automaticSettings: automaticSettings({ namePrefix: "AUTO1" }), automaticCampaigns: [],
    automaticNegativeKeywords: [], automaticNegativeProducts: [],
  });
  const restored = hydrateDraft(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(campaignNames(buildSpRows(restored.keywordSettings, restored.keywords)), ["FP01_fanny pack_BROAD"]);
  assert.equal(restored.automaticSettings.namePrefix, "AUTO1");

  // A damaged draft must not quietly switch to a different naming scheme.
  const tampered = hydrateDraft({ version: 4, keyword: { settings: { ...saved.keyword.settings, namePattern: "bogus" }, keywords: [fannyPack] } });
  assert.ok(validateKeywordSetup(tampered.keywordSettings, tampered.keywords, [], templateMetadata, todayYmd()).some(item => item.path === "namePattern"));
});

test("the review table shows the same names that are exported", () => {
  const settings = keywordSettings({ namePrefix: "FP01", nameMatchStyle: "short" });
  const keywords = [...terms(), { id: "blank", text: "", matchType: "exact", bid: "" }];
  assert.deepEqual([...keywordCampaignNameMap(settings, keywords).values()], campaignNames(buildSpRows(settings, keywords)));
});

test("the exported XLSX carries the custom name in both Campaign Name and Campaign ID", async () => {
  const settings = keywordSettings({ namePrefix: "FP01", namePattern: "keyword-match-bid", nameSeparator: "_" });
  const bytes = await readFile(templatePath);
  const metadata = await inspectTemplate(bytes);
  assert.deepEqual(validateKeywordSetup(settings, terms(), [], metadata, TODAY), []);
  const [sheet] = await readReportWorkbook(await createBulksheet(bytes, buildSpRows(settings, terms())));
  const headers = sheet.rows[0].cells.map(cell => cell?.text || "");
  const rows = sheet.rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row.cells[index]?.text || ""])));
  const campaigns = rows.filter(row => row.Entity === "Campaign");
  assert.deepEqual(campaigns.map(row => row["Campaign Name"]), ["FP01_gold art_exact_0.68", "FP01_gold art_phrase_0.61", "FP01_moon decor_broad_0.42"]);
  assert.ok(campaigns.every(row => row["Campaign ID"] === row["Campaign Name"]));
  const ids = new Set(campaigns.map(row => row["Campaign ID"]));
  assert.ok(rows.every(row => ids.has(row["Campaign ID"])));
});
