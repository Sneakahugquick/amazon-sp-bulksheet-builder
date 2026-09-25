import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { parsePastedNegativeProducts } from "../lib/paste.js";
import { Icon } from "./Icons.jsx";

const PAGE_SIZE = 100;

export function NegativeProductPanel({
  rows,
  issuesByRow,
  onImport,
  onChange,
  onDelete,
  onAdd,
  onClear,
  onClearProblems,
  problemCount = 0,
}) {
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const deferredText = useDeferredValue(text);
  const parsed = useMemo(() => parsePastedNegativeProducts(deferredText), [deferredText]);
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
          <label className="batch-textarea-label" htmlFor="automaticNegativeProductPasteText">
            <span>从 Excel 粘贴否定商品</span>
            <small>每行一个 ASIN，或粘贴 ASIN 列</small>
          </label>
          <textarea
            id="automaticNegativeProductPasteText"
            onChange={(event) => setText(event.target.value)}
            placeholder={"ASIN\nB0ABC12345\nB0DEF67890"}
            value={text}
          />
          <div className="parse-status">
            {isParsing ? "正在解析…" : `已识别 ${parsed.rows.length} 个否定商品`}
          </div>
        </div>

        <aside className="batch-input-panel__defaults" aria-label="否定商品导入规则">
          <h3>ASIN 导入规则</h3>
          <p>接受 10 位字母或数字；导出时写为 Negative Product Targeting 的 asin 表达式。</p>
          <button
            className="button button--primary button--wide"
            disabled={parsed.rows.length === 0 || isParsing}
            onClick={() => onImport(parsed.rows, "replace")}
            type="button"
          >
            <Icon name="clipboard" />
            解析并替换商品
          </button>
          <button
            className="button button--secondary button--wide"
            disabled={parsed.rows.length === 0 || isParsing}
            onClick={() => onImport(parsed.rows, "append")}
            type="button"
          >
            <Icon name="plus" />
            追加否定商品
          </button>
        </aside>
      </div>

      <div className="negative-keyword-list-header">
        <h3>否定商品列表</h3>
        <div className="keyword-toolbar">
          <button className="button button--secondary" onClick={onAdd} type="button">
            <Icon name="plus" />补充一行
          </button>
          {onClearProblems ? (
            <button
              aria-label={`清除有问题的否定商品行${problemCount ? `（${problemCount}）` : ""}`}
              className="button button--danger-quiet"
              disabled={!problemCount}
              onClick={onClearProblems}
              type="button"
            >
              <Icon name="alert" />清除有问题的行{problemCount ? `（${problemCount}）` : ""}
            </button>
          ) : null}
          <button className="button button--quiet" onClick={onClear} type="button">
            <Icon name="trash" />清空
          </button>
        </div>
      </div>

      <div className="keyword-table-wrap negative-keyword-table-wrap">
        <table className="keyword-table negative-product-table">
          <thead>
            <tr>
              <th className="keyword-table__index">#</th>
              <th>否定商品 ASIN</th>
              <th>导出表达式</th>
              <th className="negative-keyword-table__issue">问题</th>
              <th className="keyword-table__actions"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }) => {
              const rowIssues = issuesByRow.get(row.id) || [];
              const asin = String(row.asin || "").trim().toUpperCase();
              return (
                <tr key={row.id} className={rowIssues.length ? "keyword-row--error" : ""}>
                  <td className="keyword-table__index">{index + 1}</td>
                  <td>
                    <input
                      aria-label={`第 ${index + 1} 行否定商品 ASIN`}
                      className="table-input table-input--keyword"
                      maxLength={10}
                      onChange={(event) => onChange(row.id, "asin", event.target.value.toUpperCase())}
                      placeholder="B0ABC12345"
                      value={row.asin}
                    />
                  </td>
                  <td><code className="target-expression">{asin ? `asin="${asin}"` : "—"}</code></td>
                  <td>
                    <span className={rowIssues.length ? "row-issue" : "row-issue row-issue--none"}>
                      {rowIssues[0]?.message || "—"}
                    </span>
                  </td>
                  <td className="keyword-table__actions">
                    <button
                      aria-label={`删除第 ${index + 1} 行否定商品`}
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
            <div className="pagination" aria-label="否定商品分页">
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
