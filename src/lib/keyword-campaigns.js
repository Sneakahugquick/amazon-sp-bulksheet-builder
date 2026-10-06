import { MATCH_TYPES } from "./constants.js";
import { parseSkuList, planAutomaticBids } from "./automatic.js";
import { generatedNames } from "./naming.js";
import { activeKeywords, activeNegativeKeywords, validateAll } from "./validation.js";

export const MAX_KEYWORD_CAMPAIGNS = 10000;
export const MAX_KEYWORD_OUTPUT_ROWS = 100000;
const MATCH_VALUES = new Set(MATCH_TYPES.map((item) => item.value));
const issue = (path, message, rowId = null) => ({ path, message, rowId });

function moneyCents(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function tierCount(value) {
  const text = String(value ?? "").trim();
  const count = Number(text);
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(count) && count <= MAX_KEYWORD_CAMPAIGNS ? count : null;
}

export function keywordTierPlanKey(settings) {
  return JSON.stringify([settings.waterfallBaseBid, settings.waterfallBidInterval, settings.waterfallTierCount, settings.dailyBudget].map(value => String(value ?? "").trim()));
}

export function validateKeywordTierInputs(settings) {
  const issues = [];
  const base = moneyCents(settings.waterfallBaseBid);
  const interval = moneyCents(settings.waterfallBidInterval);
  const count = tierCount(settings.waterfallTierCount);
  if (base === null) issues.push(issue("waterfallBaseBid", "基准出价必须大于 0，最多两位小数"));
  if (interval === null) issues.push(issue("waterfallBidInterval", "递减间隔必须大于 0，最多两位小数"));
  if (count === null) issues.push(issue("waterfallTierCount", "档位数必须为 1–10,000 的整数"));
  if (base !== null && interval !== null && count !== null && base - (count - 1) * interval <= 0) {
    issues.push(issue("waterfallBidInterval", "末档出价必须大于 0，请减少档位或递减间隔"));
  }
  if (moneyCents(settings.dailyBudget) === null) issues.push(issue("dailyBudget", "档位初始日预算必须大于 0，最多两位小数"));
  return issues;
}

export function generateKeywordTiers(settings) {
  if (validateKeywordTierInputs(settings).length) return [];
  return planAutomaticBids(settings.waterfallBaseBid, settings.waterfallBidInterval, settings.waterfallTierCount).map((bid, index) => ({
    id: `keyword-tier-${index + 1}`,
    bid,
    dailyBudget: (moneyCents(settings.dailyBudget) / 100).toFixed(2),
  }));
}

export function keywordMatchGroups(keywords) {
  const grouped = new Map(MATCH_TYPES.map(item => [item.value, []]));
  for (const row of activeKeywords(keywords)) {
    if (MATCH_VALUES.has(row.matchType)) grouped.get(row.matchType).push(row);
  }
  return [...grouped].filter(([, rows]) => rows.length).map(([matchType, rows]) => ({ matchType, keywords: rows }));
}

export function keywordPlanSummary(settings, keywords, negativeKeywords = []) {
  const skus = parseSkuList(settings.sku);
  const groups = keywordMatchGroups(keywords);
  const waterfall = settings.creationMode === "waterfall";
  const tiers = Array.isArray(settings.waterfallTiers) ? settings.waterfallTiers : [];
  const sourceKeywordCount = activeKeywords(keywords).length;
  const campaignCount = waterfall ? tiers.length * groups.length : sourceKeywordCount;
  const keywordCount = waterfall ? tiers.length * groups.reduce((sum, group) => sum + group.keywords.length, 0) : sourceKeywordCount;
  const negativeCount = campaignCount * activeNegativeKeywords(negativeKeywords).length;
  const productAdCount = campaignCount * skus.length;
  const budgetCents = waterfall
    ? tiers.reduce((sum, tier) => sum + (moneyCents(tier?.dailyBudget) ?? 0), 0) * groups.length
    : (moneyCents(settings.dailyBudget) ?? 0) * campaignCount;
  return { skus, groups, sourceKeywordCount, campaignCount, keywordCount, negativeCount, productAdCount,
    totalRows: campaignCount * 2 + productAdCount + keywordCount + negativeCount,
    totalDailyBudget: Number.isSafeInteger(budgetCents) ? (budgetCents / 100).toFixed(2) : null };
}

export function validateKeywordPlan(settings, keywords, negativeKeywords = []) {
  const issues = [];
  const mode = settings.creationMode ?? "single";
  if (!["single", "waterfall"].includes(mode)) issues.push(issue("creationMode", "草稿的创建模式无效，请重新选择单档或瀑布出价"));
  const summary = keywordPlanSummary(settings, keywords, negativeKeywords);
  if (!summary.skus.length) issues.push(issue("sku", "至少输入一个 Seller SKU"));
  if (summary.skus.length > 1000) issues.push(issue("sku", "单次最多输入 1,000 个 SKU"));
  if (mode === "waterfall") {
    issues.push(...validateKeywordTierInputs(settings));
    const tiers = Array.isArray(settings.waterfallTiers) ? settings.waterfallTiers : [];
    if (tiers.length !== tierCount(settings.waterfallTierCount)) issues.push(issue("waterfallTiers", "档位数量与设置不一致，请重新生成出价档位"));
    if (settings.waterfallPlanKey !== keywordTierPlanKey(settings)) issues.push(issue("waterfallTiers", "档位生成条件已更改，请重新生成出价档位"));
    const ids = new Set();
    let previousBid = null;
    for (const tier of tiers) {
      const id = tier?.id;
      if (!id || ids.has(id)) issues.push(issue("waterfallTiers", "档位标识缺失或重复，请重新生成出价档位"));
      ids.add(id);
      const bid = moneyCents(tier?.bid);
      if (bid === null) issues.push(issue("tierBid", "档位出价必须大于 0，最多两位小数", id));
      if (bid !== null && previousBid !== null && bid >= previousBid) issues.push(issue("tierBid", "每档出价必须低于上一档", id));
      if (moneyCents(tier?.dailyBudget) === null) issues.push(issue("tierBudget", "每活动日预算必须大于 0，最多两位小数", id));
      previousBid = bid;
    }
  }
  if (summary.campaignCount > MAX_KEYWORD_CAMPAIGNS) issues.push(issue("waterfallTierCount", "单次最多创建 10,000 个活动，请减少档位或关键词"));
  if (summary.totalRows > MAX_KEYWORD_OUTPUT_ROWS) issues.push(issue("outputRows", "展开后的表格超过 100,000 行，请减少档位、SKU、关键词或否定词"));
  if (summary.totalDailyBudget === null) issues.push(issue("dailyBudget", "整批日预算超出支持范围，请减少预算或活动数量"));
  return issues;
}

export function validateKeywordSetup(settings, keywords, negativeKeywords, template, today) {
  return [...validateAll(settings, keywords, negativeKeywords, template, today), ...validateKeywordPlan(settings, keywords, negativeKeywords)];
}

export function keywordWaterfallNames(tier, index, matchType) {
  const campaignName = `KW-T${String(index + 1).padStart(4, "0")}-${matchType}-BID-${(moneyCents(tier.bid) / 100).toFixed(2)}`;
  return { campaignName, adGroupName: `${campaignName}-AG` };
}

export function buildKeywordCampaigns(settings, keywords, negativeKeywords = []) {
  // Check expansion limits before allocating Product Ad and Keyword rows.
  if (validateKeywordPlan(settings, keywords, negativeKeywords).length) return [];
  const { skus, groups } = keywordPlanSummary(settings, keywords, negativeKeywords);
  if (settings.creationMode !== "waterfall") {
    return activeKeywords(keywords).map(keyword => ({
      ...generatedNames(keyword), skus, keywords: [keyword], bid: keyword.bid, dailyBudget: settings.dailyBudget,
    }));
  }
  return settings.waterfallTiers.flatMap((tier, index) => groups.map(group => ({
    ...keywordWaterfallNames(tier, index, group.matchType), skus, matchType: group.matchType, tierNumber: index + 1,
    keywords: group.keywords.map(keyword => ({ ...keyword, bid: tier.bid })), bid: tier.bid, dailyBudget: tier.dailyBudget,
  })));
}
