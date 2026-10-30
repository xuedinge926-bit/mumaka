# Spotify 专辑资料连接

界面使用真实 Spotify Web API Provider，没有内置模拟搜索结果。未配置时可以搜索并看到“尚未连接”提示，始终支持手动添加；评分、保存和图片导出不依赖 Spotify。

## 当前验证边界

本环境没有 `SPOTIFY_CLIENT_ID` 或 `SPOTIFY_CLIENT_SECRET`，也未提供开发者应用权限。实现通过模拟官方响应的单元测试验证，**没有声称已连接真实 Spotify 账号或成功执行在线搜索**。核对官方 Client Credentials 文档的请求 `https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow` 在当前受限网络返回 HTTP 403；上线前仍需由应用所有者核对最新账号资格、Development/Extended Quota Mode 限制、端点授权、配额与开发者条款。

## 本地配置

1. 在 Spotify Developer Dashboard 创建或选择有相应 API 权限的应用。不要把密钥发到聊天。
2. 将 `.env.example` 复制为仓库根目录 `.env.local`，仅在本机文件或部署平台安全环境设置中填写 `SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET`。
3. 重启 `npm run dev` 或 `npm run preview`。Vite 的 Node 中间件读取这些**非 `VITE_`** 服务端变量，浏览器只请求 `/api/spotify`，不会获得密钥或访问令牌。
4. `/api/spotify?action=status` 仅返回是否同时配置了两个变量。`configured: true` 表示配置存在，**不证明凭据、账号权限或网络已可用**；实际搜索成功才验证对应操作。

代理使用官方 Client Credentials 方式向 `accounts.spotify.com/api/token` 请求令牌，再访问 `api.spotify.com/v1/search`、`/v1/albums/{id}` 和分页曲目端点。服务端需要允许 HTTPS 访问这两个主机；文档/账号管理另需 `developer.spotify.com`。当前云环境需要通过环境设置配置所需网络访问，不绕过现有代理或域名策略。

## 部署

`api/spotify.ts` 为 Node Serverless 适配器（例如支持该目录约定的 Vercel）。部署时在平台服务端环境设置中配置上述两个变量，使用同源 `/api/spotify?action=status|search|album`。代理仅支持 GET；不会打开任意外部地址，不提供跨域放行。具体平台的 Node/TypeScript 文件解析与函数部署应在上线环境再次验证。

纯静态托管（GitHub Pages）、单文件 HTML 或 `file://` 不能保管 Client Secret，也没有此 API 端点。Provider 会将 404、HTML 回退页或不可用的本机路由识别为未连接，保持手动录入可用。不要把凭据改为 `VITE_SPOTIFY_CLIENT_SECRET`，也不要在静态网页、仓库或下载包中嵌入密钥。

## 数据与错误处理

- 搜索返回独立的 Spotify 专辑 ID、名称、艺人、发行日期、原始 `album_type`、封面和 Spotify 链接；不按同名自动合并不同发行实体。
- `album_type=single` 不等于 EP；不按曲目数量推断 EP。该类型需要用户确认应用中的专辑/EP 形式。
- 逐曲读取名称、艺人、时长、碟号和曲序，遍历官方分页；不完整响应明确报错，不把截断曲目冒充完整清单。
- 不把艺人 genres 当成专辑风格，不把 available_markets 当文化来源，也不尝试从元数据识别翻唱或词曲来源。
- 令牌仅在服务端内存缓存，过期前刷新；401 最多重取令牌重试一次；429 返回 Retry-After，不自动连续重试。请求超时、格式异常和上游错误有明确兜底，错误不转发原始响应、密钥或令牌。
- 搜索结果及导入界面保留 Spotify 来源链接。封面和元数据的缓存、归档、下载及评分卡导出是否获准，必须按当前 Spotify 开发者政策和素材授权另行核对；技术可下载不等于取得再发行许可。

官方核对入口：

- https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
- https://developer.spotify.com/documentation/web-api/reference/search
- https://developer.spotify.com/documentation/web-api/reference/get-an-album
- https://developer.spotify.com/documentation/web-api/reference/get-an-albums-tracks
- https://developer.spotify.com/terms
- https://developer.spotify.com/policy
