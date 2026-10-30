# Spotify 真实搜索：配置、部署与验收

当前方案：**GitHub Pages 前台 → Vercel `/api/spotify` → Spotify 官方 API**。
Client Secret 和 Spotify Access Token 只留在 Vercel。前台只拿专辑资料，不拿令牌。

**本功能为可选项。** 日常使用不需要为 Spotify 搜索开通订阅；免费的 Python 链接导入和静态页 JSON 导入见 [专辑导入说明](ALBUM_IMPORT.md)。下面的配置只适用于仍需官方搜索的情况。

## 需要你本人完成

### 1. Spotify Developer Dashboard

在 https://developer.spotify.com/dashboard 创建或选定应用，名称可用 MUMAKA，说明为私人专辑资料与评分工具，选择 **Web API**。

- Website 可以填写 `https://xuedinge926-bit.github.io/mumaka/`。
- 本项目使用 **Client Credentials**，没有用户登录、播放或用户资料授权，因此该流程不请求用户 scopes，也不使用 OAuth Redirect URI。Dashboard 若有其他必填信息，应按其当前说明填写；不要为了这个流程授予无关权限。
- 进入应用 Settings 获取 Client ID 和 Client Secret。Secret 仅填写到服务端环境设置，**不要发到聊天、提交到 Git 或使用 `VITE_` 前缀**。
- 应用所有者的账户资格、开发／扩展模式、配额和可用端点须以当前 Dashboard 与官方文档为准。当前环境对官方域名的访问尚未开通，无法核验最新 Premium 条件、创建数量、授权用户数等具体限制，因此这里不引用未经核实的旧数字。

官方核对入口：

- https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/documentation/web-api/concepts/rate-limits
- https://developer.spotify.com/documentation/web-api/reference/search
- https://developer.spotify.com/terms
- https://developer.spotify.com/policy

### 2. Vercel 服务端

在 Vercel 新建项目，导入 `xuedinge926-bit/mumaka`。Framework 选 Vite；仓库包含 `vercel.json`，使用 `npm run build`，输出 `dist`，函数入口为 `api/spotify.ts`。

已合入远程 `main` 的代理修改历史，并统一实际入口为与前台匹配的 Node 接口：`action=status/search/album`、响应 `{ data }`，与本地共享同一实现。此前仅接受 `path` 的 Edge 函数契约与前台不兼容；旧 `functions/spotify.ts` 文件保留，不是本项目 Vercel 的部署入口，不要将 Root Directory 设置为 `functions`。本次没有改动其原始内容。

在 **Project → Settings → Environment Variables** 设置：

| 名称 | 值 | 用途 |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | 应用 Client ID | 服务端身份 |
| `SPOTIFY_CLIENT_SECRET` | 应用 Client Secret | 仅服务端密钥 |
| `SPOTIFY_ALLOWED_ORIGINS` | `https://xuedinge926-bit.github.io` | 精确允许的 Pages 来源 |

先勾选 Production；若要验证 Vercel Preview，也需对 Preview 设置相应环境变量。每次改变量后重新部署。允许来源是**协议＋域名＋端口**，不能带 `/mumaka/` 路径，不使用 `*` 或 `null`。多个明确来源用逗号分隔。

部署后记下固定 Production URL，例如 `https://your-proxy.vercel.app`。该域名是示例，不是已经部署好的服务。

访问 `https://your-proxy.vercel.app/api/spotify?action=status` 可检查是否存在配置；`configured: true` **只表示两个变量存在**。还须执行 search 和 album 请求，才能确认账户权限、上游网络与曲目读取确实成功。

### 3. GitHub Pages 前台

在仓库 **Settings → Secrets and variables → Actions → Variables** 新建公开变量：

```text
SPOTIFY_PROXY_URL=https://your-proxy.vercel.app/api/spotify
```

这里填完整 HTTPS 接口地址，不填 Client ID、Secret 或令牌，不带 `?action=`。这是可公开的地址，不是 Secret。

然后在 **Actions → Publish scoring app to GitHub Pages branch → Run workflow** 手动运行。工作流把此公开变量作为 `VITE_SPOTIFY_PROXY_URL` 写入前端，重新构建并以快进提交更新 `gh-pages`。Pages 仍选择 `gh-pages` 的 `/(root)` 发布。该工作流只发布现有应用，**不发布 `design/` 中的视觉评审方案**。

如果前台没有设置公开代理地址，默认 `/api/spotify` 仅适用于本地 Vite 或同源服务端。GitHub Pages 没有这个接口，不能通过把 Secret 放进 GitHub Pages 来解决。

## 本地开发

复制 `.env.example` 为 `.env.local`，在本机私密文件中设置前面三个服务端变量，再运行 `npm run dev`。

- 本地同源代理：`VITE_SPOTIFY_PROXY_URL` 留空。
- 本地前台调用线上代理：设置 `VITE_SPOTIFY_PROXY_URL=https://your-proxy.vercel.app/api/spotify`，并在服务端精确允许所使用的本地 origin。
- `npm run preview` 也提供 Node 代理；纯 `dist/` 静态托管不提供代理。
- `node scripts/build-standalone.mjs` 只嵌入选定的公开代理地址，不读取或嵌入服务端密钥。本地 `file://` 的 Origin 通常为 `null`，代理不为此开放 CORS；单文件仍可手动评分。

本云环境还需在环境设置放行 `accounts.spotify.com`、`api.spotify.com`，封面需要 `i.scdn.co`，官方文档需要 `developer.spotify.com`。相关域名已存入配置草稿，但保存草稿不代表运行中的网络已生效。

## 安全与数据行为

- 仅调用官方固定 HTTPS 端点；不跟随上游重定向、不提供任意 URL 转发。
- 精确来源允许列表；浏览器请求不带 Cookie，不开放凭证型 CORS。OPTIONS 只允许 GET 和 Accept；非法来源在访问上游前即被拒绝。
- 服务端缓存短期令牌，401 最多刷新重试一次；429 显示 Retry-After，超时及上游错误进入手动添加兜底。
- 校验名称、艺人、发行日期、封面地址、曲目字段和分页完整性。`single` 不自动当 EP；艺人 genres 不当专辑风格；市场不当文化来源。
- Spotify 来源链接保留。正式接入前，应用所有者仍需核对当前开发者条款及封面、元数据缓存与导出的使用权限。

## 当前完成与未完成

已完成代理代码、Pages 公开端点配置、Vercel 适配、精确 CORS、失败兜底及技术夹具验证。

**尚未完成真实账号接通验收**：本环境没有可用凭据／线上代理 URL，官方文档和真实 API 访问也受现行网络策略限制。用户后续在平台所做的设置未在本环境验证，不能把技术夹具测试报告成真实搜索成功。

本轮浏览器验收分别覆盖普通原创、翻唱及跨风格 EP：浏览器调用真实 Node 代理，Spotify 上游使用明确技术夹具；真实账号建立后须按同样流程再执行一次实网验收。
