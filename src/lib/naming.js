// Campaign naming for generated rows. New campaigns use their name as the temporary
// Campaign ID, so a name must be unique inside one file and start with a letter.

export const NAME_LIMITS = Object.freeze({ campaign: 128, prefix: 40, template: 120 });

export const NAME_TOKENS = [
  { key: "前缀", hint: "名称前缀" },
  { key: "关键词", hint: "关键词原文" },
  { key: "匹配", hint: "匹配方式" },
  { key: "出价", hint: "关键词出价，如 0.15" },
  { key: "日期", hint: "开始日期（今天），如 20261028" },
  { key: "序号", hint: "四位序号，如 0001" },
];

export const NAME_PATTERNS = [
  { value: "keyword-match", tokens: ["前缀", "关键词", "匹配"] },
  { value: "match-keyword", tokens: ["前缀", "匹配", "关键词"] },
  { value: "keyword-match-bid", tokens: ["前缀", "关键词", "匹配", "出价"] },
  { value: "keyword-match-date", tokens: ["前缀", "关键词", "匹配", "日期"] },
  { value: "custom", tokens: null },
];

export const NAME_SEPARATORS = [
  { value: "-", label: "- 短横线" },
  { value: "_", label: "_ 下划线" },
  { value: "|", label: "| 竖线" },
  { value: " | ", label: "| 竖线（两侧空格）" },
  { value: " ", label: "空格" },
];

export const NAME_MATCH_STYLES = [
  { value: "lower", label: "exact · phrase · broad" },
  { value: "upper", label: "EXACT · PHRASE · BROAD" },
  { value: "short", label: "EX · PH · BR" },
];

const TOKEN_KEYS = new Set(NAME_TOKENS.map((item) => item.key));
const PATTERN_VALUES = new Set(NAME_PATTERNS.map((item) => item.value));
const SEPARATOR_VALUES = new Set(NAME_SEPARATORS.map((item) => item.value));
const STYLE_VALUES = new Set(NAME_MATCH_STYLES.map((item) => item.value));
const TOKEN_LABELS = { 前缀: "前缀", 关键词: "关键词", 匹配: "匹配方式", 出价: "出价", 日期: "日期", 序号: "序号" };
const SHORT_MATCH = { exact: "EX", phrase: "PH", broad: "BR" };
const PROBE_KEYWORD = { text: "a", matchType: "exact", bid: "0.50" };
const fieldIssue = (path, message) => ({ path, message, rowId: null });

export function cleanNamePart(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-_\s]+$/g, "");
}

function cleanPrefix(value) {
  return cleanNamePart(value).replace(/[-_|\s]+$/g, "");
}

function finishName(value) {
  return cleanNamePart(value).replace(/[-_|\s]+$/g, "");
}

export function startsWithLetter(value) {
  return /^\p{L}/u.test(String(value ?? ""));
}

export function generatedStructureName(keyword) {
  const keywordText = cleanNamePart(keyword.text);
  const matchType = cleanNamePart(keyword.matchType);
  return `${keywordText}-${matchType}`;
}

export function namePatternLabel(value, separator = "-") {
  const pattern = NAME_PATTERNS.find((item) => item.value === value);
  if (!pattern) return "命名方案无效，请重新选择";
  if (!pattern.tokens) return "自定义模板";
  const label = pattern.tokens.map((token) => TOKEN_LABELS[token]).join(SEPARATOR_VALUES.has(separator) ? separator : "-");
  return pattern === NAME_PATTERNS[0] ? `${label}（默认）` : label;
}

export function presetTemplate(pattern, separator = "-") {
  const preset = NAME_PATTERNS.find((item) => item.value === pattern && item.tokens) ?? NAME_PATTERNS[0];
  return preset.tokens.map((token) => `{${token}}`).join(SEPARATOR_VALUES.has(separator) ? separator : "-");
}

// Splits a template into literal, token, literal, ..., literal. Unknown {..} stays literal text.
function parseTemplate(template) {
  const text = String(template);
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!TOKEN_KEYS.has(match[1])) continue;
    parts.push({ literal: text.slice(last, match.index) }, { token: match[1] });
    last = match.index + match[0].length;
  }
  parts.push({ literal: text.slice(last) });
  return parts;
}

function renderTemplate(parts, values) {
  const items = parts.map((part) => (part.token
    ? { token: part.token, value: values[part.token] ?? "" }
    : { literal: part.literal }));
  const meaningful = (item) => (item.token ? Boolean(item.value) : /[^-_|\s]/.test(item.literal));
  // An empty variable (usually an unfilled prefix) takes one adjoining separator with it.
  for (let index = 1; index < items.length; index += 2) {
    if (items[index].value) continue;
    const left = items[index - 1];
    const right = items[index + 1];
    if (!items.slice(0, index).some(meaningful)) right.literal = right.literal.replace(/^[-_|\s]+/, "");
    else if (!items.slice(index + 1).some(meaningful)) left.literal = left.literal.replace(/[-_|\s]+$/, "");
    else if (/[-_|\s]$/.test(left.literal)) right.literal = right.literal.replace(/^[-_|\s]+/, "");
  }
  return finishName(items.map((item) => (item.token ? item.value : item.literal)).join(""));
}

