import { useRef } from "react";
import { FormField } from "./FormField.jsx";
import {
  NAME_LIMITS,
  NAME_MATCH_STYLES,
  NAME_PATTERNS,
  NAME_SEPARATORS,
  NAME_TOKENS,
  namePatternLabel,
  presetTemplate,
} from "../lib/naming.js";

const MODE_NOTES = {
  single: "前缀留空、用默认方案时，名称和原来一样",
  waterfall: "瀑布模式按档位命名，前缀加在最前面",
  automatic: "前缀加在自动活动名最前面；生成后仍可在预览表里逐个改名",
};

const isKnown = (options, value) => options.some((item) => item.value === value);

// mode: "single" (keyword ads, one campaign per keyword), "waterfall" or "automatic".
// The last two keep their fixed tier names, so only the prefix applies there.
export function NamingSettings({ mode, settings, fieldErrors, onChange, example }) {
  const templateRef = useRef(null);
  const caretRef = useRef(null);
  const full = mode === "single";
  const pattern = settings.namePattern ?? "keyword-match";
  const separator = settings.nameSeparator ?? "-";
  const matchStyle = settings.nameMatchStyle ?? "lower";
  const template = settings.nameTemplate ?? "";
  const custom = full && pattern === "custom";

  function changePattern(value) {
    // Start a custom template from the scheme in use rather than from an empty box.
    if (value === "custom" && !template.trim()) onChange("nameTemplate", presetTemplate(pattern, separator));
    onChange("namePattern", value);
  }

  function insertToken(key) {
    const caret = Math.min(caretRef.current ?? template.length, template.length);
    const before = template.slice(0, caret);
    const after = template.slice(caret);
    const joiner = isKnown(NAME_SEPARATORS, separator) ? separator : "-";
    const lead = before && !/[-_|\s]$/.test(before) ? joiner : "";
    const trail = after && !/^[-_|\s]/.test(after) ? joiner : "";
    const token = `{${key}}`;
    const position = before.length + lead.length + token.length;
    caretRef.current = position;
    onChange("nameTemplate", `${before}${lead}${token}${trail}${after}`);
    window.requestAnimationFrame(() => {
      const input = templateRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(position, position);
    });
  }

  const rememberCaret = (event) => {
    caretRef.current = event.target.selectionStart;
  };

  return (
    <div className="naming-settings" id={mode === "automatic" ? "automatic-naming" : "keyword-naming"}>
      <div className="naming-settings__title">
        <h3>活动命名</h3>
        <span>{MODE_NOTES[mode]}</span>
      </div>
      <div className={full ? "naming-settings__grid" : "naming-settings__grid naming-settings__grid--prefix"}>
        <FormField label="名称前缀" hint="可选，留空则不加" error={fieldErrors.get("namePrefix")}>
          <input
            id={mode === "automatic" ? "automaticNamePrefix" : "namePrefix"}
            maxLength={NAME_LIMITS.prefix}
            onChange={(event) => onChange("namePrefix", event.target.value)}
            placeholder="例如 FP01"
            value={settings.namePrefix ?? ""}
          />
        </FormField>
        {full ? (
          <>
            <FormField label="命名方案" error={fieldErrors.get("namePattern")}>
              <select id="namePattern" onChange={(event) => changePattern(event.target.value)} value={pattern}>
                {!isKnown(NAME_PATTERNS, pattern) ? <option value={pattern}>{namePatternLabel(pattern)}</option> : null}
                {NAME_PATTERNS.map((item) => <option key={item.value} value={item.value}>{namePatternLabel(item.value, separator)}</option>)}
              </select>
            </FormField>
            <FormField label="分隔符" hint={custom ? "点变量插入时使用" : ""} error={fieldErrors.get("nameSeparator")}>
              <select id="nameSeparator" onChange={(event) => onChange("nameSeparator", event.target.value)} value={separator}>
                {!isKnown(NAME_SEPARATORS, separator) ? <option value={separator}>分隔符无效，请重新选择</option> : null}
                {NAME_SEPARATORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </FormField>
            <FormField label="匹配方式写法" error={fieldErrors.get("nameMatchStyle")}>
              <select id="nameMatchStyle" onChange={(event) => onChange("nameMatchStyle", event.target.value)} value={matchStyle}>
                {!isKnown(NAME_MATCH_STYLES, matchStyle) ? <option value={matchStyle}>写法无效，请重新选择</option> : null}
                {NAME_MATCH_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </FormField>
          </>
        ) : null}
      </div>
      {custom ? (
        <div className="naming-template">
          <FormField label="自定义模板" hint="点下面的变量插入到光标处，其他文字原样保留" error={fieldErrors.get("nameTemplate")}>
            <input
              id="nameTemplate"
              maxLength={NAME_LIMITS.template}
              onChange={(event) => {
                rememberCaret(event);
                onChange("nameTemplate", event.target.value);
              }}
              onSelect={rememberCaret}
              placeholder="{前缀}-{关键词}-{匹配}"
              ref={templateRef}
              spellCheck={false}
              value={template}
            />
          </FormField>
          <div aria-label="插入命名变量" className="naming-tokens" role="group">
            {NAME_TOKENS.map((token) => (
              <button className="naming-token" key={token.key} onClick={() => insertToken(token.key)} title={token.hint} type="button">
                {`{${token.key}}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="naming-preview">
        <span>名称示例</span>
        <code title={example.name}>{example.name || "—"}</code>
        {example.note ? <small>{example.note}</small> : null}
      </div>
    </div>
  );
}
