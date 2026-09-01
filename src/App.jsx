import { useEffect, useMemo, useRef, useState } from "react";
import { BatchInputPanel } from "./components/BatchInputPanel.jsx";
import { FormField } from "./components/FormField.jsx";
import { Icon } from "./components/Icons.jsx";
import { KeywordTable } from "./components/KeywordTable.jsx";
import { PreviewDialog } from "./components/Dialogs.jsx";
import { SummaryRail } from "./components/SummaryRail.jsx";
import {
  BIDDING_STRATEGIES,
  DEFAULT_TEMPLATE_URL,
  DRAFT_STORAGE_KEY,
  EMPTY_KEYWORD,
  defaultBatchSettings,
  todayYmd,
} from "./lib/constants.js";
import {
  buildSpRows,
  createBulksheet,
  downloadBytes,
  entityCounts,
  inspectTemplate,
  TEMPLATE_LIMITS,
} from "./lib/bulksheet.js";
import { activeKeywords, validateAll } from "./lib/validation.js";

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return {
      settings: {
        ...defaultBatchSettings(),
        ...value.settings,
        startDate: todayYmd(),
      },
      keywords: Array.isArray(value.keywords) && value.keywords.length
        ? value.keywords.map((row) => ({ ...EMPTY_KEYWORD(), ...row }))
        : [EMPTY_KEYWORD()],
    };
  } catch {
    return null;
  }
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export default function App() {
  const restored = useMemo(() => loadDraft(), []);
  const [settings, setSettings] = useState(restored?.settings || defaultBatchSettings());
  const [keywords, setKeywords] = useState(restored?.keywords || [EMPTY_KEYWORD()]);
  const [template, setTemplate] = useState(null);
  const [activeStep, setActiveStep] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const templateInputRef = useRef(null);

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
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const issues = useMemo(
    () => validateAll(settings, keywords, template, todayYmd()),
    [settings, keywords, template],
  );
  const rows = useMemo(() => buildSpRows(settings, keywords), [settings, keywords]);
  const counts = useMemo(() => entityCounts(rows), [rows]);
  const keywordCount = counts.Keyword || 0;
  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const item of issues) {
      if (!item.rowId && !map.has(item.path)) map.set(item.path, item.message);
    }
    return map;
  }, [issues]);
  const issuesByRow = useMemo(() => {
    const map = new Map();
    for (const item of issues) {
      if (!item.rowId) continue;
      if (!map.has(item.rowId)) map.set(item.rowId, []);
      map.get(item.rowId).push(item);
    }
    return map;
  }, [issues]);

  function updateSettings(field, value) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  function updateKeyword(id, field, value) {
    setKeywords((current) => current.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
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
    setKeywords((current) => {
      if (mode === "replace") return nextRows;
      const existing = activeKeywords(current);
      return [...existing, ...nextRows];
    });
    setActiveStep(3);
    setToast(`已导入 ${nextRows.length} 个关键词，将生成 ${nextRows.length * 4} 行`);
    window.setTimeout(() => {
      document.querySelector("#keyword-settings")?.scrollIntoView({ behavior: "smooth" });
    }, 0);
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

  function saveDraft() {
    const { startDate: _today, ...persistedSettings } = settings;
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          settings: persistedSettings,
          keywords,
          savedAt: new Date().toISOString(),
        }),
      );
      setToast("草稿已保存在这台电脑的浏览器中");
    } catch {
      setToast("浏览器未允许保存草稿");
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setToast("本机浏览器草稿已删除；当前页面内容未清空");
    } catch {
      setToast("浏览器未允许删除草稿");
    }
  }

  async function exportWorkbook() {
    if (issues.length || !template?.buffer) return;
    setExporting(true);
    try {
      const bytes = await createBulksheet(template.buffer, rows);
      const fileName = `Amazon-SP-${keywordCount}-campaigns-${timestamp()}.xlsx`;
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <h1>SP 一词一活动批量生成器</h1>
          <p>粘贴 N 个关键词，自动创建 N 个广告活动和 N 个广告组 · 数据仅在当前浏览器处理</p>
        </div>
        <div className="topbar__actions">
          <input
            accept=".xlsx"
            className="sr-only"
            onChange={(event) => {
              importTemplate(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={templateInputRef}
            type="file"
          />
          <button className="button button--secondary" onClick={() => templateInputRef.current?.click()} type="button">
            <Icon name="upload" />
            导入官方模板
          </button>
          <button className="button button--secondary" onClick={saveDraft} type="button">
            <Icon name="save" />
            保存草稿
          </button>
          <button className="button button--quiet" onClick={clearDraft} type="button">
            <Icon name="trash" />
            清除本机草稿
          </button>
        </div>
      </header>

      <div className="app-layout">
        <nav className="workflow" aria-label="创建流程">
          {[
            [1, "批量规则", "#batch-settings"],
            [2, "粘贴关键词", "#batch-input"],
            [3, "检查结果", "#keyword-settings"],
            [4, "校验与导出", ".summary-rail"],
          ].map(([step, label, selector]) => (
            <button
              className={`workflow__step ${activeStep === step ? "workflow__step--active" : ""}`}
              key={step}
              onClick={() => jumpTo(step, selector)}
              type="button"
            >
              <span>{step}</span>
              {label}
            </button>
          ))}
        </nav>

        <main className="workspace">
          <section className="workspace-section" id="batch-settings">
            <div className="section-title">
              <h2>批量共用设置</h2>
              <span>一词一活动 · 一词一组</span>
            </div>
            <div className="form-grid form-grid--batch">
              <FormField label="Seller SKU" required error={fieldErrors.get("sku")}>
                <input
                  id="sku"
                  onChange={(event) => updateSettings("sku", event.target.value)}
                  placeholder="输入 Seller SKU，不是 ASIN"
                  value={settings.sku}
                />
              </FormField>
              <FormField label="每个广告活动的日预算" required error={fieldErrors.get("dailyBudget")}>
                <div className="input-suffix">
                  <input
                    id="dailyBudget"
                    inputMode="decimal"
                    onChange={(event) => updateSettings("dailyBudget", event.target.value)}
                    placeholder="20.00"
                    value={settings.dailyBudget}
                  />
                  <span>站点货币</span>
                </div>
              </FormField>
              <FormField label="开始日期" hint="自动使用今天">
                <input id="startDate" readOnly value={settings.startDate} />
              </FormField>
              <FormField label="竞价策略" required error={fieldErrors.get("biddingStrategy")}>
                <select
                  id="biddingStrategy"
                  onChange={(event) => updateSettings("biddingStrategy", event.target.value)}
                  value={settings.biddingStrategy}
                >
                  {BIDDING_STRATEGIES.map((strategy) => (
                    <option key={strategy} value={strategy}>{strategy}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="初始状态" required error={fieldErrors.get("state")}>
                <select
                  id="campaignState"
                  onChange={(event) => updateSettings("state", event.target.value)}
                  value={settings.state}
                >
                  <option value="paused">已暂停 · paused</option>
                  <option value="enabled">已启用 · enabled</option>
                </select>
              </FormField>
            </div>

            <details className="advanced-settings">
              <summary>可选设置</summary>
              <div className="form-grid form-grid--advanced">
                <FormField label="Portfolio ID" hint="留空则不加入 Portfolio">
                  <input
                    onChange={(event) => updateSettings("portfolioId", event.target.value)}
                    placeholder="可选"
                    value={settings.portfolioId}
                  />
                </FormField>
                <FormField label="结束日期" error={fieldErrors.get("endDate")} hint="留空则长期运行">
                  <input
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => updateSettings("endDate", event.target.value)}
                    placeholder="YYYYMMDD"
                    value={settings.endDate}
                  />
                </FormField>
                <FormField label="Off-Amazon ad serving" hint="留空则使用 Amazon 默认设置">
                  <select
                    onChange={(event) => updateSettings("offAmazon", event.target.value)}
                    value={settings.offAmazon}
                  >
                    <option value="">留空</option>
                    <option value="Increase reach">Increase reach</option>
                    <option value="Limit off-Amazon spend">Limit off-Amazon spend</option>
                  </select>
                </FormField>
              </div>
            </details>

            <div className="structure-rule">
              <div><strong>每个关键词自动生成 4 行</strong><span>Campaign → Ad Group → Product Ad → Keyword</span></div>
              <div><strong>名称和临时 ID 自动生成</strong><span>关键词-匹配方式，例如 abstract wall art-exact</span></div>
            </div>
          </section>

          <section className="workspace-section" id="batch-input">
            <div className="section-title">
              <h2>批量粘贴关键词</h2>
              <span>支持 Excel 多行粘贴</span>
            </div>
            <BatchInputPanel
              defaultBid={settings.pasteDefaultBid}
              defaultMatchType={settings.pasteDefaultMatchType}
              onDefaultChange={updateSettings}
              onImport={importBatchRows}
            />
          </section>

          <section className="workspace-section workspace-section--keywords" id="keyword-settings">
            <div className="section-title section-title--keywords">
              <h2>生成结果检查</h2>
              <span>{keywordCount} 个关键词 → {keywordCount} 套独立广告</span>
            </div>
            <div className="keyword-toolbar">
              <button
                className="button button--secondary"
                onClick={() => setKeywords((current) => [...current, EMPTY_KEYWORD()])}
                type="button"
              >
                <Icon name="plus" />
                补充一行
              </button>
              <button className="button button--quiet" onClick={clearKeywords} type="button">
                <Icon name="trash" />
                清空
              </button>
            </div>
            <KeywordTable
              issuesByRow={issuesByRow}
              onAdd={() => setKeywords((current) => [...current, EMPTY_KEYWORD()])}
              onChange={updateKeyword}
              onDelete={deleteKeyword}
              rows={keywords}
            />
          </section>
        </main>

        <SummaryRail
          counts={counts}
          exporting={exporting}
          issues={issues}
          onExport={exportWorkbook}
          onPreview={() => setShowPreview(true)}
          template={template}
          totalRows={rows.length}
        />
      </div>

      {showPreview ? <PreviewDialog onClose={() => setShowPreview(false)} rows={rows} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
