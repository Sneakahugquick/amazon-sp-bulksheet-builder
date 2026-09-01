import { useEffect, useMemo, useState } from "react";
import { MATCH_TYPES } from "../lib/constants.js";
import { generatedStructureName } from "../lib/naming.js";
import { Icon } from "./Icons.jsx";

const PAGE_SIZE = 100;

export function KeywordTable({ rows, issuesByRow, onChange, onDelete, onAdd }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const visibleRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE).map((row, offset) => ({
      row,
      index: start + offset,
    }));
  }, [rows, page]);

  return (
    <div className="keyword-table-wrap">
      <table className="keyword-table">
        <thead>
          <tr>
            <th className="keyword-table__index">#</th>
            <th>关键词</th>
            <th className="keyword-table__match">匹配方式</th>
            <th className="keyword-table__bid">出价</th>
            <th className="keyword-table__structure">自动生成的活动 / 广告组 / 临时 ID</th>
            <th className="keyword-table__issue">问题</th>
            <th className="keyword-table__actions"><span className="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, index }) => {
            const rowIssues = issuesByRow.get(row.id) || [];
            const structureName = row.text.trim() ? generatedStructureName(row) : "";
            return (
              <tr key={row.id} className={rowIssues.length ? "keyword-row--error" : ""}>
                <td className="keyword-table__index">{index + 1}</td>
                <td>
                  <input
                    aria-label={`第 ${index + 1} 行关键词`}
                    className="table-input table-input--keyword"
                    maxLength={80}
                    onChange={(event) => onChange(row.id, "text", event.target.value)}
                    placeholder="输入关键词"
                    value={row.text}
                  />
                </td>
                <td>
                  <select
                    aria-label={`第 ${index + 1} 行匹配方式`}
                    className="table-input"
                    onChange={(event) => onChange(row.id, "matchType", event.target.value)}
                    value={row.matchType}
                  >
                    {MATCH_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>{item.value}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`第 ${index + 1} 行出价`}
                    className="table-input"
                    inputMode="decimal"
                    onChange={(event) => onChange(row.id, "bid", event.target.value)}
                    placeholder="0.00"
                    value={row.bid}
                  />
                </td>
                <td>
                  <div className="generated-structure" title={structureName}>
                    <strong>{structureName || "等待关键词"}</strong>
                    <small>Campaign、Ad Group、Campaign ID、Ad Group ID 共用此值</small>
                  </div>
                </td>
                <td>
                  <span className={rowIssues.length ? "row-issue" : "row-issue row-issue--none"}>
                    {rowIssues[0]?.message || "—"}
                  </span>
                </td>
                <td className="keyword-table__actions">
                  <button
                    aria-label={`删除第 ${index + 1} 行`}
                    className="icon-button"
                    onClick={() => onDelete(row.id)}
                    type="button"
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="keyword-table__footer">
        <button className="table-add-row" onClick={onAdd} type="button">
          <Icon name="plus" size={18} />
          补充一行
        </button>
        {pageCount > 1 ? (
          <div className="pagination" aria-label="关键词分页">
            <button disabled={page === 1} onClick={() => setPage((current) => current - 1)} type="button">上一页</button>
            <span>第 {page} / {pageCount} 页 · 共 {rows.length} 行</span>
            <button disabled={page === pageCount} onClick={() => setPage((current) => current + 1)} type="button">下一页</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
