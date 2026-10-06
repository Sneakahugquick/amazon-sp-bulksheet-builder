import { useEffect, useMemo, useState } from "react";
import { FormField } from "./FormField.jsx";
import { Icon } from "./Icons.jsx";
import { generateKeywordTiers, keywordPlanSummary, keywordTierPlanKey, keywordWaterfallNames, validateKeywordTierInputs } from "../lib/keyword-campaigns.js";

const PAGE_SIZE = 100;

export function KeywordWaterfallPanel({ settings, keywords, fieldErrors, issuesByRow, onChange, onGenerate, onTierChange }) {
  const [page, setPage] = useState(1);
  const canGenerate = validateKeywordTierInputs(settings).length === 0;
  const tiers = settings.waterfallTiers;
  const current = settings.waterfallPlanKey === keywordTierPlanKey(settings);
  const summary = useMemo(() => keywordPlanSummary({
    ...settings, waterfallTiers: current ? tiers : generateKeywordTiers(settings),
  }, keywords), [settings, keywords, current, tiers]);
  const pageCount = Math.max(1, Math.ceil(tiers.length / PAGE_SIZE));
  useEffect(() => { setPage(value => Math.min(value, pageCount)); }, [pageCount]);
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div className="keyword-waterfall" id="keyword-waterfall">
      <div className="section-title"><h3>关键词瀑布出价</h3><span>按档位与匹配方式创建活动</span></div>
      <p className="section-intro">同一匹配方式的全部关键词组成一组，每档创建 1 个活动和 1 个广告组，包含全部 SKU。exact、phrase、broad 分别创建活动。</p>
      <div className="form-grid">
        <FormField label="基准点击出价" required error={fieldErrors.get("waterfallBaseBid")}>
          <input id="keywordBaseBid" inputMode="decimal" onChange={event => onChange("waterfallBaseBid", event.target.value)} placeholder="0.50" value={settings.waterfallBaseBid} />
        </FormField>
        <FormField label="每档递减间隔" required error={fieldErrors.get("waterfallBidInterval")}>
          <input id="keywordBidInterval" inputMode="decimal" onChange={event => onChange("waterfallBidInterval", event.target.value)} value={settings.waterfallBidInterval} />
        </FormField>
        <FormField label="出价档位数" required error={fieldErrors.get("waterfallTierCount")}>
          <input id="keywordTierCount" inputMode="numeric" onChange={event => onChange("waterfallTierCount", event.target.value)} value={settings.waterfallTierCount} />
        </FormField>
      </div>
      <div className="automatic-bid-plan keyword-budget-plan" id="keyword-budget-plan">
        <span>{current ? "当前档位计划" : "生成档位后的计划"}</span>
        <strong>{settings.waterfallTierCount || "0"} 档 × {summary.groups.length} 种匹配方式 → {summary.campaignCount} 个活动</strong>
        <strong>整批日预算：{summary.totalDailyBudget ?? "待设置"}（站点货币）</strong>
        <small>每档每种匹配活动使用该档预算；总预算为各档预算之和 × 实际匹配方式数。SKU 数量不增加活动或预算。</small>
      </div>
      <div className="keyword-tier-actions">
        <button className="button button--primary" disabled={!canGenerate} id="keyword-generate-tiers" onClick={onGenerate} type="button"><Icon name="plus" />{tiers.length ? "重新生成出价档位" : "生成出价档位"}</button>
        <span className={fieldErrors.has("waterfallTiers") ? "field-error" : "keyword-tier-help"} role="status">{fieldErrors.get("waterfallTiers") || "生成后可逐档修改出价和每活动日预算。"}</span>
      </div>
      {tiers.length ? (
        <div className="keyword-table-wrap keyword-tier-wrap">
          <table className="keyword-table keyword-tier-table" id="keyword-tiers">
            <thead><tr><th>档位</th><th>点击出价</th><th>每活动日预算</th><th>活动名称 / 问题</th></tr></thead>
            <tbody>{tiers.slice(offset, offset + PAGE_SIZE).map((tier, index) => {
              const position = offset + index;
              const issues = issuesByRow.get(tier.id) || [];
              return (
                <tr key={`${tier.id}-${position}`} className={issues.length ? "keyword-row--error" : ""}>
                  <td>第 {position + 1} 档</td>
                  <td><input aria-label={`第 ${position + 1} 档出价`} className="table-input" inputMode="decimal" onChange={event => onTierChange(position, "bid", event.target.value)} value={tier.bid} /></td>
                  <td><input aria-label={`第 ${position + 1} 档每活动日预算`} className="table-input" inputMode="decimal" onChange={event => onTierChange(position, "dailyBudget", event.target.value)} value={tier.dailyBudget} /></td>
                  <td>{summary.groups.map(group => <small className="keyword-tier-name" key={group.matchType}>{keywordWaterfallNames(tier, position, group.matchType).campaignName}</small>)}<span className="row-issue">{issues[0]?.message || ""}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
          {pageCount > 1 ? <div className="pagination" aria-label="关键词档位分页"><button disabled={page === 1} onClick={() => setPage(value => value - 1)} type="button">上一页</button><span>第 {page} / {pageCount} 页 · 共 {tiers.length} 档</span><button disabled={page === pageCount} onClick={() => setPage(value => value + 1)} type="button">下一页</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}
