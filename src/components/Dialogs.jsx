import { useEffect, useMemo, useState } from "react";
import { SP_HEADERS } from "../lib/constants.js";
import { Icon } from "./Icons.jsx";

const PREVIEW_PAGE_SIZE = 100;

function DialogShell({ title, description, children, onClose, wide = false }) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        aria-describedby="dialog-description"
        aria-modal="true"
        className={`dialog ${wide ? "dialog--wide" : ""}`}
        role="dialog"
      >
        <header className="dialog__header">
          <div>
            <h2>{title}</h2>
            <p id="dialog-description">{description}</p>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

const PREVIEW_HEADERS = [
  "Product",
  "Entity",
  "Operation",
  "Campaign ID",
  "Ad Group ID",
  "Campaign Name",
  "Ad Group Name",
  "SKU",
  "Bid",
  "Keyword Text",
  "Match Type",
];

export function PreviewDialog({ rows, onClose }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PREVIEW_PAGE_SIZE));
  const visibleRows = useMemo(() => {
    const start = (page - 1) * PREVIEW_PAGE_SIZE;
    return rows.slice(start, start + PREVIEW_PAGE_SIZE);
  }, [rows, page]);

  return (
    <DialogShell
      description={`共 ${rows.length} 行；每个关键词连续显示 Campaign、Ad Group、Product Ad、Keyword 四行。完整文件保留官方 ${SP_HEADERS.length} 列。`}
      onClose={onClose}
      title="预览生成行"
      wide
    >
      <div className="dialog__body preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>{PREVIEW_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${row.Entity}-${page}-${index}`}>
                {PREVIEW_HEADERS.map((header) => <td key={header}>{row[header] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="dialog__footer dialog__footer--spread">
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage((current) => current - 1)} type="button">上一页</button>
          <span>第 {page} / {pageCount} 页</span>
          <button disabled={page === pageCount} onClick={() => setPage((current) => current + 1)} type="button">下一页</button>
        </div>
        <button className="button button--primary" onClick={onClose} type="button">完成</button>
      </footer>
    </DialogShell>
  );
}
