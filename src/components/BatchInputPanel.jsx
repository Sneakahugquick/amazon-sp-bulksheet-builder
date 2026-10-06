import { useDeferredValue, useMemo, useState } from "react";
import { MATCH_TYPES } from "../lib/constants.js";
import { parsePastedKeywords } from "../lib/paste.js";
import { Icon } from "./Icons.jsx";

export function BatchInputPanel({
  defaultMatchType,
  defaultBid,
  waterfall = false,
  onDefaultChange,
  onImport,
}) {
  const [text, setText] = useState("");
  const deferredText = useDeferredValue(text);
  const parsed = useMemo(
    () => parsePastedKeywords(deferredText, {
      matchType: defaultMatchType,
      bid: defaultBid,
    }),
    [deferredText, defaultMatchType, defaultBid],
  );
  const isParsing = text !== deferredText;

  return (
    <div className="batch-input-panel">
      <div className="batch-input-panel__main">
        <label className="batch-textarea-label" htmlFor="batchKeywordText">
          <span>从 Excel 粘贴关键词</span>
          <small>一列关键词，或三列：关键词 / 匹配方式 / 出价</small>
        </label>
        <textarea
          id="batchKeywordText"
          onChange={(event) => setText(event.target.value)}
          placeholder={"关键词\t匹配方式\t出价\nabstract wall art\texact\t0.68\nneutral wall decor\tphrase\t0.54\nlarge canvas art\tbroad\t0.42"}
          value={text}
        />
        <div className={`parse-status ${parsed.warnings.length ? "parse-status--warning" : ""}`}>
          {isParsing ? "正在解析…" : `已识别 ${parsed.rows.length} 个关键词`}
          {!isParsing && parsed.warnings.length ? `；${parsed.warnings[0]}` : ""}
        </div>
      </div>

      <aside className="batch-input-panel__defaults" aria-label="单列粘贴默认值">
        <h3>单列粘贴默认值</h3>
        <p>{waterfall ? "使用默认匹配方式；所有关键词的出价以档位表为准，粘贴的出价会保留供单档模式使用。" : "如果只粘贴关键词一列，统一使用以下匹配方式和出价。"}</p>
        <label>
          <span>默认匹配方式</span>
          <select
            id="pasteDefaultMatchType"
            onChange={(event) => onDefaultChange("pasteDefaultMatchType", event.target.value)}
            value={defaultMatchType}
          >
            {MATCH_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{waterfall ? "单档模式默认出价（已保留）" : "默认出价"}</span>
          <input
            id="pasteDefaultBid"
            disabled={waterfall}
            inputMode="decimal"
            onChange={(event) => onDefaultChange("pasteDefaultBid", event.target.value)}
            placeholder="0.50"
            value={defaultBid}
          />
        </label>
        <button
          className="button button--primary button--wide"
          disabled={parsed.rows.length === 0 || isParsing}
          onClick={() => onImport(parsed.rows, "replace")}
          type="button"
        >
          <Icon name="clipboard" />
          解析并替换列表
        </button>
        <button
          className="button button--secondary button--wide"
          disabled={parsed.rows.length === 0 || isParsing}
          onClick={() => onImport(parsed.rows, "append")}
          type="button"
        >
          <Icon name="plus" />
          追加到现有列表
        </button>
      </aside>
    </div>
  );
}
