import { useEffect, useMemo, useRef, useState } from "react";
import { AutomaticCampaignTable } from "./components/AutomaticCampaignTable.jsx";
import { AutomaticSetupPanel } from "./components/AutomaticSetupPanel.jsx";
import { BatchInputPanel } from "./components/BatchInputPanel.jsx";
import { FormField } from "./components/FormField.jsx";
import { Icon } from "./components/Icons.jsx";
import { KeywordTable } from "./components/KeywordTable.jsx";
import { NegativeKeywordPanel } from "./components/NegativeKeywordPanel.jsx";
import { NegativeProductPanel } from "./components/NegativeProductPanel.jsx";
import { PreviewDialog } from "./components/Dialogs.jsx";
import { SummaryRail } from "./components/SummaryRail.jsx";
import {
  BIDDING_STRATEGIES,
  DEFAULT_TEMPLATE_URL,
  DRAFT_STORAGE_KEY,
  EMPTY_BID_TIER,
  EMPTY_KEYWORD,
  EMPTY_NEGATIVE_KEYWORD,
  EMPTY_NEGATIVE_PRODUCT,
  LEGACY_DRAFT_STORAGE_KEY,
  PLAINTEXT_DRAFT_STORAGE_KEY,
  defaultAutomaticSettings,
  defaultBatchSettings,
  todayYmd,
} from "./lib/constants.js";
import {
  allocatedBudget,
  automaticOutputRowCount,
  buildAutomaticSpRows,
  combinationCount,
  generateAutomaticCampaigns,
  MAX_AUTOMATIC_OUTPUT_ROWS,
  parseSkuList,
  rebalanceAutomaticBudgets,
  validateAutomaticCampaigns,
  validateAutomaticOutputSize,
  validateAutomaticSetup,
} from "./lib/automatic.js";
import {
  buildSpRows,
  createBulksheet,
  downloadBytes,
  entityCounts,
  inspectTemplate,
  TEMPLATE_LIMITS,
} from "./lib/bulksheet.js";
import {
  decryptDraft,
  encryptDraft,
  hydrateDraft,
  isEncryptedDraft,
  serializeDraft,
} from "./lib/draft.js";
import {
  activeKeywords,
  activeNegativeKeywords,
  activeNegativeProducts,
  validateAll,
  validateNegativeKeywords,
  validateNegativeProducts,
} from "./lib/validation.js";

