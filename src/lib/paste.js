const MATCH_ALIASES = new Map([
  ["exact", "exact"],
  ["精准", "exact"],
  ["精确", "exact"],
  ["精准匹配", "exact"],
  ["phrase", "phrase"],
  ["词组", "phrase"],
  ["词组匹配", "phrase"],
  ["broad", "broad"],
  ["广泛", "broad"],
  ["广泛匹配", "broad"],
]);

const NEGATIVE_MATCH_ALIASES = new Map([
  ["negativeexact", "negativeExact"],
  ["negative exact", "negativeExact"],
  ["精准否定", "negativeExact"],
  ["精确否定", "negativeExact"],
  ["negativephrase", "negativePhrase"],
  ["negative phrase", "negativePhrase"],
  ["词组否定", "negativePhrase"],
]);

function looksLikeHeader(parts) {
  const joined = parts.join(" ").toLowerCase();
  return /keyword|关键词/.test(joined) && /match|匹配|bid|出价/.test(joined);
}

export function parsePastedKeywords(text, defaults) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  const warnings = [];

  lines.forEach((line, index) => {
    const parts = line.includes("\t")
      ? line.split("\t").map((part) => part.trim())
      : line.split(",").map((part) => part.trim());
    if (index === 0 && looksLikeHeader(parts)) return;

    let keyword = parts[0] || "";
    let matchType = defaults.matchType;
    let bid = defaults.bid;

    if (parts.length >= 2) {
      const normalized = MATCH_ALIASES.get(parts[1].toLowerCase());
      if (normalized) matchType = normalized;
      else if (/^\d+(?:\.\d+)?$/.test(parts[1])) bid = parts[1];
      else warnings.push(`第 ${index + 1} 行无法识别匹配方式“${parts[1]}”`);
    }
    if (parts.length >= 3) bid = parts[2];

    rows.push({
      id: crypto.randomUUID(),
      text: keyword,
      matchType,
      bid,
    });
  });

  return { rows, warnings };
}

function looksLikeNegativeHeader(parts) {
  return /negative keyword|否定词|否定关键词/i.test(parts.join(" "));
}

export function parsePastedNegativeKeywords(text, defaultMatchType = "negativeExact") {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  const warnings = [];

  lines.forEach((line, index) => {
    const parts = line.includes("\t")
      ? line.split("\t").map((part) => part.trim())
      : line.split(",").map((part) => part.trim());
    if (index === 0 && looksLikeNegativeHeader(parts)) return;

    let matchType = defaultMatchType;
    if (parts[1]) {
      const normalized = NEGATIVE_MATCH_ALIASES.get(parts[1].toLowerCase());
      if (normalized) matchType = normalized;
      else warnings.push(`第 ${index + 1} 行无法识别否定方式“${parts[1]}”`);
    }

    rows.push({
      id: crypto.randomUUID(),
      text: parts[0] || "",
      matchType,
    });
  });

  return { rows, warnings };
}
