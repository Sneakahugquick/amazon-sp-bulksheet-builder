import { ENTITY_LABELS } from "../lib/constants.js";
import { Icon } from "./Icons.jsx";

export function SummaryRail({
  template,
  counts,
  totalRows,
  issues,
  exporting,
  onPreview,
  onExport,
}) {
  const ready = issues.length === 0;
  return (
    <aside className="summary-rail" aria-label="校验与导出">
      <h2>校验与导出</h2>

      <section className={`template-status ${template?.valid ? "template-status--ok" : ""}`}>
        <div className="template-status__headline">
          <span className="status-icon">
            <Icon name={template?.valid ? "check" : "file"} size={17} />
          </span>
          <strong>{template?.valid ? "模板已识别" : "正在读取模板"}</strong>
        </div>
        <p>{template?.valid ? "Sponsored Products Campaigns · 32列" : "等待官方 XLSX 模板"}</p>
        {template?.fileName ? <small title={template.fileName}>{template.fileName}</small> : null}
      </section>

      <section className="row-summary">
        <h3>将创建 {counts.Campaign || 0} 套独立广告</h3>
        <p className="row-summary__caption">每套 4 行，共 {totalRows} 行</p>
        <dl>
          {Object.keys(ENTITY_LABELS).map((entity) => (
            <div key={entity}>
              <dt>{ENTITY_LABELS[entity]}</dt>
              <dd>{counts[entity] || 0}</dd>
            </div>
          ))}
          <div className="row-summary__total">
            <dt>合计</dt>
            <dd>{totalRows}</dd>
          </div>
        </dl>
      </section>

      <section className={`validation-card ${ready ? "validation-card--ready" : "validation-card--blocked"}`}>
        <div className="validation-card__headline">
          <span className="status-icon">
            <Icon name={ready ? "check" : "alert"} size={17} />
          </span>
          <strong>{ready ? "可以导出" : `还需处理 ${issues.length} 个问题`}</strong>
        </div>
        <p>{ready ? "未发现阻塞性问题" : issues[0]?.message}</p>
      </section>

      <div className="summary-actions">
        <button
          className="button button--secondary button--wide"
          disabled={!ready}
          onClick={onPreview}
          type="button"
        >
          <Icon name="eye" />
          预览生成行
        </button>
        <button
          className="button button--primary button--wide"
          disabled={!ready || exporting}
          onClick={onExport}
          type="button"
        >
          <Icon name="download" />
          {exporting ? "正在生成…" : "导出 XLSX"}
        </button>
      </div>

      <p className="summary-note">
        导出的文件保留原模板工作表、隐藏配置和下拉规则，不会连接广告账号。
      </p>
    </aside>
  );
}
