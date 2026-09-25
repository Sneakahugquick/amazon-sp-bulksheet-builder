# SP 批量广告表格生成器

这是一个完全在浏览器本地处理数据的 Amazon Sponsored Products 批量表格生成工具，包含“关键词广告”和“自动广告”两个页面。两种模式都复用同一份 Amazon Ads 官方 XLSX 模板，不连接广告账户。

## 使用方法

1. 打开 GitHub Pages 网页；离线使用时也可以双击 `启动工具.cmd`。
2. 选择“关键词广告”或“自动广告”。

### 关键词广告

1. 填写 Seller SKU、每个广告活动的日预算、竞价策略和初始状态。
2. 从 Excel 批量粘贴“关键词 / 匹配方式 / 出价”三列；也可以只粘贴一列关键词并使用统一默认值。
3. 点击“解析并替换列表”。工具自动生成一词一活动、一词一广告组的结构。
4. 检查关键词列表后，在独立的“批量添加否定词”区域粘贴“否定词 / 否定方式”两列；只粘贴一列时可统一选择精准否定或词组否定。
5. 每个否定词会应用到全部关键词广告组；检查实体计数后预览并导出 `.xlsx`。

### 自动广告

1. 每行输入一个 Seller SKU，并填写每个自动广告活动的日预算。所有档位使用同一预算。
2. 选择 `close-match`、`loose-match`、`substitutes`、`complements` 中需要的自动投放类型。
3. 填写基准点击出价、每档递减间隔和档位数。0.50 基准、0.01 间隔、10 档会规划 0.50、0.49……0.41，共 10 个活动。
4. 在两个独立区域分别批量添加前置否定关键词和否定商品 ASIN；两类列表只应用到自动广告，不与关键词广告页共用。
5. 每档生成一个独立活动；每个活动都包含全部 Seller SKU 和已选自动投放类型，只让点击出价逐档递减。
6. 在活动预览中编辑名称、出价和状态；每活动日预算在上方统一设置。
7. 预览 32 列模板行并导出 `.xlsx`。每个活动包含一行 Campaign、一行 Ad Group、每个 SKU 一行 Product Ad、每种已选自动类型一行 Product Targeting，并追加独立的否定项行。

导出后的文件可由操作人员自行检查和使用；本工具本身不会上传文件或调用广告 API。

工具不会登录 Amazon、不会调用广告 API，也不会上传你的数据。草稿仅在你点击“加密保存”后写入当前浏览器的本地存储：密码通过 PBKDF2 派生 AES-GCM 密钥，密码和密钥均不保存。恢复草稿时需要再次输入密码；可以随时点击“清除本机草稿”。

## 隐私边界

- 公开仓库只包含程序、测试用虚构数据和空白 Amazon 模板。
- 实际关键词、SKU、出价和导出的 XLSX 不会提交到 GitHub。
- 网页没有分析统计、广告追踪或第三方数据接口。
- 导入模板限制为 `.xlsx`、最大 5 MB，并且必须通过当前内置官方模板的 SHA-256 可信摘要校验；任意修改或其他模板会在解压前被拒绝。
- 浏览器草稿不会跨电脑同步，也不会上传 GitHub。
- v4 加密草稿同时保存关键词广告和自动广告。旧版 v2/v3 明文草稿首次载入后会从浏览器存储中清除；请随后使用密码重新加密保存。
- 按旧矩阵规则保存的自动广告草稿恢复后会保留 SKU、投放类型和否定项；由于预算和出价含义已变，需重新填写每活动预算和基准出价并生成活动。

## 当前范围

- Sponsored Products
- 每个关键词创建一套独立 MANUAL 关键词广告
- 每个出价档位创建一套独立 AUTO 广告；每套包含相同的 SKU 和已选自动投放类型
- `exact`、`phrase`、`broad`
- 正向与否定关键词在导出前校验 Amazon 的每词最多 10 个单词、80 个字符限制
- 可独立批量添加广告组级否定词，支持 `negativeExact`、`negativePhrase`，整批应用到全部 MANUAL 广告组
- `close-match`、`loose-match`、`substitutes`、`complements`
- 自动广告可独立批量前置 `negativeExact` / `negativePhrase` 否定关键词和否定商品 ASIN
- Seller SKU Product Ad
- MANUAL：Campaign / Ad Group / Product Ad / Keyword 四个基础行；每个批量否定词为每套广告追加一个 Negative Keyword 行
- AUTO：每个活动各有 Campaign / Ad Group 行；每个 SKU 各一行 Product Ad、每种投放类型各一行 Product Targeting；否定项分别追加
- MANUAL 的 Campaign Name、Campaign ID、Ad Group Name、Ad Group ID 均使用 `关键词-匹配方式`
- AUTO 使用 `AUTO-序号-BID-出价` 格式的唯一临时 ID，名称可在预览中编辑
- Start Date 自动使用工具运行当天
- 官方模板结构保留与导出前校验

现有广告更新、Campaign 级否定关键词、手动商品投放和 Sponsored Brands 暂未包含。

## 开发检查

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm run check
```

推送到 `main` 分支后，最小权限 GitHub Actions 工作流会自动构建并发布 `dist` 到 GitHub Pages。
