import JSZip from "jszip";
import {
  SP_HEADERS,
  SP_SHEET_NAME,
} from "./constants.js";
import { activeKeywords, normalizeMoney } from "./validation.js";
import { generatedNames } from "./naming.js";

export const TEMPLATE_LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxZipEntries: 200,
  maxUncompressedBytes: 25 * 1024 * 1024,
});

function assertSafeTemplateArchive(zip) {
  const entries = Object.values(zip.files);
  if (entries.length > TEMPLATE_LIMITS.maxZipEntries) {
    throw new Error(`模板压缩包文件数量不能超过 ${TEMPLATE_LIMITS.maxZipEntries} 个`);
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const size = Number(entry?._data?.uncompressedSize || 0);
    if (Number.isFinite(size) && size > 0) totalUncompressedBytes += size;
    if (totalUncompressedBytes > TEMPLATE_LIMITS.maxUncompressedBytes) {
      throw new Error("模板解压后不能超过 25 MB");
    }
  }
}

function assertSafeTemplateInput(input) {
  const isBinary = input instanceof ArrayBuffer || ArrayBuffer.isView(input);
  if (!isBinary || input.byteLength > TEMPLATE_LIMITS.maxFileBytes) {
    throw new Error("模板文件不能超过 5 MB");
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function unescapeXml(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attr(fragment, name) {
  const match = fragment.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? unescapeXml(match[1]) : null;
}

function normalizeZipPath(path) {
  const parts = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

async function resolveSheetPath(zip, sheetName) {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !relsXml) throw new Error("工作簿缺少必要的结构文件");

  const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?>(?:<\/sheet>)?/g) || [];
  const sheetTag = sheetTags.find((tag) => attr(tag, "name") === sheetName);
  if (!sheetTag) throw new Error(`未找到工作表：${sheetName}`);
  const relationId = attr(sheetTag, "r:id");
  if (!relationId) throw new Error("无法识别 SP 工作表关系");

  const relationTags = relsXml.match(/<Relationship\b[^>]*\/?>(?:<\/Relationship>)?/g) || [];
  const relationTag = relationTags.find((tag) => attr(tag, "Id") === relationId);
  const target = relationTag ? attr(relationTag, "Target") : null;
  if (!target) throw new Error("无法定位 SP 工作表文件");
  return normalizeZipPath(`xl/${target}`);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
  return items.map((item) => {
    const textParts = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return textParts.map((match) => unescapeXml(match[1])).join("");
  });
}

function parseRowCells(rowXml, sharedStrings) {
  const values = {};
  const cellTags = rowXml.match(/<c\b[^>]*>[\s\S]*?<\/c>/g) || [];
  for (const cellTag of cellTags) {
    const reference = attr(cellTag, "r");
    if (!reference) continue;
    const column = reference.replace(/\d+/g, "");
    const type = attr(cellTag, "t");
    let value = "";
    if (type === "inlineStr") {
      const match = cellTag.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      value = match ? unescapeXml(match[1]) : "";
    } else {
      const match = cellTag.match(/<v>([\s\S]*?)<\/v>/);
      const raw = match ? unescapeXml(match[1]) : "";
      value = type === "s" ? sharedStrings[Number(raw)] ?? "" : raw;
    }
    values[column] = value;
  }
  return values;
}

function columnLetter(index) {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cellXml(column, rowNumber, value) {
  if (value === "" || value === null || value === undefined) return "";
  const reference = `${column}${rowNumber}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  const text = String(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}" t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function rowXml(rowNumber, row) {
  const cells = SP_HEADERS.map((header, index) =>
    cellXml(columnLetter(index + 1), rowNumber, row[header]),
  ).join("");
  return `<row r="${rowNumber}">${cells}</row>`;
}

function emptyRow(entity) {
  return {
    Product: "Sponsored Products",
    Entity: entity,
    Operation: "Create",
  };
}

export function buildSpRows(settings, keywords) {
  const rows = [];
  for (const keyword of activeKeywords(keywords)) {
    const names = generatedNames(keyword);
    const campaignId = names.campaignName;
    const adGroupId = names.adGroupName;

    rows.push({
      ...emptyRow("Campaign"),
      "Campaign ID": campaignId,
      "Portfolio ID": settings.portfolioId.trim(),
      "Campaign Name": names.campaignName,
      "Start Date": settings.startDate.trim(),
      "End Date": settings.endDate.trim(),
      "Targeting Type": "MANUAL",
      State: settings.state,
      "Daily Budget": normalizeMoney(settings.dailyBudget),
      "Bidding Strategy": settings.biddingStrategy,
      "Off-Amazon ad serving": settings.offAmazon,
    });

    rows.push({
      ...emptyRow("Ad Group"),
      "Campaign ID": campaignId,
      "Ad Group ID": adGroupId,
      "Ad Group Name": names.adGroupName,
      State: settings.state,
      "Ad Group Default Bid": normalizeMoney(keyword.bid),
    });

    rows.push({
      ...emptyRow("Product Ad"),
      "Campaign ID": campaignId,
      "Ad Group ID": adGroupId,
      State: settings.state,
      SKU: settings.sku.trim(),
    });

    rows.push({
      ...emptyRow("Keyword"),
      "Campaign ID": campaignId,
      "Ad Group ID": adGroupId,
      State: settings.state,
      Bid: normalizeMoney(keyword.bid),
      "Keyword Text": keyword.text.trim(),
      "Match Type": keyword.matchType,
    });
  }

  return rows;
}

export function entityCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.Entity] = (counts[row.Entity] || 0) + 1;
    return counts;
  }, {});
}

export async function inspectTemplate(arrayBuffer, fileName = "template.xlsx") {
  const metadata = {
    fileName,
    buffer: arrayBuffer,
    valid: false,
    error: "",
    headers: [],
    dataRowCount: 0,
    sheetPath: "",
  };

  try {
    assertSafeTemplateInput(arrayBuffer);
    const zip = await JSZip.loadAsync(arrayBuffer);
    assertSafeTemplateArchive(zip);
    const sheetPath = await resolveSheetPath(zip, SP_SHEET_NAME);
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) throw new Error("无法读取 Sponsored Products 工作表");
    const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
    const sharedStrings = parseSharedStrings(sharedXml || "");
    const sheetData = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
    if (!sheetData) throw new Error("SP 工作表缺少 sheetData");
    const rows = sheetData[1].match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
    const headerRow = rows.find((row) => attr(row, "r") === "1");
    if (!headerRow) throw new Error("SP 工作表缺少表头行");
    const headerValues = parseRowCells(headerRow, sharedStrings);
    const headers = SP_HEADERS.map((_, index) => headerValues[columnLetter(index + 1)] || "");
    const mismatch = SP_HEADERS.findIndex((header, index) => header !== headers[index]);
    if (mismatch >= 0) {
      throw new Error(
        `模板第 ${mismatch + 1} 列应为“${SP_HEADERS[mismatch]}”，实际为“${headers[mismatch] || "空白"}”`,
      );
    }

    metadata.valid = true;
    metadata.headers = headers;
    metadata.dataRowCount = rows.filter((row) => attr(row, "r") !== "1").length;
    metadata.sheetPath = sheetPath;
  } catch (error) {
    metadata.error = error instanceof Error ? error.message : "模板无法识别";
  }

  return metadata;
}

export async function createBulksheet(arrayBuffer, rows) {
  assertSafeTemplateInput(arrayBuffer);
  const zip = await JSZip.loadAsync(arrayBuffer);
  assertSafeTemplateArchive(zip);
  const sheetPath = await resolveSheetPath(zip, SP_SHEET_NAME);
  const sheetFile = zip.file(sheetPath);
  const sheetXml = await sheetFile?.async("string");
  if (!sheetXml) throw new Error("无法读取 Sponsored Products 工作表");

  const sheetData = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!sheetData) throw new Error("SP 工作表缺少 sheetData");
  const existingRows = sheetData[1].match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  const headerRow = existingRows.find((row) => attr(row, "r") === "1");
  if (!headerRow) throw new Error("SP 工作表缺少表头行");

  const generatedRows = rows.map((row, index) => rowXml(index + 2, row)).join("");
  const nextSheetData = `<sheetData>${headerRow}${generatedRows}</sheetData>`;
  let nextXml = sheetXml.replace(sheetData[0], nextSheetData);
  const dimensionRef = `A1:AF${Math.max(1, rows.length + 1)}`;
  if (/<dimension\b[^>]*ref="[^"]*"[^>]*\/>/.test(nextXml)) {
    nextXml = nextXml.replace(
      /<dimension\b([^>]*?)ref="[^"]*"([^>]*?)\/>/,
      `<dimension$1ref="${dimensionRef}"$2/>`,
    );
  }

  zip.file(sheetPath, nextXml, { createFolders: false });
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function downloadBytes(bytes, fileName) {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(value) {
  return String(value || "campaign")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}
