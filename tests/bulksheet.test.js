import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import JSZip from "jszip";

import { SP_HEADERS } from "../src/lib/constants.js";
import {
  buildSpRows,
  createBulksheet,
  entityCounts,
  inspectGeneratedWorkbook,
  inspectTemplate,
  TEMPLATE_LIMITS,
} from "../src/lib/bulksheet.js";
import { validateAll } from "../src/lib/validation.js";

const templatePath = new URL("../reference/AdvertisingBulksheetTemplate-seller.xlsx", import.meta.url);

function validFixture() {
  return {
    settings: {
      sku: "CANVAS-SKU-001",
      dailyBudget: "20.00",
      pasteDefaultMatchType: "exact",
      pasteDefaultBid: "0.50",
      startDate: "20260901",
      endDate: "",
      biddingStrategy: "Dynamic bids - down only",
      state: "paused",
      portfolioId: "",
      offAmazon: "",
    },
    keywords: [
      { id: "k1", text: "abstract wall art", matchType: "exact", bid: "0.68" },
      { id: "k2", text: "neutral wall decor", matchType: "phrase", bid: "0.54" },
      { id: "k3", text: "large canvas art", matchType: "broad", bid: "0.42" },
    ],
  };
}

test("recognizes the supplied official workbook and all 32 SP headers", async () => {
  const bytes = await readFile(templatePath);
  const metadata = await inspectTemplate(bytes, "template.xlsx");
  assert.equal(metadata.valid, true);
  assert.deepEqual(metadata.headers, SP_HEADERS);
  assert.equal(metadata.dataRowCount, 0);
});

test("rejects an oversized template before parsing it", async () => {
  const oversized = new Uint8Array(TEMPLATE_LIMITS.maxFileBytes + 1);
  const metadata = await inspectTemplate(oversized, "oversized.xlsx");
  assert.equal(metadata.valid, false);
  assert.match(metadata.error, /5 MB/);
});

test("rejects an XLSX archive with an excessive number of entries", async () => {
  const zip = new JSZip();
  for (let index = 0; index <= TEMPLATE_LIMITS.maxZipEntries; index += 1) {
    zip.file(`entry-${index}.xml`, "");
  }
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const metadata = await inspectGeneratedWorkbook(bytes, "too-many-entries.xlsx");
  assert.equal(metadata.valid, false);
  assert.match(metadata.error, /文件数量/);
});

test("rejects a modified workbook before parsing untrusted package content", async () => {
  const source = new Uint8Array(await readFile(templatePath));
  source[source.length - 1] ^= 0xff;
  const metadata = await inspectTemplate(source, "modified-template.xlsx");
  assert.equal(metadata.valid, false);
  assert.match(metadata.error, /可信摘要/);
});

test("creates one isolated campaign structure for every keyword", () => {
  const fixture = validFixture();
  const rows = buildSpRows(fixture.settings, fixture.keywords);
  assert.equal(rows.length, 12);
  assert.deepEqual(entityCounts(rows), {
    Campaign: 3,
    "Ad Group": 3,
    "Product Ad": 3,
    Keyword: 3,
  });
  assert.deepEqual(
    rows.map((row) => row.Entity),
    [
      "Campaign", "Ad Group", "Product Ad", "Keyword",
      "Campaign", "Ad Group", "Product Ad", "Keyword",
      "Campaign", "Ad Group", "Product Ad", "Keyword",
    ],
  );
  assert.deepEqual(
    rows.filter((row) => row.Entity === "Campaign").map((row) => row["Campaign ID"]),
    ["abstract wall art-exact", "neutral wall decor-phrase", "large canvas art-broad"],
  );
  assert.deepEqual(
    rows.filter((row) => row.Entity === "Ad Group").map((row) => row["Ad Group ID"]),
    ["abstract wall art-exact", "neutral wall decor-phrase", "large canvas art-broad"],
  );
  assert.equal(rows[0]["Campaign Name"], "abstract wall art-exact");
  assert.equal(rows[0]["Campaign ID"], rows[0]["Campaign Name"]);
  assert.equal(rows[1]["Ad Group Name"], "abstract wall art-exact");
  assert.equal(rows[1]["Ad Group ID"], rows[1]["Ad Group Name"]);
  assert.equal(rows[1]["Ad Group Default Bid"], 0.68);
  assert.equal(rows[2].SKU, "CANVAS-SKU-001");
  assert.equal(rows[3]["Keyword Text"], "abstract wall art");
  assert.equal(rows[3]["Match Type"], "exact");
  assert.equal(rows[3].State, "paused");
});

