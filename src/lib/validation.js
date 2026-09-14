import { BIDDING_STRATEGIES, MATCH_TYPES, NEGATIVE_MATCH_TYPES } from "./constants.js";
import { generatedStructureName } from "./naming.js";

const MATCH_VALUES = new Set(MATCH_TYPES.map((item) => item.value));
const NEGATIVE_MATCH_VALUES = new Set(NEGATIVE_MATCH_TYPES.map((item) => item.value));
const INVALID_KEYWORD_PATTERN = /[\/^,]|\.\./;

function issue(path, message, rowId = null) {
  return { path, message, rowId };
}

function isPositiveMoney(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return false;
  return Number(text) > 0;
}

function validDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{8}$/.test(text)) return false;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function compareYmd(left, right) {
  return String(left).localeCompare(String(right));
}

export function isBlankKeyword(row) {
  return !String(row.text ?? "").trim() && !String(row.bid ?? "").trim();
}

export function activeKeywords(keywords) {
  return keywords.filter((row) => !isBlankKeyword(row));
}

export function validateBatchSettings(settings, today) {
  const issues = [];
  const required = [["sku", "请输入 Seller SKU"]];

  for (const [field, message] of required) {
    if (!String(settings[field] ?? "").trim()) issues.push(issue(field, message));
  }

  if (!isPositiveMoney(settings.dailyBudget)) {
    issues.push(issue("dailyBudget", "日预算必须是大于 0、最多两位小数的数字"));
  }

  if (!validDate(settings.startDate)) {
    issues.push(issue("startDate", "开始日期必须使用 YYYYMMDD 格式"));
  } else if (today && compareYmd(settings.startDate, today) < 0) {
    issues.push(issue("startDate", "开始日期不能早于今天"));
  }

  if (settings.endDate) {
    if (!validDate(settings.endDate)) {
      issues.push(issue("endDate", "结束日期必须使用 YYYYMMDD 格式"));
    } else if (
      validDate(settings.startDate) &&
      compareYmd(settings.endDate, settings.startDate) < 0
    ) {
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

export function validateKeywords(keywords) {
  const issues = [];
  const rows = activeKeywords(keywords);
  const seen = new Map();

  if (rows.length === 0) {
    issues.push(issue("keywords", "至少需要一个关键词"));
    return issues;
  }
  if (rows.length > 10000) {
    issues.push(issue("keywords", "单次最多生成 10,000 套广告结构"));
  }

  for (const row of rows) {
    const keyword = String(row.text ?? "").trim();
    if (!keyword) {
      issues.push(issue("keywordText", "关键词不能为空", row.id));
    } else {
      if (keyword.length > 80) {
        issues.push(issue("keywordText", "关键词不能超过 80 个字符", row.id));
      }
      if (INVALID_KEYWORD_PATTERN.test(keyword)) {
        issues.push(
          issue("keywordText", "关键词不能包含 /、^、逗号或连续两个句点", row.id),
        );
      }
    }

    if (!MATCH_VALUES.has(row.matchType)) {
      issues.push(issue("matchType", "匹配方式必须是 exact、phrase 或 broad", row.id));
    }
    if (!isPositiveMoney(row.bid)) {
      issues.push(issue("bid", "出价必须是大于 0、最多两位小数的数字", row.id));
    }
    const structureName = generatedStructureName(row);
    if (keyword && !/^\p{L}/u.test(structureName)) {
      issues.push(
        issue(
          "temporaryId",
          "关键词加匹配方式后将作为临时 ID，必须以字母开头",
          row.id,
        ),
      );
    }
    const duplicateKey = structureName.toLocaleLowerCase();
    if (keyword && seen.has(duplicateKey)) {
      issues.push(issue("duplicate", "批量列表中关键词与匹配方式重复", row.id));
      const firstRowId = seen.get(duplicateKey);
      if (!issues.some((item) => item.path === "duplicate" && item.rowId === firstRowId)) {
        issues.push(issue("duplicate", "批量列表中关键词与匹配方式重复", firstRowId));
      }
    } else if (keyword) {
      seen.set(duplicateKey, row.id);
    }
  }

  return issues;
}

export function isBlankNegativeKeyword(row) {
  return !String(row.text ?? "").trim();
}

export function activeNegativeKeywords(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isBlankNegativeKeyword(row));
}

export function validateNegativeKeywords(negativeKeywords = []) {
  const issues = [];
  const rows = activeNegativeKeywords(negativeKeywords);
  const seen = new Map();

  for (const row of rows) {
    const keyword = String(row.text ?? "").trim();
    if (keyword.length > 80) {
      issues.push(issue("negativeText", "否定关键词不能超过 80 个字符", row.id));
    }
    if (INVALID_KEYWORD_PATTERN.test(keyword)) {
      issues.push(
        issue("negativeText", "否定关键词不能包含 /、^、逗号或连续两个句点", row.id),
      );
    }
    if (!NEGATIVE_MATCH_VALUES.has(row.matchType)) {
      issues.push(
        issue("negativeMatchType", "否定方式必须是 negativeExact 或 negativePhrase", row.id),
      );
    }

    const duplicateKey = `${keyword.toLocaleLowerCase()}|${row.matchType}`;
    if (seen.has(duplicateKey)) {
      issues.push(issue("negativeDuplicate", "否定词与否定方式重复", row.id));
      const firstRowId = seen.get(duplicateKey);
      if (!issues.some((item) => item.path === "negativeDuplicate" && item.rowId === firstRowId)) {
        issues.push(issue("negativeDuplicate", "否定词与否定方式重复", firstRowId));
      }
    } else {
      seen.set(duplicateKey, row.id);
    }
  }

  return issues;
}

export function isBlankNegativeProduct(row) {
  return !String(row?.asin ?? "").trim();
}

export function activeNegativeProducts(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isBlankNegativeProduct(row));
}

export function validateNegativeProducts(negativeProducts = []) {
  const issues = [];
  const rows = activeNegativeProducts(negativeProducts);
  const seen = new Map();

  if (rows.length > 1000) {
    issues.push(issue("negativeProducts", "单次最多添加 1,000 个否定商品 ASIN"));
  }

  for (const row of rows) {
    const asin = String(row.asin ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      issues.push(issue("negativeProductAsin", "ASIN 必须是 10 位字母或数字", row.id));
    }
    if (seen.has(asin)) {
      issues.push(issue("negativeProductDuplicate", "否定商品 ASIN 重复", row.id));
      const firstRowId = seen.get(asin);
      if (!issues.some((item) => item.path === "negativeProductDuplicate" && item.rowId === firstRowId)) {
        issues.push(issue("negativeProductDuplicate", "否定商品 ASIN 重复", firstRowId));
      }
    } else {
      seen.set(asin, row.id);
    }
  }

  return issues;
}

export function validateAll(settings, keywords, negativeKeywords, template, today) {
  const issues = [
    ...validateBatchSettings(settings, today),
    ...validateKeywords(keywords),
    ...validateNegativeKeywords(negativeKeywords),
  ];

  if (!template?.buffer) {
    issues.unshift(issue("template", "尚未加载官方模板"));
  } else if (!template.valid) {
    issues.unshift(issue("template", template.error || "模板结构无法识别"));
  } else if (template.dataRowCount > 0) {
    issues.unshift(issue("template", "第一版仅接受空白官方模板，请勿导入已有广告活动数据"));
  }

  return issues;
}

export function normalizeMoney(value) {
  return Number(Number(value).toFixed(2));
}
