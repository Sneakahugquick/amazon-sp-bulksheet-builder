import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildAutomaticSpRows, generateAutomaticCampaigns, parseSkuList, validateAutomaticCampaigns, validateAutomaticSetup } from "../src/lib/automatic.js";
import { createBulksheet, entityCounts } from "../src/lib/bulksheet.js";
import { hydrateDraft } from "../src/lib/draft.js";
import { readReportWorkbook } from "./helpers/sp-workbook.js";

const templatePath = new URL("../reference/AdvertisingBulksheetTemplate-seller.xlsx", import.meta.url);
const fixture = (overrides = {}) => ({
  skuText: "QA-000001\nQA-000002\nQA-000003",
  dailyBudget: "12.37", selectedTargetingTypes: ["close-match", "substitutes"],
  baseBid: "0.50", bidInterval: "0.01", tierCount: "1",
  startDate: "20261003", endDate: "", biddingStrategy: "Dynamic bids - down only",
  state: "paused", portfolioId: "", offAmazon: "", ...overrides,
});
const negatives = [{ id: "negative-1", text: "irrelevant phrase", matchType: "negativePhrase" }];
const products = [{ id: "product-negative-1", asin: "B000000001" }];

function assertLinks(rows, settings) {
  const campaignRows = rows.filter(row => row.Entity === "Campaign");
  const expectedSkus = parseSkuList(settings.skuText);
  assert.equal(campaignRows.length, Number(settings.tierCount));
  for (const campaign of campaignRows) {
    const members = rows.filter(row => row["Campaign ID"] === campaign["Campaign ID"]);
    const groups = members.filter(row => row.Entity === "Ad Group");
    const ads = members.filter(row => row.Entity === "Product Ad");
    assert.equal(groups.length, 1);
    assert.deepEqual(ads.map(row => row.SKU), expectedSkus);
    assert.equal(new Set(ads.map(row => row.SKU)).size, expectedSkus.length);
    for (const row of members.filter(row => row.Entity !== "Campaign")) assert.equal(row["Ad Group ID"], groups[0]["Ad Group ID"]);
    assert.equal(Number(campaign["Daily Budget"]), Number(settings.dailyBudget));
  }
}

test("one bid tier keeps single and multiple SKUs in one Campaign and one Ad Group", () => {
  for (const skuText of ["QA-000001", fixture().skuText]) {
    const settings = fixture({ skuText });
    assert.deepEqual(validateAutomaticSetup(settings, "20261003"), []);
    const campaigns = generateAutomaticCampaigns(settings);
    assert.equal(campaigns.length, 1);
    assert.deepEqual(validateAutomaticCampaigns(campaigns, settings.dailyBudget, settings), []);
    assertLinks(buildAutomaticSpRows(settings, campaigns), settings);
  }
});

test("SKU count does not multiply tier campaigns, budget, targets or negatives", () => {
  for (const skuText of ["QA-000001", fixture().skuText]) {
    const settings = fixture({ skuText, tierCount: "3", state: "enabled" });
    const campaigns = generateAutomaticCampaigns(settings);
    const rows = buildAutomaticSpRows(settings, campaigns, negatives, products);
    assert.deepEqual(campaigns.map(c => c.bid), ["0.50", "0.49", "0.48"]);
    assert.deepEqual(entityCounts(rows), { Campaign: 3, "Ad Group": 3, "Product Ad": 3 * parseSkuList(skuText).length, "Product Targeting": 6, "Negative Keyword": 3, "Negative Product Targeting": 3 });
    assertLinks(rows, settings);
    assert.ok(rows.every(row => row.State === "enabled"));
    assert.ok(rows.filter(row => row.Entity === "Campaign").every(row => row["Bidding Strategy"] === settings.biddingStrategy));
    for (const campaign of campaigns) {
      const targets = rows.filter(row => row.Entity === "Product Targeting" && row["Campaign ID"] === campaign.temporaryId);
      assert.deepEqual(targets.map(row => row["Product Targeting Expression"]), settings.selectedTargetingTypes);
      assert.ok(targets.every(row => row.Bid === Number(campaign.bid)));
    }
  }
});