function matchLabel(matchType, style) {
  const value = cleanNamePart(matchType);
  if (style === "upper") return value.toUpperCase();
  if (style === "short") return SHORT_MATCH[value] ?? value.toUpperCase();
  return value;
}

function bidLabel(value) {
  const text = String(value ?? "").trim();
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text).toFixed(2) : cleanNamePart(text);
}

// Compiles the keyword naming settings once; nameFor() is then cheap for every row.
export function keywordNaming(settings) {
  const prefix = cleanPrefix(settings?.namePrefix);
  const pattern = settings?.namePattern ?? "keyword-match";
  const separator = settings?.nameSeparator ?? "-";
  const matchStyle = settings?.nameMatchStyle ?? "lower";
  const date = cleanNamePart(settings?.startDate);
  const custom = pattern === "custom";
  const template = custom ? String(settings?.nameTemplate ?? "") : presetTemplate(pattern, separator);
  const parts = parseTemplate(template);
  const tokens = new Set(parts.filter((part) => part.token).map((part) => part.token));
  const nameFor = (keyword, index = 0) => renderTemplate(parts, {
    前缀: prefix,
    关键词: cleanNamePart(keyword?.text),
    匹配: matchLabel(keyword?.matchType, matchStyle),
    出价: bidLabel(keyword?.bid),
    日期: date,
    序号: String(index + 1).padStart(4, "0"),
  });

  // A name built from a plain keyword shows problems caused by the prefix or template itself.
  const probe = nameFor(PROBE_KEYWORD, 0);
  const issues = [];
  if (!PATTERN_VALUES.has(pattern)) issues.push(fieldIssue("namePattern", "命名方案无效，请重新选择"));
  if (!SEPARATOR_VALUES.has(separator)) issues.push(fieldIssue("nameSeparator", "分隔符无效，请重新选择"));
  if (!STYLE_VALUES.has(matchStyle)) issues.push(fieldIssue("nameMatchStyle", "匹配方式写法无效，请重新选择"));
  if (prefix.length > NAME_LIMITS.prefix) issues.push(fieldIssue("namePrefix", `前缀最多 ${NAME_LIMITS.prefix} 个字符`));
  const unknownToken = [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]).find((key) => !TOKEN_KEYS.has(key));
  let templateProblem = false;
  if (custom) {
    templateProblem = true;
    if (!template.trim()) issues.push(fieldIssue("nameTemplate", "请填写自定义模板，或换回上面的预设方案"));
    else if (template.length > NAME_LIMITS.template) issues.push(fieldIssue("nameTemplate", `自定义模板最多 ${NAME_LIMITS.template} 个字符`));
    else if (unknownToken !== undefined) issues.push(fieldIssue("nameTemplate", `{${unknownToken}} 不是可用变量，请用下面的按钮插入`));
    else if (!probe) issues.push(fieldIssue("nameTemplate", "按这个模板生成的名称是空的"));
    else templateProblem = false;
  }
  const leadingBlocked = !startsWithLetter(probe);
  if (leadingBlocked && !templateProblem) {
    issues.push(prefix && probe.startsWith(prefix)
      ? fieldIssue("namePrefix", "前缀在名称最前面，需以字母或汉字开头（名称同时作为临时 ID）")
      : fieldIssue("nameTemplate", "名称开头会是数字或符号；名称同时作为临时 ID，需以字母或汉字开头"));
  }
  const lengthBlocked = probe.length > NAME_LIMITS.campaign;
  if (lengthBlocked) issues.push(fieldIssue(custom ? "nameTemplate" : "namePrefix", `名称超过 ${NAME_LIMITS.campaign} 个字符，请缩短前缀或模板`));

  return {
    nameFor,
    issues,
    leadingBlocked,
    lengthBlocked,
    templateBlocked: templateProblem,
    // Without these tokens, different keywords can end up with the same campaign name.
    distinguishes: tokens.has("序号") || (tokens.has("关键词") && tokens.has("匹配")),
    suggestPrefix: !prefix && parts[0].literal === "" && parts[1]?.token === "前缀",
  };
}

export function keywordCampaignName(settings, keyword, index = 0) {
  return keywordNaming(settings).nameFor(keyword, index);
}

// Waterfall and automatic names keep their fixed format; a prefix goes in front.
export function prefixedName(prefix, baseName) {
  const clean = cleanPrefix(prefix);
  return clean ? `${clean}-${baseName}` : baseName;
}

export function prefixIssues(value) {
  const prefix = cleanPrefix(value);
  const issues = [];
  if (prefix.length > NAME_LIMITS.prefix) issues.push(fieldIssue("namePrefix", `前缀最多 ${NAME_LIMITS.prefix} 个字符`));
  if (prefix && !startsWithLetter(prefix)) issues.push(fieldIssue("namePrefix", "前缀需以字母或汉字开头（名称同时作为临时 ID）"));
  return issues;
}
