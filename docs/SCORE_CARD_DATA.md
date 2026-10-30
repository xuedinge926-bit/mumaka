# 评分卡数据边界

当前评分卡视觉、1080px 导出宽度、4:5／3:4／1:1 比例和 PNG／SVG 导出保持原样。本轮没有采用 `design/mumaka-concepts` 中的未选方案。

`src/lib/scoreCardData.ts` 定义独立的 `ScoreCardData`（`schemaVersion: 1`），`toScoreCardData(album, calculation, modelProvenance?)` 生成展示副本：

- `album`：记录 ID、版本、标题、音乐人、年份、发行信息、原评分作品类型及内嵌封面。
- `score`：已有 `total`、`exactTotal`；不在这里计算或舍入。
- `ratings`：固定六维的数值、`null`（未评分）或 `na`；不将二者混淆。
- `summary`、`reviewer`、`updatedAt` 及可选模型来源。

`ScoreCard` 已接受 `data={...}`，同时兼容旧的 `album`＋`calculation` 调用。玫瑰图仍使用相同几何与星级数据；这里只收窄了输入类型，没有改图形实现。导出器继续序列化同一个 SVG。

未来编辑器只需要读取 `ScoreCardData`，比例、主题等展示选项独立传入组件。适配函数不打开数据库、不写回作品、不调用评分引擎；历史快照传入冻结的 `snapshot.calculation`，即使当前模型会算出其他分数也保留历史数值。编辑展示副本不改变原记录。

此模型不引入插件注册、远程编辑器协议或新数据库版本。已有完整 JSON 备份格式保持 `nmc-library` / `schemaVersion: 1`；可选 `importSource` 是作品字段的兼容扩展。
