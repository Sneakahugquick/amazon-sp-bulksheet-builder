import assert from "node:assert/strict";
import JSZip from "jszip";

// Read the exported workbook package independently of the campaign planner.
const decode = text => text.replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
  .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const column = reference => [...reference.replace(/\d+/g, "")].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;

export async function readReportWorkbook(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml").async("string");
  const relationships = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sheet = (workbook.match(/<sheet\b[^>]*>/g) || []).find(tag => attribute(tag, "name") === "Sponsored Products Campaigns");
  assert.ok(sheet, "Expected the SP worksheet");
  const relation = (relationships.match(/<Relationship\b[^>]*>/g) || []).find(tag => attribute(tag, "Id") === attribute(sheet, "r:id"));
  assert.ok(relation, "Expected the SP worksheet relationship");
  const target = attribute(relation, "Target");
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const xml = await zip.file(path).async("string");
  const strings = zip.file("xl/sharedStrings.xml") ? await zip.file("xl/sharedStrings.xml").async("string") : "";
  const shared = (strings.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || []).map(item => [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => decode(match[1])).join(""));
  const rows = (xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || []).map(row => {
    const cells = [];
    for (const cell of row.match(/<c\b[^>]*>[\s\S]*?<\/c>/g) || []) {
      const raw = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      const type = attribute(cell, "t");
      const text = type === "inlineStr" ? [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => decode(match[1])).join("") : type === "s" ? shared[Number(raw)] : decode(raw);
      cells[column(attribute(cell, "r"))] = { text };
    }
    return { cells };
  });
  return [{ sheetName: "Sponsored Products Campaigns", rows }];
}
