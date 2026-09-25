import {
  defaultAutomaticSettings,
  defaultBatchSettings,
  EMPTY_KEYWORD,
  EMPTY_NEGATIVE_KEYWORD,
  EMPTY_NEGATIVE_PRODUCT,
  todayYmd,
} from "./constants.js";

const ENCRYPTED_DRAFT_FORMAT = "amazon-sp-bulksheet-builder/encrypted-draft";
const ENCRYPTED_DRAFT_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const ADDITIONAL_DATA = "amazon-sp-bulksheet-builder:draft:v4";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function validPassphrase(passphrase) {
  return typeof passphrase === "string" && passphrase.length >= 8 && passphrase.length <= 256;
}

function bytesToBase64(bytes) {
  const chunks = [];
  const chunkSize = 32766;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    chunks.push(btoa(String.fromCharCode(...chunk)));
  }
  return chunks.join("");
}

function base64ToBytes(value) {
  if (typeof value !== "string" || value.length > 12 * 1024 * 1024) {
    throw new Error("加密草稿结构无效");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveDraftKey(passphrase, salt) {
  if (!validPassphrase(passphrase)) throw new Error("草稿密码必须为 8–256 个字符");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedDraft(value) {
  return value?.format === ENCRYPTED_DRAFT_FORMAT
    && value?.version === ENCRYPTED_DRAFT_VERSION
    && value?.kdf?.name === "PBKDF2"
    && value?.kdf?.hash === "SHA-256"
    && value?.kdf?.iterations === PBKDF2_ITERATIONS
    && value?.cipher?.name === "AES-GCM";
}

export async function encryptDraft(value, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveDraftKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(ADDITIONAL_DATA) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return {
    format: ENCRYPTED_DRAFT_FORMAT,
    version: ENCRYPTED_DRAFT_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: "AES-GCM",
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted)),
    },
  };
}

export async function decryptDraft(envelope, passphrase) {
  if (!isEncryptedDraft(envelope)) throw new Error("加密草稿结构无效");
  try {
    const salt = base64ToBytes(envelope.kdf.salt);
    const iv = base64ToBytes(envelope.cipher.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error("加密草稿结构无效");
    const key = await deriveDraftKey(passphrase, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(ADDITIONAL_DATA) },
      key,
      base64ToBytes(envelope.cipher.data),
    );
    return JSON.parse(decoder.decode(decrypted));
  } catch (error) {
    if (error instanceof Error && /草稿结构|草稿密码/.test(error.message)) throw error;
    throw new Error("密码错误或加密草稿已损坏");
  }
}

function hydrateKeywords(rows) {
  return Array.isArray(rows) && rows.length
    ? rows.map((row) => {
      const { negativeText: _negativeText, negativeMatchType: _negativeMatchType, ...keyword } = row;
      return { ...EMPTY_KEYWORD(), ...keyword };
    })
    : [EMPTY_KEYWORD()];
}

function hydrateNegativeKeywords(rows, legacyKeywordRows = []) {
  if (Array.isArray(rows) && rows.length) {
    return rows.map((row) => ({ ...EMPTY_NEGATIVE_KEYWORD(), ...row }));
  }
  const migrated = Array.isArray(legacyKeywordRows)
    ? legacyKeywordRows
      .filter((row) => String(row?.negativeText ?? "").trim())
      .map((row) => ({
        ...EMPTY_NEGATIVE_KEYWORD(),
        text: String(row.negativeText).trim(),
        matchType: row.negativeMatchType || "negativeExact",
      }))
    : [];
  return migrated.length ? migrated : [EMPTY_NEGATIVE_KEYWORD()];
}

function hydrateNegativeProducts(rows) {
  return Array.isArray(rows) && rows.length
    ? rows.map((row) => ({ ...EMPTY_NEGATIVE_PRODUCT(), ...row }))
    : [EMPTY_NEGATIVE_PRODUCT()];
}

function hydrateAutomaticSettings(value) {
  const defaults = defaultAutomaticSettings();
  const { bidTiers: legacyTiers, totalDailyBudget: legacyTotalBudget, ...saved } = value || {};
  const legacy = Array.isArray(legacyTiers) || legacyTotalBudget !== undefined;
  const settings = { ...defaults, ...saved, startDate: todayYmd() };
  settings.selectedTargetingTypes = Array.isArray(value?.selectedTargetingTypes)
    ? value.selectedTargetingTypes
    : defaults.selectedTargetingTypes;
  if (legacy) {
    settings.dailyBudget = "";
    settings.baseBid = "";
    settings.bidInterval = defaults.bidInterval;
    settings.tierCount = legacyTiers?.length ? String(legacyTiers.length) : defaults.tierCount;
  }
  return { settings, legacy };
}

export function hydrateDraft(value) {
  if (!value || typeof value !== "object") return null;
  if (value.version === 3 || value.keyword || value.automatic) {
    const automatic = hydrateAutomaticSettings(value.automatic?.settings);
    const savedCampaigns = Array.isArray(value.automatic?.campaigns) ? value.automatic.campaigns : [];
    const legacyCampaigns = savedCampaigns.some((campaign) => !Array.isArray(campaign.skus)
      || !Array.isArray(campaign.targetingTypes));
    return {
      keywordSettings: {
        ...defaultBatchSettings(),
        ...(value.keyword?.settings || {}),
        startDate: todayYmd(),
      },
      keywords: hydrateKeywords(value.keyword?.keywords),
      negativeKeywords: hydrateNegativeKeywords(
        value.keyword?.negativeKeywords,
        value.keyword?.keywords,
      ),
      automaticSettings: automatic.settings,
      automaticCampaigns: automatic.legacy || legacyCampaigns ? [] : savedCampaigns,
      automaticNeedsRegeneration: automatic.legacy || legacyCampaigns,
      automaticNegativeKeywords: hydrateNegativeKeywords(value.automatic?.negativeKeywords),
      automaticNegativeProducts: hydrateNegativeProducts(value.automatic?.negativeProducts),
    };
  }
  return {
    keywordSettings: {
      ...defaultBatchSettings(),
      ...(value.settings || {}),
      startDate: todayYmd(),
    },
    keywords: hydrateKeywords(value.keywords),
    negativeKeywords: [EMPTY_NEGATIVE_KEYWORD()],
    automaticSettings: defaultAutomaticSettings(),
    automaticCampaigns: [],
    automaticNegativeKeywords: [EMPTY_NEGATIVE_KEYWORD()],
    automaticNegativeProducts: [EMPTY_NEGATIVE_PRODUCT()],
  };
}

export function serializeDraft({
  keywordSettings,
  keywords,
  negativeKeywords,
  automaticSettings,
  automaticCampaigns,
  automaticNegativeKeywords,
  automaticNegativeProducts,
}) {
  const { startDate: _keywordToday, ...savedKeywordSettings } = keywordSettings;
  const { startDate: _autoToday, ...savedAutomaticSettings } = automaticSettings;
  return {
    version: 4,
    keyword: { settings: savedKeywordSettings, keywords, negativeKeywords },
    automatic: {
      settings: savedAutomaticSettings,
      campaigns: automaticCampaigns,
      negativeKeywords: Array.isArray(automaticNegativeKeywords) ? automaticNegativeKeywords : [],
      negativeProducts: Array.isArray(automaticNegativeProducts) ? automaticNegativeProducts : [],
    },
    savedAt: new Date().toISOString(),
  };
}
