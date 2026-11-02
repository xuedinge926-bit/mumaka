import { execFileSync } from "node:child_process";
import { mkdir, cp, writeFile, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(process.argv[2] || "local-release");
await mkdir(destination, { recursive: true });
execFileSync(
  process.execPath,
  [
    resolve(root, "scripts/build-standalone.mjs"),
    resolve(destination, "index.html"),
  ],
  { cwd: root, stdio: "inherit" },
);
await cp(
  resolve(root, "scripts/serve-local.py"),
  resolve(destination, "serve-local.py"),
);
const launcher = `#!/bin/zsh
cd -- "\${0:A:h}"
if [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" ]]; then
  mumaka_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
else
  mumaka_python="$(command -v python3)"
fi
if [[ -z "$mumaka_python" ]]; then
  open -a "Google Chrome" "$PWD/index.html" || open "$PWD/index.html"
  exit
fi
exec "$mumaka_python" serve-local.py --root . --port 8765 --open
`;
const direct =
  '#!/bin/zsh\ncd -- "${0:A:h}"\nopen -a "Google Chrome" "$PWD/index.html" || open "$PWD/index.html"\n';
for (const [name, content] of [
  ["启动MUMAKA.command", launcher],
  ["直接打开单文件.command", direct],
]) {
  await writeFile(resolve(destination, name), content, "utf8");
  await chmod(resolve(destination, name), 0o755);
}
await writeFile(
  resolve(destination, "使用说明.md"),
  `# 木马卡 MUMAKA V0.41

推荐双击「启动MUMAKA.command」。它在固定本机地址 http://127.0.0.1:8765 打开，不发布到互联网。保持启动窗口开启，关闭窗口即停止服务。再次打开使用相同地址和浏览器，作品会继续保留。

也可以双击 index.html，或「直接打开单文件.command」，无需安装或联网即可评分。不同浏览器和不同网站地址的数据各自保存，不自动互通。

升级前先在旧版「数据管理」导出 V0.40 完整备份；在新版左上菜单「数据与工具」恢复。旧目录和旧备份请保留。V0.19、V0.35 各有自己的备份入口，不与新版混用。仅复制HTML文件不会迁移浏览器数据。

首页「快速评分」手动填写专辑，可上传封面。歌曲／乐曲分别保留风格和六维星级；点半颗星或整颗星评分，悬停预览等级，点击维度名称看说明。评分草稿标签可同时保存多张作品。右侧实时显示总分、六维图和卡片，支持PNG／SVG／CSV／JSON。保存评分版本会冻结当时的权重和分数。

右上「…」切换亮色、暗色、跟随系统和主题色。「设置」可选择新卡片默认比例、配色、地区，默认展开参考说明及减少动画。

首页星级速览和完整参考页使用同一份四类168格候选。中国歌曲沿用R3，原先3个空位补充独立初选，均未自动审定。其他三类沿用现有V0.38.1候选，仍待试听及去重审定。封面缺失时显示占位。各格可在「数据与工具 → 管理标尺候选」替换、保存与人工审定，已审定格有保护。

评分数学、双体系权重、六维定义及旧历史记录保持原样。本版只精简界面与操作。研究工具和早期版本收在「数据与工具」，首页不提供链接抓取或Spotify搜索。

此目录只包含可运行页面、启动器、仅绑定本机的静态服务和本说明，不含私人备份、原始工作簿或内部资料。
`,
  "utf8",
);
console.log(`Local package ready: ${destination}`);
