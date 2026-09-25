import { AUTO_TARGETING_TYPES, BIDDING_STRATEGIES } from "../lib/constants.js";
import { FormField } from "./FormField.jsx";
import { Icon } from "./Icons.jsx";

export function AutomaticSetupPanel({
  settings,
  fieldErrors,
  campaignCount,
  bidPlan,
  skuCount,
  onChange,
  onToggleTargeting,
  onGenerate,
  generatedCount,
  canGenerate,
  legacyNotice,
}) {
  return (
    <>
      <section className="workspace-section" id="automatic-settings">
        {legacyNotice ? <p className="section-error" role="alert">旧版自动活动的预算和出价规则已更新。SKU、投放类型及否定项已保留，请重新填写每活动预算与基准出价，再生成活动。</p> : null}
        <div className="section-title">
          <h2>商品与活动预算</h2>
          <span>全部商品用于每个活动</span>
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
            <FormField label="每个广告活动的日预算" required error={fieldErrors.get("dailyBudget")}>
              <div className="input-suffix">
                <input
                  id="automaticDailyBudget"
                  inputMode="decimal"
                  onChange={(event) => onChange("dailyBudget", event.target.value)}
                  placeholder="20.00"
                  value={settings.dailyBudget}
                />
                <span>站点货币</span>
              </div>
            </FormField>
            <div className="budget-formula" aria-label="活动预算规则">
              <span>预算规则</span>
              <strong>每档均为 {settings.dailyBudget || "0.00"}</strong>
              <small>预算应用到每个活动；档位之间只改变点击出价。</small>
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
          <h2>点击出价阶梯</h2>
          <span>{campaignCount} 档 = {campaignCount} 个活动</span>
        </div>
        <div className="automatic-bid-grid">
          <FormField label="基准点击出价" required error={fieldErrors.get("baseBid")}>
            <input id="automaticBaseBid" inputMode="decimal" onChange={(event) => onChange("baseBid", event.target.value)} placeholder="0.50" value={settings.baseBid} />
          </FormField>
          <FormField label="每档递减间隔" required error={fieldErrors.get("bidInterval")}>
            <input id="automaticBidInterval" inputMode="decimal" onChange={(event) => onChange("bidInterval", event.target.value)} placeholder="0.01" value={settings.bidInterval} />
          </FormField>
          <FormField label="活动档位数" required error={fieldErrors.get("tierCount")}>
            <input id="automaticTierCount" inputMode="numeric" onChange={(event) => onChange("tierCount", event.target.value)} placeholder="10" value={settings.tierCount} />
          </FormField>
        </div>
        {bidPlan.length ? (
          <div className="automatic-bid-plan" aria-live="polite">
            <span>自动规划出价</span>
            <strong>{bidPlan.slice(0, 10).join(" → ")}{bidPlan.length > 10 ? ` → … → ${bidPlan.at(-1)}` : ""}</strong>
            <small>第 1 档 = 基准价；其后每档减去间隔。</small>
          </div>
        ) : null}
      </section>

      <section className="generation-callout" id="automatic-generate">
        <div>
          <span>即将生成</span>
          <strong>{campaignCount} 档出价 → {campaignCount} 个独立活动</strong>
          <small>每个活动都包含 {skuCount} 个 SKU、{settings.selectedTargetingTypes.length} 种自动投放，并使用相同日预算。</small>
        </div>
        <button className="button button--primary" disabled={!canGenerate} onClick={onGenerate} type="button">
          <Icon name={generatedCount ? "refresh" : "plus"} />
          {generatedCount ? "重新生成活动" : "生成自动活动"}
        </button>
      </section>
    </>
  );
}
