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

function cleanNamePart(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>:"/\\|?*^,]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-_\s]+$/g, "");
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

export function activeBidTiers(tiers) {
  return Array.isArray(tiers) ? tiers : [];
}

export function combinationCount(settings) {
  return parseSkuList(settings.skuText).length
    * (Array.isArray(settings.selectedTargetingTypes) ? settings.selectedTargetingTypes.length : 0)
    * activeBidTiers(settings.bidTiers).length;
}

export function allocateDailyBudgets(totalDailyBudget, count) {
  const totalCents = moneyToCents(totalDailyBudget);
  if (!Number.isInteger(count) || count <= 0 || totalCents === null || totalCents < count) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => (
    ((base + (index < remainder ? 1 : 0)) / 100).toFixed(2)
  ));
}

function automaticNames({ sku, targetingType, tierLabel, index }) {
  const prefix = `AUTO-${String(index + 1).padStart(4, "0")}`;
  const suffix = [sku, targetingType, tierLabel].map(cleanNamePart).filter(Boolean).join("-");
  const campaignName = `${prefix}-${suffix}`.slice(0, 128).replace(/[-_\s]+$/g, "");
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
  const tiers = activeBidTiers(settings.bidTiers);
  const count = skus.length * targetingTypes.length * tiers.length;
  const budgets = allocateDailyBudgets(settings.totalDailyBudget, count);
  if (!budgets.length) return [];

  const campaigns = [];
  for (const sku of skus) {
    for (const targetingType of targetingTypes) {
      for (const tier of tiers) {
        const index = campaigns.length;
        const names = automaticNames({
          sku,
          targetingType,
          tierLabel: String(tier.label).trim(),
          index,
        });
        campaigns.push({
          id: `auto-${index + 1}`,
          ...names,
          sku,
          targetingType,
          tierId: tier.id,
          tierLabel: String(tier.label).trim(),
          dailyBudget: budgets[index],
          bid: Number(tier.bid).toFixed(2),
          state: settings.state,
        });
      }
    }
  }
  return campaigns;
}

export function rebalanceAutomaticBudgets(campaigns, totalDailyBudget) {
  const budgets = allocateDailyBudgets(totalDailyBudget, campaigns.length);
  if (!budgets.length) return campaigns;
  return campaigns.map((campaign, index) => ({ ...campaign, dailyBudget: budgets[index] }));
}

export function validateAutomaticSetup(settings, today) {
  const issues = [];
  const skus = parseSkuList(settings.skuText);
  const selectedTypes = Array.isArray(settings.selectedTargetingTypes)
    ? settings.selectedTargetingTypes
    : [];
  const tiers = activeBidTiers(settings.bidTiers);

  if (!skus.length) issues.push(issue("skuText", "至少输入一个 Seller SKU"));
  if (skus.length > 1000) issues.push(issue("skuText", "单次最多处理 1,000 个 SKU"));
  if (!selectedTypes.length) issues.push(issue("selectedTargetingTypes", "至少选择一种自动投放类型"));
  if (selectedTypes.some((value) => !AUTO_TYPE_VALUES.has(value))) {
    issues.push(issue("selectedTargetingTypes", "包含模板不支持的自动投放类型"));
  }
  if (!tiers.length) issues.push(issue("bidTiers", "至少添加一个出价档位"));

  const tierLabels = new Map();
  for (const tier of tiers) {
    const label = String(tier.label ?? "").trim();
    if (!label) issues.push(issue("tierLabel", "档位名称不能为空", tier.id));
    if (!isPositiveMoney(tier.bid)) issues.push(issue("tierBid", "档位出价必须大于 0 且最多两位小数", tier.id));
    const key = label.toLocaleLowerCase();
    if (label && tierLabels.has(key)) {
      issues.push(issue("tierLabel", "档位名称不能重复", tier.id));
    } else if (label) {
      tierLabels.set(key, tier.id);
    }
  }

  if (!isPositiveMoney(settings.totalDailyBudget)) {
    issues.push(issue("totalDailyBudget", "总日预算必须大于 0 且最多两位小数"));
  } else {
    const count = skus.length * selectedTypes.length * tiers.length;
    const cents = moneyToCents(settings.totalDailyBudget);
    if (count > 10000) issues.push(issue("matrix", "单次最多生成 10,000 套自动广告"));
    if (count > 0 && cents < count) {
      issues.push(issue("totalDailyBudget", `总日预算至少需要 ${(count / 100).toFixed(2)}，确保每套活动分到正预算`));
    }
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
  if (!new Set(["enabled", "paused"]).has(settings.state)) {
    issues.push(issue("state", "初始状态必须是 enabled 或 paused"));
  }
  return issues;
}

export function validateAutomaticCampaigns(campaigns, totalDailyBudget) {
  const issues = [];
  if (!campaigns.length) {
    issues.push(issue("campaigns", "请先生成自动广告活动"));
    return issues;
  }

  let allocatedCents = 0;
  const ids = new Set();
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
    if (!String(campaign.sku ?? "").trim()) issues.push(issue("sku", "Seller SKU 不能为空", campaign.id));
    if (!AUTO_TYPE_VALUES.has(campaign.targetingType)) {
      issues.push(issue("targetingType", "自动投放类型不受模板支持", campaign.id));
    }
    if (!isPositiveMoney(campaign.bid)) issues.push(issue("bid", "出价必须大于 0 且最多两位小数", campaign.id));
    const budgetCents = moneyToCents(campaign.dailyBudget);
    if (!isPositiveMoney(campaign.dailyBudget)) {
      issues.push(issue("dailyBudget", "日预算必须大于 0 且最多两位小数", campaign.id));
    } else {
      allocatedCents += budgetCents;
    }
    if (!new Set(["enabled", "paused"]).has(campaign.state)) {
      issues.push(issue("state", "状态必须是 enabled 或 paused", campaign.id));
    }
  }

  const expectedCents = moneyToCents(totalDailyBudget);
  if (expectedCents !== null && allocatedCents !== expectedCents) {
    issues.unshift(issue(
      "budgetAllocation",
      `活动预算合计 ${(allocatedCents / 100).toFixed(2)}，应等于总日预算 ${(expectedCents / 100).toFixed(2)}`,
    ));
  }
  return issues;
}

function emptyRow(entity) {
  return { Product: "Sponsored Products", Entity: entity, Operation: "Create" };
}

export function automaticOutputRowCount(campaigns, negativeKeywords = [], negativeProducts = []) {
  const perCampaign = 4
    + activeNegativeKeywords(negativeKeywords).length
    + activeNegativeProducts(negativeProducts).length;
  return campaigns.length * perCampaign;
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
    rows.push({
      ...emptyRow("Product Ad"),
      "Campaign ID": campaignId,
      "Ad Group ID": adGroupId,
      State: campaign.state,
      SKU: String(campaign.sku).trim(),
    });
    rows.push({
      ...emptyRow("Product Targeting"),
      "Campaign ID": campaignId,
      "Ad Group ID": adGroupId,
      State: campaign.state,
      Bid: normalizeMoney(campaign.bid),
      "Product Targeting Expression": campaign.targetingType,
    });

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

export function allocatedBudget(campaigns) {
  return campaigns.reduce((sum, campaign) => sum + (moneyToCents(campaign.dailyBudget) || 0), 0) / 100;
}