function loadDraft() {
  try {
    const encryptedRaw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (encryptedRaw) {
      const envelope = JSON.parse(encryptedRaw);
      if (isEncryptedDraft(envelope)) {
        localStorage.removeItem(PLAINTEXT_DRAFT_STORAGE_KEY);
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
        return null;
      }
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  } catch {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  for (const key of [PLAINTEXT_DRAFT_STORAGE_KEY, LEGACY_DRAFT_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const hydrated = hydrateDraft(JSON.parse(raw));
      if (hydrated) {
        localStorage.removeItem(PLAINTEXT_DRAFT_STORAGE_KEY);
        localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
        return { draft: hydrated, migratedPlaintext: true };
      }
    } catch {
      // A malformed newer draft must not prevent fallback to the legacy draft.
    }
  }
  return null;
}

function readPageFromHash() {
  return window.location.hash === "#/automatic" ? "automatic" : "keywords";
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function templateValidationIssues(template) {
  if (!template?.buffer) return [{ path: "template", message: "尚未加载官方模板", rowId: null }];
  if (!template.valid) return [{ path: "template", message: template.error || "模板结构无法识别", rowId: null }];
  if (template.dataRowCount > 0) return [{ path: "template", message: "仅接受空白官方模板，请勿导入已有广告活动数据", rowId: null }];
  return [];
}

export default function App() {
  const restoredResult = useMemo(() => loadDraft(), []);
  const restored = restoredResult?.draft;
  const [page, setPage] = useState(readPageFromHash);
  const [keywordSettings, setKeywordSettings] = useState(restored?.keywordSettings || defaultBatchSettings());
  const [keywords, setKeywords] = useState(restored?.keywords || [EMPTY_KEYWORD()]);
  const [negativeKeywords, setNegativeKeywords] = useState(
    restored?.negativeKeywords || [EMPTY_NEGATIVE_KEYWORD()],
  );
  const [automaticSettings, setAutomaticSettings] = useState(restored?.automaticSettings || defaultAutomaticSettings());
  const [automaticCampaigns, setAutomaticCampaigns] = useState(restored?.automaticCampaigns || []);
  const [automaticNegativeKeywords, setAutomaticNegativeKeywords] = useState(
    restored?.automaticNegativeKeywords || [EMPTY_NEGATIVE_KEYWORD()],
  );
  const [automaticNegativeProducts, setAutomaticNegativeProducts] = useState(
    restored?.automaticNegativeProducts || [EMPTY_NEGATIVE_PRODUCT()],
  );
  const [automaticMatrixDirty, setAutomaticMatrixDirty] = useState(false);
  const [template, setTemplate] = useState(null);
  const [activeStep, setActiveStep] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [hasEncryptedDraft, setHasEncryptedDraft] = useState(() => {
    try {
      return Boolean(localStorage.getItem(DRAFT_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [plaintextDraftMigrated, setPlaintextDraftMigrated] = useState(
    Boolean(restoredResult?.migratedPlaintext),
  );
  const templateInputRef = useRef(null);

  useEffect(() => {
    const handleHashChange = () => {
      setPage(readPageFromHash());
      setActiveStep(1);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBuiltInTemplate() {
      try {
        const response = await fetch(DEFAULT_TEMPLATE_URL);
        if (!response.ok) throw new Error(`模板读取失败：${response.status}`);
        const buffer = await response.arrayBuffer();
        const result = await inspectTemplate(buffer, "内置官方模板");
        if (!cancelled) setTemplate(result);
      } catch (error) {
        if (!cancelled) {
          setTemplate({
            buffer: null,
            valid: false,
            fileName: "内置官方模板",
            error: error instanceof Error ? error.message : "模板读取失败",
            dataRowCount: 0,
          });
        }
      }
    }
    loadBuiltInTemplate();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (plaintextDraftMigrated) {
      setToast("旧版明文草稿已安全载入并从存储清除；请重新加密保存");
    }
  }, [plaintextDraftMigrated]);

  const keywordIssues = useMemo(
    () => validateAll(keywordSettings, keywords, negativeKeywords, template, todayYmd()),
    [keywordSettings, keywords, negativeKeywords, template],
  );
  const keywordRows = useMemo(
    () => buildSpRows(keywordSettings, keywords, negativeKeywords),
    [keywordSettings, keywords, negativeKeywords],
  );
  const keywordCounts = useMemo(() => entityCounts(keywordRows), [keywordRows]);
  const keywordCount = keywordCounts.Keyword || 0;
  const negativeKeywordCount = activeNegativeKeywords(negativeKeywords).length;
  const negativeKeywordRowCount = keywordCounts["Negative Keyword"] || 0;
  const keywordFieldErrors = useMemo(() => {
    const map = new Map();
    for (const item of keywordIssues) {
      if (!item.rowId && !map.has(item.path)) map.set(item.path, item.message);
    }
    return map;
  }, [keywordIssues]);
  const keywordIssuesByRow = useMemo(() => {
    const map = new Map();
    for (const item of keywordIssues) {
      if (!item.rowId) continue;
      if (!map.has(item.rowId)) map.set(item.rowId, []);
      map.get(item.rowId).push(item);
    }
    return map;
  }, [keywordIssues]);
  const automaticSetupIssues = useMemo(
    () => validateAutomaticSetup(automaticSettings, todayYmd()),
    [automaticSettings],
  );
  const automaticCampaignIssues = useMemo(
    () => validateAutomaticCampaigns(automaticCampaigns, automaticSettings.totalDailyBudget),
    [automaticCampaigns, automaticSettings.totalDailyBudget],
  );
  const automaticExclusionIssues = useMemo(() => [
    ...validateNegativeKeywords(automaticNegativeKeywords),
    ...validateNegativeProducts(automaticNegativeProducts),
    ...validateAutomaticOutputSize(
      automaticCampaigns,
      automaticNegativeKeywords,
      automaticNegativeProducts,
    ),
  ], [automaticCampaigns, automaticNegativeKeywords, automaticNegativeProducts]);
  const automaticIssues = useMemo(() => [
    ...templateValidationIssues(template),
    ...automaticSetupIssues,
    ...(automaticMatrixDirty && automaticCampaigns.length
      ? [{ path: "matrix", message: "生成条件已更改，请重新生成活动矩阵", rowId: null }]
      : []),
    ...automaticCampaignIssues,
    ...automaticExclusionIssues,
  ], [
    template,
    automaticSetupIssues,
    automaticMatrixDirty,
    automaticCampaigns.length,
    automaticCampaignIssues,
    automaticExclusionIssues,
  ]);
  const automaticNegativeKeywordCount = activeNegativeKeywords(automaticNegativeKeywords).length;
  const automaticNegativeProductCount = activeNegativeProducts(automaticNegativeProducts).length;
  const automaticRowCount = automaticOutputRowCount(
    automaticCampaigns,
    automaticNegativeKeywords,
    automaticNegativeProducts,
  );
  const automaticRows = useMemo(
    () => automaticRowCount <= MAX_AUTOMATIC_OUTPUT_ROWS
      ? buildAutomaticSpRows(
        automaticSettings,
        automaticCampaigns,
        automaticNegativeKeywords,
        automaticNegativeProducts,
      )
      : [],
    [
      automaticSettings,
      automaticCampaigns,
      automaticNegativeKeywords,
      automaticNegativeProducts,
      automaticRowCount,
    ],
  );
  const automaticCounts = useMemo(() => ({
    Campaign: automaticCampaigns.length,
    "Ad Group": automaticCampaigns.length,
    "Product Ad": automaticCampaigns.length,
    "Product Targeting": automaticCampaigns.length,
    "Negative Keyword": automaticCampaigns.length * automaticNegativeKeywordCount,
    "Negative Product Targeting": automaticCampaigns.length * automaticNegativeProductCount,
  }), [automaticCampaigns.length, automaticNegativeKeywordCount, automaticNegativeProductCount]);
  const automaticFieldErrors = useMemo(() => {
    const map = new Map();
    for (const item of automaticSetupIssues) {
      if (!item.rowId && !map.has(item.path)) map.set(item.path, item.message);
    }
    return map;
  }, [automaticSetupIssues]);
  const automaticTierIssues = useMemo(() => {
    const map = new Map();
    for (const item of automaticSetupIssues) {
      if (!item.rowId) continue;
      if (!map.has(item.rowId)) map.set(item.rowId, []);
      map.get(item.rowId).push(item);
    }
    return map;
  }, [automaticSetupIssues]);
  const automaticIssuesByRow = useMemo(() => {
    const map = new Map();
    for (const item of [...automaticCampaignIssues, ...automaticExclusionIssues]) {
      if (!item.rowId) continue;
      if (!map.has(item.rowId)) map.set(item.rowId, []);
      map.get(item.rowId).push(item);
    }
    return map;
  }, [automaticCampaignIssues, automaticExclusionIssues]);
  const matrixCount = useMemo(() => combinationCount(automaticSettings), [automaticSettings]);
  const skuCount = useMemo(() => parseSkuList(automaticSettings.skuText).length, [automaticSettings.skuText]);

  function navigate(nextPage) {
    if (nextPage === page) return;
    window.location.hash = nextPage === "automatic" ? "/automatic" : "/keywords";
  }

  function updateKeywordSettings(field, value) {
    setKeywordSettings((current) => ({ ...current, [field]: value }));
  }

  function updateKeyword(id, field, value) {
    setKeywords((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function deleteKeyword(id) {
    setKeywords((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length ? next : [EMPTY_KEYWORD()];
    });
  }

  function clearKeywords() {
    if (activeKeywords(keywords).length && !window.confirm("确定清空当前关键词列表吗？")) return;
    setKeywords([EMPTY_KEYWORD()]);
  }

  function importBatchRows(nextRows, mode) {
    setKeywords((current) => (mode === "replace" ? nextRows : [...activeKeywords(current), ...nextRows]));
    setActiveStep(3);
    setToast(`已导入 ${nextRows.length} 个关键词`);
    window.setTimeout(() => document.querySelector("#keyword-settings")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function updateNegativeKeyword(id, field, value) {
    setNegativeKeywords((current) => current.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
  }

  function deleteNegativeKeyword(id) {
    setNegativeKeywords((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length ? next : [EMPTY_NEGATIVE_KEYWORD()];
    });
  }

  function clearNegativeKeywords() {
    if (
      activeNegativeKeywords(negativeKeywords).length &&
      !window.confirm("确定清空当前否定词列表吗？")
    ) return;
    setNegativeKeywords([EMPTY_NEGATIVE_KEYWORD()]);
  }

  function importNegativeKeywordRows(nextRows, mode) {
    setNegativeKeywords((current) => (
      mode === "replace" ? nextRows : [...activeNegativeKeywords(current), ...nextRows]
    ));
    setActiveStep(4);
    setToast(`已导入 ${nextRows.length} 个否定词，将应用到全部 ${keywordCount} 套广告`);
    window.setTimeout(() => document.querySelector("#negative-keywords")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function updateAutomaticNegativeKeyword(id, field, value) {
    setAutomaticNegativeKeywords((current) => current.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
  }

  function deleteAutomaticNegativeKeyword(id) {
    setAutomaticNegativeKeywords((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length ? next : [EMPTY_NEGATIVE_KEYWORD()];
    });
  }

  function clearAutomaticNegativeKeywords() {
    if (
      activeNegativeKeywords(automaticNegativeKeywords).length &&
      !window.confirm("确定清空自动广告的前置否定关键词吗？")
    ) return;
    setAutomaticNegativeKeywords([EMPTY_NEGATIVE_KEYWORD()]);
  }

  function importAutomaticNegativeKeywords(nextRows, mode) {
    setAutomaticNegativeKeywords((current) => (
      mode === "replace" ? nextRows : [...activeNegativeKeywords(current), ...nextRows]
    ));
    setActiveStep(3);
    setToast(`已导入 ${nextRows.length} 个自动广告否定关键词`);
  }

  function updateAutomaticNegativeProduct(id, field, value) {
    setAutomaticNegativeProducts((current) => current.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
  }

  function deleteAutomaticNegativeProduct(id) {
    setAutomaticNegativeProducts((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length ? next : [EMPTY_NEGATIVE_PRODUCT()];
    });
  }

  function clearAutomaticNegativeProducts() {
    if (
      activeNegativeProducts(automaticNegativeProducts).length &&
      !window.confirm("确定清空自动广告的前置否定商品吗？")
    ) return;
    setAutomaticNegativeProducts([EMPTY_NEGATIVE_PRODUCT()]);
  }

  function importAutomaticNegativeProducts(nextRows, mode) {
    setAutomaticNegativeProducts((current) => (
      mode === "replace" ? nextRows : [...activeNegativeProducts(current), ...nextRows]
    ));
    setActiveStep(3);
    setToast(`已导入 ${nextRows.length} 个自动广告否定商品`);
  }

  function markAutomaticMatrixDirty() {
    if (automaticCampaigns.length) setAutomaticMatrixDirty(true);
  }

  function updateAutomaticSettings(field, value) {
    setAutomaticSettings((current) => ({ ...current, [field]: value }));
    if (["skuText", "totalDailyBudget"].includes(field)) markAutomaticMatrixDirty();
  }

  function toggleAutomaticTargeting(value) {
    setAutomaticSettings((current) => ({
      ...current,
      selectedTargetingTypes: current.selectedTargetingTypes.includes(value)
        ? current.selectedTargetingTypes.filter((item) => item !== value)
        : [...current.selectedTargetingTypes, value],
    }));
    markAutomaticMatrixDirty();
  }

  function updateBidTier(id, field, value) {
    setAutomaticSettings((current) => ({
      ...current,
      bidTiers: current.bidTiers.map((tier) => (tier.id === id ? { ...tier, [field]: value } : tier)),
    }));
    markAutomaticMatrixDirty();
  }

  function addBidTier() {
    setAutomaticSettings((current) => ({ ...current, bidTiers: [...current.bidTiers, EMPTY_BID_TIER()] }));
    markAutomaticMatrixDirty();
  }

  function deleteBidTier(id) {
    setAutomaticSettings((current) => ({ ...current, bidTiers: current.bidTiers.filter((tier) => tier.id !== id) }));
    markAutomaticMatrixDirty();
  }

  function generateAutomaticMatrix() {
    if (automaticSetupIssues.length) {
      setToast(automaticSetupIssues[0].message);
      return;
    }
    if (automaticCampaigns.length && !window.confirm("重新生成会覆盖当前活动预览中的编辑，是否继续？")) return;
    const next = generateAutomaticCampaigns(automaticSettings);
    setAutomaticCampaigns(next);
    setAutomaticMatrixDirty(false);
    setActiveStep(4);
    setToast(`已生成 ${next.length} 套自动广告，共 ${automaticOutputRowCount(next, automaticNegativeKeywords, automaticNegativeProducts)} 行`);
    window.setTimeout(() => document.querySelector("#automatic-preview")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function updateAutomaticCampaign(id, field, value) {
    setAutomaticCampaigns((current) => current.map((campaign) => (
      campaign.id === id ? { ...campaign, [field]: value } : campaign
    )));
  }

  function rebalanceBudgets() {
    setAutomaticCampaigns((current) => rebalanceAutomaticBudgets(current, automaticSettings.totalDailyBudget));
    setToast("已按美分重新平均分配总日预算");
  }

  async function importTemplate(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setToast("只接受 .xlsx 官方模板");
      return;
    }
    if (file.size > TEMPLATE_LIMITS.maxFileBytes) {
      setToast("模板文件不能超过 5 MB");
      return;
    }
    const buffer = await file.arrayBuffer();
    const result = await inspectTemplate(buffer, file.name);
    setTemplate(result);
    setToast(result.valid ? "官方模板已更新" : result.error);
  }

  async function saveDraft() {
    const passphrase = window.prompt("设置草稿密码（8–256 个字符；密码不会被保存）");
    if (passphrase === null) return;
    if (passphrase.length < 8 || passphrase.length > 256) {
      setToast("草稿密码必须为 8–256 个字符");
      return;
    }
    const confirmation = window.prompt("再次输入草稿密码进行确认");
    if (confirmation === null) return;
    if (confirmation !== passphrase) {
      setToast("两次输入的草稿密码不一致");
      return;
    }
    try {
      const value = serializeDraft({
        keywordSettings,
        keywords,
        negativeKeywords,
        automaticSettings,
        automaticCampaigns,
        automaticNegativeKeywords,
        automaticNegativeProducts,
      });
      const encrypted = await encryptDraft(value, passphrase);
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(encrypted));
      localStorage.removeItem(PLAINTEXT_DRAFT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      setHasEncryptedDraft(true);
      setPlaintextDraftMigrated(false);
      setToast("加密草稿已保存在这台电脑的浏览器中");
    } catch {
      setToast("浏览器未允许保存加密草稿");
    }
  }

  async function restoreDraft() {
    const passphrase = window.prompt("输入草稿密码（密码不会被保存）");
    if (passphrase === null) return;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      const envelope = raw ? JSON.parse(raw) : null;
      if (!isEncryptedDraft(envelope)) throw new Error("没有可恢复的加密草稿");
      const restoredValue = hydrateDraft(await decryptDraft(envelope, passphrase));
      if (!restoredValue) throw new Error("草稿内容无法识别");
      setKeywordSettings(restoredValue.keywordSettings);
      setKeywords(restoredValue.keywords);
      setNegativeKeywords(restoredValue.negativeKeywords);
      setAutomaticSettings(restoredValue.automaticSettings);
      setAutomaticCampaigns(restoredValue.automaticCampaigns);
      setAutomaticNegativeKeywords(restoredValue.automaticNegativeKeywords);
      setAutomaticNegativeProducts(restoredValue.automaticNegativeProducts);
      setAutomaticMatrixDirty(false);
      setPlaintextDraftMigrated(false);
      setToast("加密草稿已恢复");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "加密草稿恢复失败");
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(PLAINTEXT_DRAFT_STORAGE_KEY);
      localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
      setHasEncryptedDraft(false);
      setPlaintextDraftMigrated(false);
      setToast("本机浏览器草稿已删除；当前页面内容未清空");
    } catch {
      setToast("浏览器未允许删除草稿");
    }
  }

  async function exportWorkbook() {
    const currentIssues = page === "automatic" ? automaticIssues : keywordIssues;
    const currentRows = page === "automatic" ? automaticRows : keywordRows;
    if (currentIssues.length || !template?.buffer) return;
    setExporting(true);
    try {
      const bytes = await createBulksheet(template.buffer, currentRows);
      const fileName = page === "automatic"
        ? `Amazon-SP-AUTO-${automaticCampaigns.length}-campaigns-${timestamp()}.xlsx`
        : `Amazon-SP-${keywordCount}-campaigns-${timestamp()}.xlsx`;
      downloadBytes(bytes, fileName);
      setToast(`已生成 ${fileName}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  function jumpTo(step, selector) {
    setActiveStep(step);
    document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const isAutomatic = page === "automatic";
  const previewRows = isAutomatic ? automaticRows : keywordRows;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <h1>Amazon SP 批量广告表格工具</h1>
          <p>{isAutomatic ? "SKU × 自动投放类型 × 出价档位 · 本地生成与导出" : "一词一活动 · 批量生成关键词广告"}</p>
        </div>
        <nav aria-label="广告类型" className="page-switcher">
          <button aria-current={!isAutomatic ? "page" : undefined} className={!isAutomatic ? "page-switcher__active" : ""} onClick={() => navigate("keywords")} type="button">关键词广告</button>
          <button aria-current={isAutomatic ? "page" : undefined} className={isAutomatic ? "page-switcher__active" : ""} onClick={() => navigate("automatic")} type="button">自动广告</button>
        </nav>
        <div className="topbar__actions">
          <input accept=".xlsx" className="sr-only" onChange={(event) => { importTemplate(event.target.files?.[0]); event.target.value = ""; }} ref={templateInputRef} type="file" />
          <button className="button button--secondary" onClick={() => templateInputRef.current?.click()} type="button"><Icon name="upload" />导入官方模板</button>
          {hasEncryptedDraft ? <button className="button button--secondary" onClick={restoreDraft} type="button"><Icon name="unlock" />恢复草稿</button> : null}
          <button className="button button--secondary" onClick={saveDraft} type="button"><Icon name="save" />加密保存</button>
          <button className="button button--quiet" onClick={clearDraft} type="button"><Icon name="trash" />清除本机草稿</button>
        </div>
      </header>

      {!isAutomatic ? (
        <div className="app-layout">
          <nav className="workflow workflow--five" aria-label="关键词广告创建流程">
            {[[1, "批量规则", "#batch-settings"], [2, "粘贴关键词", "#batch-input"], [3, "检查关键词", "#keyword-settings"], [4, "批量否定词", "#negative-keywords"], [5, "校验与导出", ".summary-rail"]].map(([step, label, selector]) => (
              <button className={`workflow__step ${activeStep === step ? "workflow__step--active" : ""}`} key={step} onClick={() => jumpTo(step, selector)} type="button"><span>{step}</span>{label}</button>
            ))}
          </nav>

          <main className="workspace">
            <section className="workspace-section" id="batch-settings">
              <div className="section-title"><h2>批量共用设置</h2><span>一词一活动 · 一词一组</span></div>
              <div className="form-grid form-grid--batch">
                <FormField label="Seller SKU" required error={keywordFieldErrors.get("sku")}><input id="sku" onChange={(event) => updateKeywordSettings("sku", event.target.value)} placeholder="输入 Seller SKU，不是 ASIN" value={keywordSettings.sku} /></FormField>
                <FormField label="每个广告活动的日预算" required error={keywordFieldErrors.get("dailyBudget")}><div className="input-suffix"><input id="dailyBudget" inputMode="decimal" onChange={(event) => updateKeywordSettings("dailyBudget", event.target.value)} placeholder="20.00" value={keywordSettings.dailyBudget} /><span>站点货币</span></div></FormField>
                <FormField label="开始日期" hint="自动使用今天"><input id="startDate" readOnly value={keywordSettings.startDate} /></FormField>
                <FormField label="竞价策略" required error={keywordFieldErrors.get("biddingStrategy")}><select id="biddingStrategy" onChange={(event) => updateKeywordSettings("biddingStrategy", event.target.value)} value={keywordSettings.biddingStrategy}>{BIDDING_STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}</select></FormField>
                <FormField label="初始状态" required error={keywordFieldErrors.get("state")}><select id="campaignState" onChange={(event) => updateKeywordSettings("state", event.target.value)} value={keywordSettings.state}><option value="paused">已暂停 · paused</option><option value="enabled">已启用 · enabled</option></select></FormField>
              </div>
              <details className="advanced-settings"><summary>可选设置</summary><div className="form-grid form-grid--advanced">
                <FormField label="Portfolio ID" hint="留空则不加入 Portfolio"><input onChange={(event) => updateKeywordSettings("portfolioId", event.target.value)} placeholder="可选" value={keywordSettings.portfolioId} /></FormField>
                <FormField label="结束日期" error={keywordFieldErrors.get("endDate")} hint="留空则长期运行"><input inputMode="numeric" maxLength={8} onChange={(event) => updateKeywordSettings("endDate", event.target.value)} placeholder="YYYYMMDD" value={keywordSettings.endDate} /></FormField>
                <FormField label="Off-Amazon ad serving" hint="留空则使用 Amazon 默认设置"><select onChange={(event) => updateKeywordSettings("offAmazon", event.target.value)} value={keywordSettings.offAmazon}><option value="">留空</option><option value="Increase reach">Increase reach</option><option value="Limit off-Amazon spend">Limit off-Amazon spend</option></select></FormField>
              </div></details>
              <div className="structure-rule"><div><strong>每个关键词生成一套 4 行广告</strong><span>Campaign → Ad Group → Product Ad → Keyword</span></div><div><strong>批量否定词应用到全部广告组</strong><span>每个否定词按所选方式为每套广告追加 Negative Keyword 行</span></div></div>
            </section>

            <section className="workspace-section" id="batch-input"><div className="section-title"><h2>批量粘贴关键词</h2><span>支持 Excel 多行粘贴</span></div><BatchInputPanel defaultBid={keywordSettings.pasteDefaultBid} defaultMatchType={keywordSettings.pasteDefaultMatchType} onDefaultChange={updateKeywordSettings} onImport={importBatchRows} /></section>

            <section className="workspace-section workspace-section--keywords" id="keyword-settings">
              <div className="section-title section-title--keywords"><h2>关键词结果检查</h2><span>{keywordCount} 个关键词 → {keywordCount} 套独立广告</span></div>
              <div className="keyword-toolbar"><button className="button button--secondary" onClick={() => setKeywords((current) => [...current, EMPTY_KEYWORD()])} type="button"><Icon name="plus" />补充一行</button><button className="button button--quiet" onClick={clearKeywords} type="button"><Icon name="trash" />清空</button></div>
              <KeywordTable issuesByRow={keywordIssuesByRow} onAdd={() => setKeywords((current) => [...current, EMPTY_KEYWORD()])} onChange={updateKeyword} onDelete={deleteKeyword} rows={keywords} />
            </section>

            <section className="workspace-section workspace-section--negative" id="negative-keywords">
              <div className="section-title">
                <h2>批量添加否定词</h2>
                <span>{negativeKeywordCount} 个否定词 × {keywordCount} 套广告 = {negativeKeywordRowCount} 个 Negative Keyword 行</span>
              </div>
              <p className="section-intro">这是一份独立的否定词列表；导出时会把整批否定词应用到上方所有关键词广告组。</p>
              <NegativeKeywordPanel
                issuesByRow={keywordIssuesByRow}
                onAdd={() => setNegativeKeywords((current) => [...current, EMPTY_NEGATIVE_KEYWORD()])}
                onChange={updateNegativeKeyword}
                onClear={clearNegativeKeywords}
                onDelete={deleteNegativeKeyword}
                onImport={importNegativeKeywordRows}
                rows={negativeKeywords}
              />
            </section>
          </main>
          <SummaryRail counts={keywordCounts} entityOrder={["Campaign", "Ad Group", "Product Ad", "Keyword", "Negative Keyword"]} exporting={exporting} issues={keywordIssues} onExport={exportWorkbook} onPreview={() => setShowPreview(true)} summaryCaption={`${keywordCount} 套基础广告 + ${negativeKeywordCount} 个批量否定词，共 ${keywordRows.length} 行`} template={template} totalRows={keywordRows.length} />
        </div>
      ) : (
        <div className="app-layout">
          <nav className="workflow workflow--five" aria-label="自动广告创建流程">
            {[[1, "SKU 与预算", "#automatic-settings"], [2, "投放与出价", "#automatic-targeting"], [3, "前置否定项", "#automatic-negative-keywords"], [4, "编辑预览", "#automatic-preview"], [5, "校验与导出", ".summary-rail"]].map(([step, label, selector]) => (
              <button className={`workflow__step ${activeStep === step ? "workflow__step--active" : ""}`} key={step} onClick={() => jumpTo(step, selector)} type="button"><span>{step}</span>{label}</button>
            ))}
          </nav>
          <main className="workspace workspace--automatic">
            <AutomaticSetupPanel
              canGenerate={automaticSetupIssues.length === 0}
              fieldErrors={automaticFieldErrors}
              generatedCount={automaticCampaigns.length}
              matrixCount={matrixCount}
              onAddTier={addBidTier}
              onChange={updateAutomaticSettings}
              onDeleteTier={deleteBidTier}
              onGenerate={generateAutomaticMatrix}
              onTierChange={updateBidTier}
              onToggleTargeting={toggleAutomaticTargeting}
              settings={automaticSettings}
              skuCount={skuCount}
              tierIssues={automaticTierIssues}
            />
            <section className="workspace-section workspace-section--negative" id="automatic-negative-keywords">
              <div className="section-title">
                <h2>前置否定关键词</h2>
                <span>{automaticNegativeKeywordCount} 个关键词 × {automaticCampaigns.length} 套广告 = {automaticCounts["Negative Keyword"] || 0} 行</span>
              </div>
              <p className="section-intro">自动广告专用列表；导出时逐条写入全部自动广告组，不与关键词广告页的否定词共用。</p>
              <NegativeKeywordPanel
                issuesByRow={automaticIssuesByRow}
                onAdd={() => setAutomaticNegativeKeywords((current) => [...current, EMPTY_NEGATIVE_KEYWORD()])}
                onChange={updateAutomaticNegativeKeyword}
                onClear={clearAutomaticNegativeKeywords}
                onDelete={deleteAutomaticNegativeKeyword}
                onImport={importAutomaticNegativeKeywords}
                rows={automaticNegativeKeywords}
                textareaId="automaticNegativeKeywordPasteText"
              />
            </section>
            <section className="workspace-section workspace-section--negative" id="automatic-negative-products">
              <div className="section-title">
                <h2>前置否定商品</h2>
                <span>{automaticNegativeProductCount} 个 ASIN × {automaticCampaigns.length} 套广告 = {automaticCounts["Negative Product Targeting"] || 0} 行</span>
              </div>
              <p className="section-intro">与否定关键词分开维护；每个 ASIN 会为全部自动广告组追加一行 Negative Product Targeting。</p>
              <NegativeProductPanel
                issuesByRow={automaticIssuesByRow}
                onAdd={() => setAutomaticNegativeProducts((current) => [...current, EMPTY_NEGATIVE_PRODUCT()])}
                onChange={updateAutomaticNegativeProduct}
                onClear={clearAutomaticNegativeProducts}
                onDelete={deleteAutomaticNegativeProduct}
                onImport={importAutomaticNegativeProducts}
                rows={automaticNegativeProducts}
              />
            </section>
            <section className="workspace-section workspace-section--automatic-preview" id="automatic-preview">
              <div className="section-title section-title--keywords"><h2>可编辑活动预览</h2><span>{automaticCampaigns.length} 套 · {automaticRowCount} 个 XLSX 行</span></div>
              <div className="automatic-preview-toolbar"><p>维度与临时 ID 固定；名称、预算、出价和状态可在导出前逐项调整。</p><div><span>当前分配合计 <strong>{allocatedBudget(automaticCampaigns).toFixed(2)}</strong></span><button className="button button--secondary" disabled={!automaticCampaigns.length} onClick={rebalanceBudgets} type="button"><Icon name="refresh" />重新平均分配</button></div></div>
              <AutomaticCampaignTable campaigns={automaticCampaigns} issuesByRow={automaticIssuesByRow} onChange={updateAutomaticCampaign} />
            </section>
          </main>
          <SummaryRail counts={automaticCounts} entityOrder={["Campaign", "Ad Group", "Product Ad", "Product Targeting", "Negative Keyword", "Negative Product Targeting"]} exporting={exporting} issues={automaticIssues} onExport={exportWorkbook} onPreview={() => setShowPreview(true)} previewLabel="预览 XLSX 行" summaryCaption={`${automaticCampaigns.length} 套基础广告 + ${automaticNegativeKeywordCount} 个否定关键词 + ${automaticNegativeProductCount} 个否定商品，共 ${automaticRowCount} 行`} summaryTitle={`将创建 ${automaticCampaigns.length} 套自动广告`} template={template} totalRows={automaticRowCount} />
        </div>
      )}

      {showPreview ? <PreviewDialog description={isAutomatic ? `共 ${automaticRowCount} 行；每套自动广告包含四个基础行，并分别追加前置 Negative Keyword 与 Negative Product Targeting 行；保留官方 32 列。` : `共 ${keywordRows.length} 行；每套关键词广告包含四个基础行，并把独立否定词列表逐条追加为 Negative Keyword 行；保留官方 32 列。`} onClose={() => setShowPreview(false)} rows={previewRows} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
