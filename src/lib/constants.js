export const SP_SHEET_NAME = "Sponsored Products Campaigns";

export const SP_HEADERS = [
  "Product",
  "Entity",
  "Operation",
  "Campaign ID",
  "Ad Group ID",
  "Portfolio ID",
  "Ad ID",
  "Keyword ID",
  "Product Targeting ID",
  "Campaign Name",
  "Ad Group Name",
  "Start Date",
  "End Date",
  "Targeting Type",
  "State",
  "Daily Budget",
  "SKU",
  "Ad Group Default Bid",
  "Bid",
  "Keyword Text",
  "Native Language Keyword",
  "Native Language Locale",
  "Match Type",
  "Bidding Strategy",
  "Placement",
  "Percentage",
  "Product Targeting Expression",
  "Audience ID",
  "Shopper Cohort Percentage",
  "Shopper Cohort Type",
  "Sites",
  "Off-Amazon ad serving",
];

export const MATCH_TYPES = [
  { value: "exact", label: "精准匹配 · exact" },
  { value: "phrase", label: "词组匹配 · phrase" },
  { value: "broad", label: "广泛匹配 · broad" },
];

export const BIDDING_STRATEGIES = [
  "Dynamic bids - down only",
  "Dynamic bids - up and down",
  "Fixed bid",
];

export const ENTITY_LABELS = {
  Campaign: "Campaign",
  "Ad Group": "Ad Group",
  "Product Ad": "Product Ad",
  Keyword: "Keyword",
};

export const DEFAULT_TEMPLATE_URL = "./AdvertisingBulksheetTemplate-seller.xlsx";

export const EMPTY_KEYWORD = () => ({
  id: crypto.randomUUID(),
  text: "",
  matchType: "exact",
  bid: "",
});

export function todayYmd() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function defaultBatchSettings() {
  return {
    sku: "",
    dailyBudget: "",
    pasteDefaultMatchType: "exact",
    pasteDefaultBid: "",
    startDate: todayYmd(),
    endDate: "",
    biddingStrategy: BIDDING_STRATEGIES[0],
    state: "paused",
    portfolioId: "",
    offAmazon: "",
  };
}

export const DRAFT_STORAGE_KEY = "amazon-sp-bulksheet-builder:draft:v2";
