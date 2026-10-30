# MUMAKA / 木马卡

新乐评主义 / New Music Criticism。基于现有 React / TypeScript / Vite 项目的个人专辑评分工具，继续使用 V0.19 精确评分、558 项风格库、33 项中国市场索引和原有 IndexedDB 数据库。

## 开始使用

需要 Node.js 22.12+、Python 3.10+。在项目根目录运行：

```bash
npm ci
npm run local
```

在**自己的电脑**打开终端显示的本机地址。此命令构建网页，再以 Python 提供网页和免费链接导入，不需要 Spotify 账号、API 密钥或数据库服务器。已有构建时可运行 `npm run import:serve`。

纯前端开发仍使用 `npm run dev`；该模式默认没有 Python 导入服务，支持手动评分与元数据 JSON 导入。

## 日常流程

- 首页：搜索本机作品（可选 Spotify 官方搜索）、通过链接添加、手动添加、快速评分、专业工作台、最近编辑。
- 快速评分：添加／导入 → 确认信息与两级风格 → 六维半星评分 → 卡片预览及 PNG／SVG 导出。支持返回修改、草稿自动保存、继续编辑及可选短评，无强制理由文字。
- 专业工作台：作品库搜索／排序／打开／复制／删除、冻结的评分版本、JSON 备份恢复、CSV 导出、新作品偏好、现有卡片工具。
- 普通作品默认一种主风格。多风格按曲目分配，可从已选主风格填入、批量修改，继续使用原有每曲等份／核实时长汇总，仍只评整张作品的六维。
- 新作、翻唱、新旧混合及旧作重录使用简短来源选项，由原规则计算。资料不足时需要确认，不猜修正档位，不提供手调权重。
- 原六维图、卡片视觉、4:5／3:4／1:1 比例及 PNG 导出保持。评分卡独立数据接口见 [ScoreCardData](docs/SCORE_CARD_DATA.md)。

## 免费链接导入

详见 [本地服务与 JSON 工具说明](docs/ALBUM_IMPORT.md)。首批适配：Apple Music 链接对应的官方免费 iTunes Lookup 元数据，以及 Bandcamp 公开页面的结构化资料。只取能读取的字段；外部标签不自动变成内部风格，Single 不猜成 EP，封面获取受限可手动上传。

GitHub Pages 是静态托管，无法运行 Python。在线版使用本地工具生成 JSON 后导入：

```bash
python3 -m tools.album_import '专辑HTTPS链接' -o album.json
```

随后选择“通过链接添加 → 导入元数据 JSON”。工具不会覆盖已有输出文件。网页只接受元数据，重新生成记录 ID；可能重复时可打开原记录或另建记录。

**当前实网限制：** 本云环境出口代理拒绝 Apple / Bandcamp 请求（CONNECT 403）。已实际跑通固定样本 → Python HTTP → React 确认 → IndexedDB → 评分 → PNG，但未验证两个真实网站当前可用。不能将样本测试当作真实链接采集成功。所需域名已存环境配置草稿，仍需在环境设置应用。Spotify、网易云和 QQ 音乐的公开网页完整曲目采集本轮未接入。

## 可选 Spotify 官方搜索

保留服务端代理；免费链接导入与日常评分不依赖它。Client Secret 只留服务端，公开构建仅可包含 `VITE_SPOTIFY_PROXY_URL`。凭据、精确 CORS、Vercel 与 Pages 配置见 [Spotify 说明](docs/SPOTIFY.md)。本环境没有完成真实账号调用验收。

## 数据与历史

- 数据库仍为 `nmc-workbench-v1` / 版本 1，没有清空或迁移。新来源记录为可选字段，旧专辑、证据和历史快照保持兼容。
- 已发表记录只展示冻结分数；复制产生独立记录。删除草稿保留历史快照，不能删除或覆盖已发表评价。
- 专业工作台或原设置中可全量导出／恢复 JSON。相同备份幂等导入；冲突明确拒绝，不静默覆盖。CSV 供表格查阅，完整恢复使用 JSON。
- **不同协议、域名、端口或浏览器拥有不同的本地数据。** 从 GitHub Pages 换到本机之前，请先在原地址备份，再在本机导入。固定端口使用，不依赖服务器进程保存数据。
- 新作品偏好只影响之后创建的记录。用户最终确认的数据优先于导入值；导入和编辑均不自动覆盖另一条记录。

## 验证与构建

```bash
npm test                   # TS 评分、数据库、导入边界；先生成 11,160 组 Python 对照
npm run test:reference     # 原始 Python 模型
npm run test:import        # 新 Python 适配器及真实本机 HTTP 测试
npm run build             # 类型检查、dist/、离线页面缓存
npm run test:e2e           # Chromium 端到端验收，需先构建
npm run build:standalone  # standalone/新乐评主义.html，内嵌静态资源
```

浏览器测试默认使用 `/usr/bin/chromium`，可用 `CHROMIUM_PATH` 指定。标准生产站点首次缓存后可离线处理本地作品；API 请求不缓存。当前云环境禁止 `file://` 浏览器导航，不能宣称已实测双击 HTML；单文件通过静态 HTTP 验证。

GitHub Pages 的手动发布工作流位于 `.github/workflows/pages.yml`，只发布应用单文件与下载包，不包含本地 Python 服务、凭据或未选视觉方案。`npm run preview` 是本机预览，不是公网部署。

本轮任务与实际截图见 [交付记录](docs/next-stage/RESULTS.md)。原模型资料位于 `docs/reference-supplement/` 与 `docs/model-source/`，未修改评分数学或重生成风格库。
