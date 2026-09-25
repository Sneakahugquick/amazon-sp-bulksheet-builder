import {
  AUTO_TARGETING_TYPES,
  BIDDING_STRATEGIES,
} from "./constants.js";
import {
  activeNegativeKeywords,
  activeNegativeProducts,
  normalizeMoney,
} from "./validation.js";

const AUTO_TYPE_VALUES = new Set(AUTO_TARGETING_TYPES.map((item) => item.value));
const CAMPAIGN_STATES = new Set(["enabled", "paused"]);
const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;
export const MAX_AUTOMATIC_OUTPUT_ROWS = 100000;

function issue(path, message, rowId = null) {
  return { path, message, rowId };
}

function isPositiveMoney(value) {
  const text = String(value ?? "").trim();
  return MONEY_PATTERN.test(text) && Number(text) > 0;
}

function moneyToCents(value) {
  if (!MONEY_PATTERN.test(String(value ?? "").trim())) return null;
  return Math.round(Number(value) * 100);
}

function parseTierCount(value) {
  const text = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) && count <= 10000 ? count : null;
}

function validDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function parseSkuList(value) {
  const seen = new Set();
  const rows = [];
  for (const token of String(value ?? "").split(/[\r\n\t,;]+/)) {
    const sku = token.trim();
    if (!sku) continue;
    const key = sku.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(sku);
  }
  return rows;
}

export function combinationCount(settings) {
  return parseTierCount(settings.tierCount) ?? 0;
}

export function planAutomaticBids(baseBid, bidInterval, tierCount) {
  const baseCents = moneyToCents(baseBid);
  const intervalCents = moneyToCents(bidInterval);
  const count = parseTierCount(tierCount);
  if (baseCents === null || intervalCents === null || intervalCents <= 0
    || count === null
    || baseCents - (count - 1) * intervalCents <= 0) return [];
  return Array.from({ length: count }, (_, index) => (
    ((baseCents - index * intervalCents) / 100).toFixed(2)
  ));
}

function automaticNames({ bid, index }) {
  const prefix = `AUTO-${String(index + 1).padStart(4, "0")}`;
  const campaignName = `${prefix}-BID-${bid}`;
  return {
    temporaryId: campaignName,
    campaignName,
    adGroupName: `${campaignName}-AG`.slice(0, 255).replace(/[-_\s]+$/g, ""),
  };
}

export function generateAutomaticCampaigns(settings) {
  const skus = parseSkuList(settings.skuText);
  const targetingTypes = Array.isArray(settings.selectedTargetingTypes)
    ? settings.selectedTargetingTypes.filter((value) => AUTO_TYPE_VALUES.has(value))
    : [];
  const bids = planAutomaticBids(settings.baseBid, settings.bidInterval, settings.tierCount);
  if (!skus.length || !targetingTypes.length || !isPositiveMoney(settings.dailyBudget) || !bids.length) return [];

  return bids.map((bid, index) => ({
    id: `auto-${index + 1}`,
    ...automaticNames({ bid, index }),
    skus: [...skus],
    targetingTypes: [...targetingTypes],
    tierNumber: index + 1,
    dailyBudget: Number(settings.dailyBudget).toFixed(2),
    bid,
    state: settings.state,
  }));
}

