# MUMAKA / 木马卡：评分卡视觉方向比较

本目录保留上一阶段已制作的未选方案，仅作归档。按下一阶段任务，现有评分卡冻结，这些方案不接入应用或 Pages 构建。

本目录是独立设计沙盒，没有修改生产应用的品牌、工作流程、评分引擎、ScoreCard 或 Rose。

- **A / Swiss Grid**：无衬线字体、强横线、右上总分、六向扇区图。
- **B / Editorial Folio**：衬线标题、更大的原封面、小黑色分数栏、径向刻度。
- **C / Data Plate**：黑色刊头、水平六维量表、下方大总分。

三种方案使用同一张真实专辑：Radiohead《In Rainbows》（2007），真实封面及来源记录位于 `reference/`。六维 `[4, 4.5, 4, 4.5, 4.5, 4]` 与 `8.50` 仅作排版比较，**不是这张专辑的正式评价**；总分由现有评分引擎计算后写入 `layout-demo.json`，沙盒不另写评分公式。

```bash
python3 -m http.server 8766 --directory design/mumaka-concepts
```

- `index.html`：三方案并列比较。
- `index.html?concept=A&ratio=4%3A5`：A 的 1080×1350 原尺寸画布。
- `concept=B` / `concept=C`：其他两种设计。
- `ratio=3%3A4` / `ratio=1%3A1`：1080×1440 / 1080×1080。

自动截图前等待 `html[data-assets-ready="true"]`，定位 `article[data-concept="A"]`（或 B / C）。可调用 `window.renderConcepts(album, { ratio: '4:5' })` 更换同一组展示数据；`summary` 为空时不显示短评区域。沙盒只显示传入总分，不计算或推断专辑评价。

除真实封面固有色彩外，版式仅使用 `#111111`、`#FFFFFF`、`#F3F3F1`，并少量使用 `#D52B32`。没有渐变、投影、圆角面板、图标或装饰花瓣。
