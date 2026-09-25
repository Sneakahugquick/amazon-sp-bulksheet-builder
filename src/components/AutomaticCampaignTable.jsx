import { useEffect, useMemo, useState } from "react";
import { AUTO_TARGETING_TYPES } from "../lib/constants.js";

const PAGE_SIZE = 100;
const TARGET_LABELS = Object.fromEntries(AUTO_TARGETING_TYPES.map((item) => [item.value, item.label]));

export function AutomaticCampaignTable({ campaigns, issuesByRow, onChange }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const visibleRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return campaigns.slice(start, start + PAGE_SIZE).map((campaign, offset) => ({ campaign, index: start + offset }));
  }, [campaigns, page]);

  if (!campaigns.length) {
    return (
      <div className="automatic-empty-state">
        <strong>还没有活动预览</strong>
        <p>填入 SKU、每活动日预算、基准点击出价、间隔和档位数，再生成自动活动。</p>
      </div>
    );
  }

  return (
    <div className="automatic-table-wrap">
      <table className="automatic-table">
        <thead>
          <tr>
            <th className="automatic-table__index">#</th>
            <th className="automatic-table__dimension">档位 / 活动内容</th>
            <th>活动名称</th>
            <th>广告组名称</th>
            <th className="automatic-table__money">日预算</th>
            <th className="automatic-table__money">出价</th>
            <th className="automatic-table__state">状态</th>
            <th className="automatic-table__issue">问题</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ campaign, index }) => {
            const rowIssues = issuesByRow.get(campaign.id) || [];
            return (
              <tr className={rowIssues.length ? "automatic-row--error" : ""} key={campaign.id}>
                <td className="automatic-table__index">{index + 1}</td>
                <td>
                  <div className="matrix-dimension">
                    <strong>第 {campaign.tierNumber} 档 · {campaign.bid}</strong>
                    <span title={campaign.skus.join("、")}>{campaign.skus.length} 个 SKU</span>
                    <code title={campaign.targetingTypes.map((value) => TARGET_LABELS[value] || value).join("、")}>{campaign.targetingTypes.length} 种投放</code>
                    <small title={campaign.temporaryId}>{campaign.temporaryId}</small>
                  </div>
                </td>
                <td><input aria-label={`第 ${index + 1} 行活动名称`} className="table-input" maxLength={128} onChange={(event) => onChange(campaign.id, "campaignName", event.target.value)} value={campaign.campaignName} /></td>
                <td><input aria-label={`第 ${index + 1} 行广告组名称`} className="table-input" maxLength={255} onChange={(event) => onChange(campaign.id, "adGroupName", event.target.value)} value={campaign.adGroupName} /></td>
                <td><span className="automatic-table__shared-budget">{campaign.dailyBudget}</span></td>
                <td><input aria-label={`第 ${index + 1} 行出价`} className="table-input" inputMode="decimal" onChange={(event) => onChange(campaign.id, "bid", event.target.value)} value={campaign.bid} /></td>
                <td>
                  <select aria-label={`第 ${index + 1} 行状态`} className={`state-select state-select--${campaign.state}`} onChange={(event) => onChange(campaign.id, "state", event.target.value)} value={campaign.state}>
                    <option value="paused">paused</option>
                    <option value="enabled">enabled</option>
                  </select>
                </td>
                <td><span className={rowIssues.length ? "row-issue" : "row-issue row-issue--none"}>{rowIssues[0]?.message || "—"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pageCount > 1 ? (
        <div className="automatic-table__footer">
          <div className="pagination" aria-label="自动活动分页">
            <button disabled={page === 1} onClick={() => setPage((current) => current - 1)} type="button">上一页</button>
            <span>第 {page} / {pageCount} 页 · 共 {campaigns.length} 套</span>
            <button disabled={page === pageCount} onClick={() => setPage((current) => current + 1)} type="button">下一页</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