export function validateAutomaticSetup(settings, today) {
  const issues = [];
  const skus = parseSkuList(settings.skuText);
  const selectedTypes = Array.isArray(settings.selectedTargetingTypes)
    ? settings.selectedTargetingTypes
    : [];
  const count = parseTierCount(settings.tierCount);

  if (!skus.length) issues.push(issue("skuText", "至少输入一个 Seller SKU"));
  if (skus.length > 1000) issues.push(issue("skuText", "单次最多处理 1,000 个 SKU"));
  if (!selectedTypes.length) issues.push(issue("selectedTargetingTypes", "至少选择一种自动投放类型"));
  if (selectedTypes.some((value) => !AUTO_TYPE_VALUES.has(value))) {
    issues.push(issue("selectedTargetingTypes", "包含模板不支持的自动投放类型"));
  }
  if (!isPositiveMoney(settings.dailyBudget)) {
    issues.push(issue("dailyBudget", "每个活动的日预算必须大于 0 且最多两位小数"));
  }
  if (!isPositiveMoney(settings.baseBid)) {
    issues.push(issue("baseBid", "基准点击出价必须大于 0 且最多两位小数"));
  }
  if (!isPositiveMoney(settings.bidInterval)) {
    issues.push(issue("bidInterval", "每档出价间隔必须大于 0 且最多两位小数"));
  }
  if (count === null) {
    issues.push(issue("tierCount", "档位数必须是 1–10,000 的整数"));
  }
  if (isPositiveMoney(settings.baseBid) && isPositiveMoney(settings.bidInterval)
    && count !== null
    && !planAutomaticBids(settings.baseBid, settings.bidInterval, count).length) {
    issues.push(issue("bidInterval", "末档出价必须大于 0，请减小档位数或出价间隔"));
  }
  if (count !== null
    && count * (2 + skus.length + selectedTypes.length) > MAX_AUTOMATIC_OUTPUT_ROWS) {
    issues.push(issue("tierCount", `当前设置将超过 ${MAX_AUTOMATIC_OUTPUT_ROWS.toLocaleString()} 行，请减少档位数或商品数`));
  }

  if (!validDate(settings.startDate)) {
    issues.push(issue("startDate", "开始日期必须使用 YYYYMMDD 格式"));
  } else if (today && String(settings.startDate).localeCompare(String(today)) < 0) {
    issues.push(issue("startDate", "开始日期不能早于今天"));
  }
  if (settings.endDate) {
    if (!validDate(settings.endDate)) {
      issues.push(issue("endDate", "结束日期必须使用 YYYYMMDD 格式"));
    } else if (validDate(settings.startDate) && String(settings.endDate).localeCompare(String(settings.startDate)) < 0) {
      issues.push(issue("endDate", "结束日期不能早于开始日期"));
    }
  }
  if (!BIDDING_STRATEGIES.includes(settings.biddingStrategy)) {
    issues.push(issue("biddingStrategy", "竞价策略不在当前模板允许范围内"));
  }
  if (!CAMPAIGN_STATES.has(settings.state)) {
    issues.push(issue("state", "初始状态必须是 enabled 或 paused"));
  }
  return issues;
}

export function validateAutomaticCampaigns(campaigns, dailyBudget) {
  const issues = [];
  if (!campaigns.length) {
    issues.push(issue("campaigns", "请先生成自动广告活动"));
    return issues;
  }

  const ids = new Set();
  const expectedBudgetCents = moneyToCents(dailyBudget);
  for (const campaign of campaigns) {
    if (!String(campaign.campaignName ?? "").trim()) {
      issues.push(issue("campaignName", "活动名称不能为空", campaign.id));
    } else if (String(campaign.campaignName).length > 128) {
      issues.push(issue("campaignName", "活动名称不能超过 128 个字符", campaign.id));
    }
    if (!String(campaign.adGroupName ?? "").trim()) {
      issues.push(issue("adGroupName", "广告组名称不能为空", campaign.id));
    } else if (String(campaign.adGroupName).length > 255) {
      issues.push(issue("adGroupName", "广告组名称不能超过 255 个字符", campaign.id));
    }
    if (!/^\p{L}/u.test(String(campaign.temporaryId ?? ""))) {
      issues.push(issue("temporaryId", "临时 ID 必须以字母开头", campaign.id));
    }
    const key = String(campaign.temporaryId).toLocaleLowerCase();
    if (ids.has(key)) issues.push(issue("temporaryId", "临时 ID 不能重复", campaign.id));
    ids.add(key);
    if (!Array.isArray(campaign.skus) || !campaign.skus.length
      || campaign.skus.some((sku) => !String(sku).trim())) {
      issues.push(issue("skus", "每个活动至少需要一个 Seller SKU", campaign.id));
    }
    if (!Array.isArray(campaign.targetingTypes) || !campaign.targetingTypes.length
      || campaign.targetingTypes.some((value) => !AUTO_TYPE_VALUES.has(value))) {
      issues.push(issue("targetingTypes", "每个活动至少需要一种有效自动投放类型", campaign.id));
    }
    if (!isPositiveMoney(campaign.bid)) issues.push(issue("bid", "出价必须大于 0 且最多两位小数", campaign.id));
    if (!isPositiveMoney(campaign.dailyBudget)) {
      issues.push(issue("dailyBudget", "日预算必须大于 0 且最多两位小数", campaign.id));
    } else if (expectedBudgetCents !== null && moneyToCents(campaign.dailyBudget) !== expectedBudgetCents) {
      issues.push(issue("dailyBudget", "每档活动的日预算须与上方设置相同", campaign.id));
    }
    if (!CAMPAIGN_STATES.has(campaign.state)) {
      issues.push(issue("state", "状态必须是 enabled 或 paused", campaign.id));
    }
  }

  return issues;
}

