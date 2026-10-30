# 免费专辑资料导入

本轮继续使用现有 React 应用和 `nmc-workbench-v1` IndexedDB。Python 只获取公开元数据，不评分、不读取作品库、不修改历史记录、不需要平台账号或 API 密钥。

## 两种使用方式

| 方式 | 操作 | 适合场景 |
| --- | --- | --- |
| 本地网页与 Python 同源服务 | 启动一次，然后粘贴链接、获取、确认 | 经常在本机创作，操作最少 |
| Python 命令行 → JSON → 网页 | 每张专辑执行一次命令，然后导入文件 | 保留 GitHub Pages、无需持续运行服务 |

两种方式共用同一组 Python 适配器及 JSON 格式。不引入数据库服务器、付费平台或采集管理后台。前者不需要配置 CORS；后者不要求线上网页访问本机服务。

### 本地网页（方案 A）

需要 Node.js 22.12+、Python 3.10+。在仓库根目录运行：

```bash
npm ci
npm run local
```

`npm run local` 先构建 React，再用 Python 同时提供网页和 `/api/album-import`。在**自己的电脑**打开终端显示的 `http://127.0.0.1:8765`，使用“通过链接添加”。已有构建时可运行 `npm run import:serve`；停止服务按 Ctrl+C。Python 仅使用标准库。

本地服务只绑定回环地址，不用于公网部署。导入接口检查 Host、精确同源 Origin、JSON 请求、请求长度，并限制同时采集一张专辑。远程 GitHub Pages、`file://`、`null` Origin 不可调用它。不开放通配 CORS，不需要关闭浏览器安全设置。

**浏览器存储按 origin 隔离。** GitHub Pages 与本机地址不是同一个数据库空间。切换之前，在旧地址导出完整 JSON 备份，再在新地址“专业工作台 → 数据管理”恢复。固定使用同一地址和端口；服务不会自动搬移、读取或删除另一个地址的数据。

### GitHub Pages / 命令行（方案 B）

只需要 Python；若使用现成的 Pages 网页，不需要安装 Node。下载仓库并在根目录运行：

```bash
python3 -m tools.album_import 'https://music.apple.com/us/album/in-rainbows/1109714933' -o album.json
```

该 URL 是**用于说明命令格式的真实公开链接**，不是本环境已采集成功的承诺。也可填自己的 Bandcamp `/album/...` 链接。

在网页选择“通过链接添加 → 导入元数据 JSON”，确认／修改内容后继续风格选择和评分。命令遇到已存在的输出文件会拒绝覆盖；改一个文件名即可。Windows 若使用 Python Launcher，可将 `python3` 替换为 `py -3`。

GitHub Pages **不能直接运行 Python 或抓取任意第三方网页**。线上版的一键“获取信息”明确显示需要本地模式；JSON 导入、手动评分、备份及卡片导出仍可用。不会尝试从 HTTPS 页面访问用户电脑的 HTTP 服务。

## 首批来源与边界

| 链接 | 实现 | 取得的数据及限制 |
| --- | --- | --- |
| Apple Music `music.apple.com/{地区}/album/.../{ID}` | 官方公开 iTunes Lookup，`entity=song`，无需 MusicKit 或 Spotify 订阅 | 名称、音乐人、发行日期、曲目顺序／时长、接口实际返回的封面、参考分类。地区目录可能不完整；缺曲目会提示。接口不能可靠区分 Album / EP / Single 时保留“待确认”。不猜改 CDN 图片尺寸，封面分辨率取决于返回值，可自行上传清晰图片。 |
| Bandcamp `{艺人}.bandcamp.com/album/...` | 先检查 robots，再解析公开页面 JSON-LD／页面自带 `data-tralbum` | 名称、音乐人、日期、封面、曲目、可读到的时长和标签；明确提供发行类型时才记录。不访问私有接口，不下载音频。缺失字段提示补充。自定义域名暂未纳入允许列表。 |
| Spotify 公开网页、网易云、QQ 音乐及其他网站 | 本轮未接入免费完整曲目适配器 | 友好提示后可手动添加。没有宣称这些网站一定可抓取。原 Spotify 官方搜索代理可选保留。 |

Apple 官方公开接口文档入口：
https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/LookupExamples.html

访问规则、可用目录和接口政策可能变化，工具不绕过登录、付费墙、验证码、robots 禁止或访问限制。读取使用正常 HTTPS、继承系统代理和 CA 校验；不携带登录 Cookie。限制来源域名、重定向、总时长与响应大小。封面限公开支持的图片域名、5 MB 和可验证的 PNG/JPEG/WebP/GIF 内容；失败时保留元数据并提示上传。

## 数据确认与保护

- JSON 格式为 `mumaka-album-import`，版本 1。只接受元数据，不接受评分、记录 ID、权重、发表状态或内部风格 ID。
- 确认后创建新 ID 和曲目 ID，写入原有数据库；不覆盖任何已有专辑。
- 同来源 URL，或相同名称＋音乐人的作品，会显示可能重复：可打开原记录，或明确选择另建记录。
- 保存原始来源、元数据来源地址、获取时间、适配器版本、外部标签及来源发行类型。用户确认后的名称、年份、曲目、封面等作为作品数据保存。
- 外部标签只作参考，不自动映射到 558 项风格库。Single 保留来源标注，不按曲目数量猜成 EP；内部评分单位仍使用原有专辑／EP 结构。
- 图片保存为 data URL，因此刷新、备份恢复和导出不依赖再次请求来源图片。无法取得封面时允许上传；不会把远程链接假装成已持久保存的图片。

## 当前验证状态

Python 固定样本、实际本机 HTTP 服务、浏览器导入确认、同库保存、重复提示、采集失败兜底和 PNG 导出已经运行验证。测试上游是明确标注的合成样本，未作为用户搜索结果内置。

**真实来源连通性尚未验证通过。** 本云环境对 `itunes.apple.com`、`music.apple.com`、Bandcamp 的访问由出口代理拒绝（CONNECT 403）；这发生在请求来源网站之前，不能据此判断网站是否允许或当前是否可用。所需域名已加入环境配置草稿，运行时尚未应用；不能把解析测试等同于实站成功。

网络放行后，应至少以一个 Apple Music 和一个 Bandcamp 真实链接运行 CLI，再从本地网页确认封面、曲目、年份与原页面一致。本轮未完成此实网步骤。
