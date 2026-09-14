import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { NEGATIVE_MATCH_TYPES } from "../lib/constants.js";
import { parsePastedNegativeKeywords } from "../lib/paste.js";
import { Icon } from "./Icons.jsx";

const PAGE_SIZE = 100;

export function NegativeKeywordPanel({
  rows,
  issuesByRow,
  onImport,
  onChange,
  onDelete,
  onAdd,
  onClear,
}) {
  const [text, setText] = useState("");
  const [defaultMatchType, setDefaultMatchType] = useState("negativeExact");
  const [page, setPage] = useState(1);
  const deferredText = useDeferredValue(text);
  const parsed = useMemo(
    () => parsePastedNegativeKeywords(deferredText, defaultMatchType),
    [deferredText, defaultMatchType],
  );
  const isParsing = text !== deferredText;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE).map((row, offset) => ({
      row,
      index: start + offset,
    }));
  }, [rows, page]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <>
      <div className="batch-input-panel batch-input-panel--negative">
        <div className="batch-input-panel__main">
          <label className="batch-textarea-label" htmlFor="batchNegativeKeywordText">
            <span>从 Excel 粘贴否定词</span>
            <small>一列否定词，或两列：否定词 / 否定方式</small>
          </label>
          <textarea
            id="batchNegativeKeywordText"
            onChange={(event) => setText(event.target.value)}
            placeholder={"否定词\t否定方式\nposter\tnegativeExact\nframed\tnegativePhrase\ncheap"}
            value={text}
          />
          <div className={`parse-status ${parsed.warnings.length ? "parse-status--warning" : ""}`}>
            {isParsing ? "正在解析…" : `已识别 ${parsed.rows.length} 个否定词`}
            {!isParsing && parsed.warnings.length ? `；${parsed.warnings[0]}` : ""}
          </div>
        </div>

        <aside className="batch-input-panel__defaults" aria-label="单列否定词默认值">
          <h3>单列粘贴默认值</h3>
          <p>如果只粘贴否定词一列，统一使用以下否定方式。</p>
          <label>
            <span>默认否定方式</span>
            <select
              onChange={(event) => setDefaultMatchType(event.target.value)}
              value={defaultMatchType}
            >
              {NEGATIVE_MATCH_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <button
            className="button button--primary button--wide"
            disabled={parsed.rows.length === 0 || isParsing}
            onClick={() => onImport(parsed.rows, "replace")}
            type="button"
          >
            <Icon name="clipboard" />
            解析并替换否定词
          </button>
          <button
            className="button button--secondary button--wide"
            disabled={parsed.rows.length === 0 || isParsing}
            onClick={() => onImport(parsed.rows, "append")}
            type="button"
          >
            <Icon name="plus" />
            追加否定词
          </button>
        </aside>
      </div>

      <div className="negative-keyword-list-header">
        <h3>否定词列表</h3>
        <div className="keyword-toolbar">
          <button className="button button--secondary" onClick={onAdd} type="button">
            <Icon name="plus" />补充一行
          </button>
          <button className="button button--quiet" onClick={onClear} type="button">
            <Icon name="trash" />清空
          </button>
        </div>
      </div>

      <div className="keyword-table-wrap negative-keyword-table-wrap">
        <table className="keyword-table negative-keyword-table">
          <thead>
            <tr>
              <th className="keyword-table__index">#</th>
              <th>否定词</th>
              <th className="negative-keyword-table__match">否定方式</th>
              <th className="negative-keyword-table__issue">问题</th>
              <th className="keyword-table__actions"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }) => {
              const rowIssues = issuesByRow.get(row.id) || [];
              return (
                <tr key={row.id} className={rowIssues.length ? "keyword-row--error" : ""}>
                  <td className="keyword-table__index">{index + 1}</td>
                  <td>
                    <input
                      aria-label={`第 ${index + 1} 行否定词`}
                      className="table-input table-input--keyword"
                      maxLength={80}
                      onChange={(event) => onChange(row.id, "text", event.target.value)}
                      placeholder="输入否定词"
                      value={row.text}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`第 ${index + 1} 行否定方式`}
                      className="table-input"
                      onChange={(event) => onChange(row.id, "matchType", event.target.value)}
                      value={row.matchType}
                    >
                      {NEGATIVE_MATCH_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={rowIssues.length ? "row-issue" : "row-issue row-issue--none"}>
                      {rowIssues[0]?.message || "—"}
                    </span>
                  </td>
                  <td className="keyword-table__actions">
                    <button
                      aria-label={`删除第 ${index + 1} 行否定词`}
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
        {pageCount > 1 ? (
          <div className="keyword-table__footer">
            <div className="pagination" aria-label="否定词分页">
              <button disabled={page === 1} onClick={() => setPage((current) => current - 1)} type="button">上一页</button>
              <span>第 {page} / {pageCount} 页 · 共 {rows.length} 行</span>
              <button disabled={page === pageCount} onClick={() => setPage((current) => current + 1)} type="button">下一页</button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