function emptyRow(entity) {
  return { Product: "Sponsored Products", Entity: entity, Operation: "Create" };
}

export function automaticOutputRowCount(campaigns, negativeKeywords = [], negativeProducts = []) {
  const negativesPerCampaign = activeNegativeKeywords(negativeKeywords).length
    + activeNegativeProducts(negativeProducts).length;
  return campaigns.reduce((sum, campaign) => sum + 2
    + (campaign.skus?.length || 0)
    + (campaign.targetingTypes?.length || 0)
    + negativesPerCampaign, 0);
}

export function validateAutomaticOutputSize(campaigns, negativeKeywords = [], negativeProducts = []) {
  const rows = automaticOutputRowCount(campaigns, negativeKeywords, negativeProducts);
  return rows > MAX_AUTOMATIC_OUTPUT_ROWS
    ? [issue("automaticOutputSize", `当前组合将生成 ${rows.toLocaleString()} 行，单次最多 ${MAX_AUTOMATIC_OUTPUT_ROWS.toLocaleString()} 行，请拆批导出`)]
    : [];
}

export function buildAutomaticSpRows(
  settings,
  campaigns,
  negativeKeywords = [],
  negativeProducts = [],
) {
  const rows = [];
  const activeKeywordNegatives = activeNegativeKeywords(negativeKeywords);
  const activeProductNegatives = activeNegativeProducts(negativeProducts);
  for (const campaign of campaigns) {
    const campaignId = campaign.temporaryId;
    const adGroupId = `${campaign.temporaryId}-AG`;
    rows.push({
      ...emptyRow("Campaign"),
      "Campaign ID": campaignId,
      "Portfolio ID": String(settings.portfolioId ?? "").trim(),
      "Campaign Name": String(campaign.campaignName).trim(),
      "Start Date": String(settings.startDate).trim(),
      "End Date": String(settings.endDate ?? "").trim(),
      "Targeting Type": "AUTO",
      State: campaign.state,
      "Daily Budget": normalizeMoney(campaign.dailyBudget),
      "Bidding Strategy": settings.biddingStrategy,
      "Off-Amazon ad serving": settings.offAmazon,
    });
    rows.push({
      ...emptyRow("Ad Group"),
      "Campaign ID": campaignId,
      "Ad Group ID": adGroupId,
      "Ad Group Name": String(campaign.adGroupName).trim(),
      State: campaign.state,
      "Ad Group Default Bid": normalizeMoney(campaign.bid),
    });
    for (const sku of campaign.skus) {
      rows.push({
        ...emptyRow("Product Ad"),
        "Campaign ID": campaignId,
        "Ad Group ID": adGroupId,
        State: campaign.state,
        SKU: String(sku).trim(),
      });
    }
    for (const targetingType of campaign.targetingTypes) {
      rows.push({
        ...emptyRow("Product Targeting"),
        "Campaign ID": campaignId,
        "Ad Group ID": adGroupId,
        State: campaign.state,
        Bid: normalizeMoney(campaign.bid),
        "Product Targeting Expression": targetingType,
      });
    }

    for (const negativeKeyword of activeKeywordNegatives) {
      rows.push({
        ...emptyRow("Negative Keyword"),
        "Campaign ID": campaignId,
        "Ad Group ID": adGroupId,
        State: campaign.state,
        "Keyword Text": String(negativeKeyword.text).trim(),
        "Match Type": negativeKeyword.matchType,
      });
    }

    for (const negativeProduct of activeProductNegatives) {
      rows.push({
        ...emptyRow("Negative Product Targeting"),
        "Campaign ID": campaignId,
        "Ad Group ID": adGroupId,
        State: campaign.state,
        "Product Targeting Expression": `asin="${String(negativeProduct.asin).trim().toUpperCase()}"`,
      });
    }
  }
  return rows;
}
