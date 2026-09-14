import { AUTO_TARGETING_TYPES, BIDDING_STRATEGIES } from "../lib/constants.js";
import { FormField } from "./FormField.jsx";
import { Icon } from "./Icons.jsx";

export function AutomaticSetupPanel({
  settings,
  fieldErrors,
  tierIssues,
  matrixCount,
  skuCount,
  onChange,
  onToggleTargeting,
  onTierChange,
  onAddTier,
  onDeleteTier,
  onGenerate,
  generatedCount,
  canGenerate,
}) {
  return (
    <>
      <section className="workspace-section" id="automatic-settings">
        <div className="section-title">
          <h2>生成范围与总预算</h2>
          <span>完整组合 · 不抽样</span>
        </div>
        <div className="automatic-input-grid">
          <FormField label="Seller SKU 列表" required error={fieldErrors.get("skuText")}>
            <textarea
              className="sku-textarea"
              id="automaticSkuText"
              onChange={(event) => onChange("skuText", event.target.value)}
              placeholder={"每行一个 Seller SKU\nCANVAS-001\nCANVAS-002"}
              value={settings.skuText}
            />
          </FormField>
          <div className="automatic-settings-card">
            <FormField label="所有活动合计日预算" required error={fieldErrors.get("totalDailyBudget")}>
              <div className="input-suffix">
                <input
                  id="automaticTotalBudget"
                  inputMode="decimal"
                  onChange={(event) => onChange("totalDailyBudget", event.target.value)}
                  placeholder="40.00"
                  value={settings.totalDailyBudget}
                />
                <span>站点货币</span>
              </div>
            </FormField>
            <div className="budget-formula" aria-label="预算分配公式">
              <span>预算分配</span>
              <strong>{settings.totalDailyBudget || "0.00"} ÷ {matrixCount || 0} 个活动</strong>
              <small>按美分平均分配；余数按预览顺序补齐，合计不变。</small>
            </div>
          </div>
        </div>

        <div className="form-grid form-grid--batch automatic-common-fields">
          <FormField label="开始日期" hint="自动使用今天">
            <input readOnly value={settings.startDate} />
          </FormField>
          <FormField label="竞价策略" required error={fieldErrors.get("biddingStrategy")}>
            <select onChange={(event) => onChange("biddingStrategy", event.target.value)} value={settings.biddingStrategy}>
              {BIDDING_STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}
            </select>
          </FormField>
          <FormField label="初始状态" required error={fieldErrors.get("state")}>
            <select onChange={(event) => onChange("state", event.target.value)} value={settings.state}>
              <option value="paused">已暂停 · paused</option>
              <option value="enabled">已启用 · enabled</option>
            </select>
          </FormField>
        </div>

        <details className="advanced-settings">
          <summary>可选设置</summary>
          <div className="form-grid form-grid--advanced">
            <FormField label="Portfolio ID" hint="留空则不加入 Portfolio">
              <input onChange={(event) => onChange("portfolioId", event.target.value)} placeholder="可选" value={settings.portfolioId} />
            </FormField>
            <FormField label="结束日期" error={fieldErrors.get("endDate")} hint="留空则长期运行">
              <input inputMode="numeric" maxLength={8} onChange={(event) => onChange("endDate", event.target.value)} placeholder="YYYYMMDD" value={settings.endDate} />
            </FormField>
            <FormField label="Off-Amazon ad serving" hint="留空则使用 Amazon 默认设置">
              <select onChange={(event) => onChange("offAmazon", event.target.value)} value={settings.offAmazon}>
                <option value="">留空</option>
                <option value="Increase reach">Increase reach</option>
                <option value="Limit off-Amazon spend">Limit off-Amazon spend</option>
              </select>
            </FormField>
          </div>
        </details>
      </section>

      <section className="workspace-section" id="automatic-targeting">
        <div className="section-title">
          <h2>自动投放类型</h2>
          <span>{settings.selectedTargetingTypes.length} / 4 已选择</span>
        </div>
        <div className={`targeting-grid ${fieldErrors.get("selectedTargetingTypes") ? "control-error" : ""}`}>
          {AUTO_TARGETING_TYPES.map((item) => {
            const checked = settings.selectedTargetingTypes.includes(item.value);
            return (
              <label className={`targeting-card ${checked ? "targeting-card--selected" : ""}`} key={item.value}>
                <input checked={checked} onChange={() => onToggleTargeting(item.value)} type="checkbox" />
                <span className="targeting-card__check"><Icon name="check" size={15} /></span>
                <span>
                  <strong>{item.label}</strong>
                  <code>{item.value}</code>
                  <small>{item.description}</small>
                </span>
              </label>
            );
          })}
        </div>
        {fieldErrors.get("selectedTargetingTypes") ? <p className="section-error">{fieldErrors.get("selectedTargetingTypes")}</p> : null}
      </section>

      <section className="workspace-section" id="automatic-tiers">
        <div className="section-title">
          <h2>出价档位</h2>
          <span>{settings.bidTiers.length} 个档位</span>
        </div>
        <div className={`bid-tier-list ${fieldErrors.get("bidTiers") ? "control-error" : ""}`}>
          <div className="bid-tier-list__header"><span>档位名称</span><span>每次点击出价</span><span aria-hidden="true" /></div>
          {settings.bidTiers.map((tier, index) => {
            const rowIssues = tierIssues.get(tier.id) || [];
            return (
              <div className={`bid-tier-row ${rowIssues.length ? "bid-tier-row--error" : ""}`} key={tier.id}>
                <input aria-label={`第 ${index + 1} 个档位名称`} maxLength={40} onChange={(event) => onTierChange(tier.id, "label", event.target.value)} placeholder="例如：标准档" value={tier.label} />
                <div className="input-suffix">
                  <input aria-label={`第 ${index + 1} 个档位出价`} inputMode="decimal" onChange={(event) => onTierChange(tier.id, "bid", event.target.value)} placeholder="0.50" value={tier.bid} />
                  <span>站点货币</span>
                </div>
                <button aria-label={`删除第 ${index + 1} 个档位`} className="icon-button" disabled={settings.bidTiers.length === 1} onClick={() => onDeleteTier(tier.id)} type="button">
                  <Icon name="trash" size={17} />
                </button>
                {rowIssues.length ? <small className="bid-tier-row__error">{rowIssues[0].message}</small> : null}
              </div>
            );
          })}
          <button className="table-add-row" onClick={onAddTier} type="button"><Icon name="plus" size={18} />添加出价档位</button>
        </div>
      </section>

      <section className="generation-callout" id="automatic-generate">
        <div>
          <span>即将生成</span>
          <strong>{skuCount} SKU × {settings.selectedTargetingTypes.length} 类型 × {settings.bidTiers.length} 档位 = {matrixCount} 套活动</strong>
          <small>每套连续写入 Campaign、Ad Group、Product Ad、Product Targeting 四行。</small>
          {fieldErrors.get("matrix") ? <small className="generation-callout__error">{fieldErrors.get("matrix")}</small> : null}
        </div>
        <button className="button button--primary" disabled={!canGenerate} onClick={onGenerate} type="button">
          <Icon name={generatedCount ? "refresh" : "plus"} />
          {generatedCount ? "重新生成矩阵" : "生成活动矩阵"}
        </button>
      </section>
    </>
  );
}