test("empty SKUs block generation and repeated SKUs create only one Product Ad per activity", () => {
  const empty = fixture({ skuText: " \n\t,;" });
  assert.deepEqual(generateAutomaticCampaigns(empty), []);
  assert.ok(validateAutomaticSetup(empty, "20261003").some(issue => issue.path === "skuText"));
  const settings = fixture({ skuText: " QA-000001\nQA-000002\nQA-000001\n \nQA-000002;QA-000003" });
  const campaigns = generateAutomaticCampaigns(settings);
  assert.deepEqual(campaigns[0].skus, ["QA-000001", "QA-000002", "QA-000003"]);
  assertLinks(buildAutomaticSpRows(settings, campaigns), settings);
});

test("restored per-SKU or incomplete campaigns are blocked until regenerated without altering the saved draft", () => {
  const settings = fixture();
  const parent = generateAutomaticCampaigns(settings)[0];
  const split = parent.skus.map((sku, index) => ({ ...parent, id: `split-${index}`, temporaryId: `SPLIT-${index}`, skus: [sku] }));
  const restored = hydrateDraft({ version: 4, automatic: { settings, campaigns: split } });
  const snapshot = JSON.stringify(restored.automaticCampaigns);
  const issues = validateAutomaticCampaigns(restored.automaticCampaigns, settings.dailyBudget, settings);
  assert.ok(issues.some(issue => issue.path === "campaigns"));
  assert.equal(issues.filter(issue => issue.path === "skus").length, 3);
  assert.equal(JSON.stringify(restored.automaticCampaigns), snapshot);
  assert.deepEqual(validateAutomaticCampaigns(generateAutomaticCampaigns(settings), settings.dailyBudget, settings), []);
  for (const skus of [["QA-000001"], ["QA-000001", "QA-000002", "QA-000002"], ["QA-000001", "QA-000002", "WRONG-SKU"]]) {
    assert.ok(validateAutomaticCampaigns([{ ...parent, skus }], settings.dailyBudget, settings).some(issue => issue.path === "skus"));
  }
  const edited = { ...parent, campaignName: "Reviewed campaign", adGroupName: "Reviewed group", bid: "0.44", skus: [...parent.skus].reverse() };
  assert.deepEqual(validateAutomaticCampaigns([edited], settings.dailyBudget, settings), []);
});

test("XLSX readback retains one Campaign, shared parent IDs, all SKUs and configured settings", async () => {
  const settings = fixture();
  const rows = buildAutomaticSpRows(settings, generateAutomaticCampaigns(settings), negatives, products);
  const output = await createBulksheet(await readFile(templatePath), rows);
  const sheets = await readReportWorkbook(output);
  const sp = sheets.find(sheet => sheet.sheetName === "Sponsored Products Campaigns");
  assert.ok(sp);
  const headers = sp.rows[0].cells.map(cell => cell?.text || "");
  const restored = sp.rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row.cells[index]?.text || ""])));
  assert.equal(restored.length, rows.length);
  assertLinks(restored, settings);
  assert.equal(restored.filter(row => row.Entity === "Campaign").length, 1);
  assert.equal(restored.filter(row => row.Entity === "Ad Group").length, 1);
  assert.ok(restored.every(row => row.Operation === "Create" && row.State === "paused"));
  assert.equal(restored.find(row => row.Entity === "Negative Keyword")["Match Type"], "negativePhrase");
  assert.equal(restored.find(row => row.Entity === "Negative Product Targeting")["Product Targeting Expression"], 'asin="B000000001"');
});

test("generating a separate batch does not merge or change prior batch SKUs", () => {
  const first = generateAutomaticCampaigns(fixture());
  const snapshot = JSON.stringify(first);
  const next = generateAutomaticCampaigns(fixture({ skuText: "NEXT-000001", tierCount: "2" }));
  assert.equal(JSON.stringify(first), snapshot);
  assert.ok(next.every(c => c.skus.length === 1 && c.skus[0] === "NEXT-000001"));
  assert.notEqual(first[0].skus, next[0].skus);
  assert.notEqual(next[0].skus, next[1].skus);
});
