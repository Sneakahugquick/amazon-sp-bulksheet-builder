# SP 批量广告表格生成器

这是一个完全在浏览器本地处理数据的 Amazon Sponsored Products 批量表格生成工具。每个关键词自动创建一套独立的 Campaign、Ad Group、Product Ad 和 Keyword，共 4 行。

## 使用方法

1. 打开 GitHub Pages 网页；离线使用时也可以双击 `启动工具.cmd`。
2. 填写 Seller SKU、每个广告活动的日预算、竞价策略和初始状态。
3. 从 Excel 批量粘贴“关键词 / 匹配方式 / 出价”三列；也可以只粘贴一列关键词并使用统一默认值。
4. 点击“解析并替换列表”。工具自动生成一词一活动、一词一广告组的结构。
5. 检查自动名称和错误提示，然后预览并导出 `.xlsx`。
6. 在 Amazon Ads 后台的 Bulk operations 页面上传导出的文件。

工具不会登录 Amazon、不会调用广告 API，也不会上传你的数据。草稿仅在你点击“保存草稿”后写入当前浏览器的本地存储；可以随时点击“清除本机草稿”。

## 隐私边界

- 公开仓库只包含程序、测试用虚构数据和空白 Amazon 模板。
- 实际关键词、SKU、出价和导出的 XLSX 不会提交到 GitHub。
- 网页没有分析统计、广告追踪或第三方数据接口。
- 导入模板限制为 `.xlsx`、最大 5 MB，并检查压缩包条目及解压体积。
- 浏览器草稿不会跨电脑同步，也不会上传 GitHub。

## 当前范围

- Sponsored Products
- 每个关键词创建一套独立 MANUAL 关键词广告
- `exact`、`phrase`、`broad`
- Seller SKU Product Ad
- Campaign / Ad Group / Product Ad / Keyword 四行结构
- Campaign Name、Campaign ID、Ad Group Name、Ad Group ID 均使用 `关键词-匹配方式`
- Start Date 自动使用工具运行当天
- 官方模板结构保留与导出前校验

现有广告更新、负面关键词、商品投放、自动广告和 Sponsored Brands 暂未包含在第一版。

## 开发检查

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm run check
```

推送到 `main` 分支后，最小权限 GitHub Actions 工作流会自动构建并发布 `dist` 到 GitHub Pages。