test("applies an independent negative-keyword batch to every generated ad group", () => {
  const fixture = validFixture();
  fixture.keywords = fixture.keywords.slice(0, 2);
  const negativeKeywords = [
    { id: "n1", text: "poster", matchType: "negativeExact" },
    { id: "n2", text: "framed", matchType: "negativePhrase" },
  ];

  const rows = buildSpRows(fixture.settings, fixture.keywords, negativeKeywords);
  assert.equal(rows.length, 12);
  assert.deepEqual(entityCounts(rows), {
    Campaign: 2,
    "Ad Group": 2,
    "Product Ad": 2,
    Keyword: 2,
    "Negative Keyword": 4,
  });
  const negativeRows = rows.filter((row) => row.Entity === "Negative Keyword");
  assert.deepEqual(
    negativeRows.map((row) => ({
      campaignId: row["Campaign ID"],
      adGroupId: row["Ad Group ID"],
      text: row["Keyword Text"],
      matchType: row["Match Type"],
      bid: row.Bid,
    })),
    [
      {
        campaignId: "abstract wall art-exact",
        adGroupId: "abstract wall art-exact",
        text: "poster",
        matchType: "negativeExact",
        bid: undefined,
      },
      {
        campaignId: "abstract wall art-exact",
        adGroupId: "abstract wall art-exact",
        text: "framed",
        matchType: "negativePhrase",
        bid: undefined,
      },
      {
        campaignId: "neutral wall decor-phrase",
        adGroupId: "neutral wall decor-phrase",
        text: "poster",
        matchType: "negativeExact",
        bid: undefined,
      },
      {
        campaignId: "neutral wall decor-phrase",
        adGroupId: "neutral wall decor-phrase",
        text: "framed",
        matchType: "negativePhrase",
        bid: undefined,
      },
    ],
  );
});

test("scales deterministically to 1,000 isolated campaign structures", () => {
  const fixture = validFixture();
  fixture.keywords = Array.from({ length: 1000 }, (_, index) => ({
    id: `k${index}`,
    text: `keyword ${index + 1}`,
    matchType: "exact",
    bid: "0.50",
  }));
  const rows = buildSpRows(fixture.settings, fixture.keywords);
  assert.equal(rows.length, 4000);
  assert.equal(new Set(rows.filter((row) => row.Entity === "Campaign").map((row) => row["Campaign ID"])).size, 1000);
  assert.equal(rows.at(-4)["Campaign ID"], "keyword 1000-exact");
  assert.equal(rows.at(-1)["Ad Group ID"], "keyword 1000-exact");
});

test("flags duplicate keyword-match pairs and derived IDs that do not start with a letter", async () => {
  const fixture = validFixture();
  fixture.keywords.push({ ...fixture.keywords[0], id: "k4" });
  fixture.keywords.push({ id: "k5", text: "123 wall art", matchType: "exact", bid: "0.50" });
  const bytes = await readFile(templatePath);
  const template = await inspectTemplate(bytes, "template.xlsx");
  const issues = validateAll(fixture.settings, fixture.keywords, [], template, "20260901");
  assert.ok(issues.some((item) => item.path === "temporaryId" && item.rowId === "k5"));
  assert.equal(issues.filter((item) => item.path === "duplicate").length, 2);
});

test("validates duplicate and malformed rows in the independent negative-keyword batch", async () => {
  const fixture = validFixture();
  const negativeKeywords = [
    { id: "n1", text: "invalid,negative", matchType: "broad" },
    { id: "n2", text: "poster", matchType: "negativeExact" },
    { id: "n3", text: "POSTER", matchType: "negativeExact" },
  ];
  const bytes = await readFile(templatePath);
  const template = await inspectTemplate(bytes, "template.xlsx");
  const issues = validateAll(
    fixture.settings,
    fixture.keywords,
    negativeKeywords,
    template,
    "20260901",
  );
  assert.ok(issues.some((item) => item.path === "negativeText" && item.rowId === "n1"));
  assert.ok(issues.some((item) => item.path === "negativeMatchType" && item.rowId === "n1"));
  assert.equal(issues.filter((item) => item.path === "negativeDuplicate").length, 2);
});

test("writes generated rows while preserving the workbook package and hidden Config sheet", async () => {
  const fixture = validFixture();
  const negativeKeywords = [{ id: "n1", text: "poster", matchType: "negativePhrase" }];
  const sourceBytes = await readFile(templatePath);
  const sourceZip = await JSZip.loadAsync(sourceBytes);
  const rows = buildSpRows(fixture.settings, fixture.keywords, negativeKeywords);
  const output = await createBulksheet(sourceBytes, rows);
  const outputZip = await JSZip.loadAsync(output);

  assert.deepEqual(Object.keys(outputZip.files).sort(), Object.keys(sourceZip.files).sort());
  const metadata = await inspectGeneratedWorkbook(output, "generated.xlsx");
  assert.equal(metadata.valid, true);
  assert.equal(metadata.dataRowCount, 15);
  const workbookXml = await outputZip.file("xl/workbook.xml").async("string");
  assert.match(workbookXml, /name="Config"[^>]*state="veryHidden"/);

  const sheetXml = await outputZip.file(metadata.sheetPath).async("string");
  assert.match(sheetXml, /<dimension[^>]*ref="A1:AF16"/);
  assert.match(sheetXml, /<t>abstract wall art-exact<\/t>/);
  assert.match(sheetXml, /<t>abstract wall art<\/t>/);
  assert.match(sheetXml, /<t>exact<\/t>/);
  assert.match(sheetXml, /<v>0\.68<\/v>/);
  assert.match(sheetXml, /<t>Negative Keyword<\/t>/);
  assert.match(sheetXml, /<t>poster<\/t>/);
  assert.match(sheetXml, /<t>negativePhrase<\/t>/);
});
