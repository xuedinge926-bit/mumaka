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
  resolve(root, "tools/album_import"),
  resolve(destination, "tools/album_import"),
  {
    recursive: true,
    filter: (path) => !path.includes("__pycache__") && !path.endsWith(".pyc"),
  },
);
await cp(
  resolve(root, "tools/__init__.py"),
  resolve(destination, "tools/__init__.py"),
);
const direct =
  '#!/bin/zsh\ncd -- "${0:A:h}"\nopen -a "Google Chrome" "$PWD/index.html" || open "$PWD/index.html"\n';
const serve = `#!/bin/zsh
cd -- "\${0:A:h}"
if [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3" ]]; then
  mumaka_python="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
else
  mumaka_python="$(command -v python3)"
fi
if [[ -z "$mumaka_python" ]]; then
  open "$PWD/index.html"
  exit
fi
exec "$mumaka_python" -m tools.album_import serve --root . --port 8765 --open
`;
for (const [name, content] of [
  ["打开MUMAKA.command", direct],
  ["启动链接导入服务.command", serve],
]) {
  await writeFile(resolve(destination, name), content, "utf8");
  await chmod(resolve(destination, name), 0o755);
}
await writeFile(
  resolve(destination, "使用说明.md"),
  `# MUMAKA V0.40

双击 **打开MUMAKA.command** 或 **index.html** 即可评分，无需安装。
需要通过音乐网站链接添加资料时，双击 **启动链接导入服务.command**，它会在固定本机地址 http://127.0.0.1:8765 打开工具。终端窗口保持开启；关闭后停止本机服务。

歌曲／乐曲切换在最上方；信息、风格、六维评分和评分卡都在一页，修改即时更新。两类星级、证据与风格分别保存。混合专辑须填写人工艺术比重，愿景和语境只计一次。

实际接入V0.38.1：34一级、565稳定ID、522组双模式候选、43不可评分索引、5定义待审。候选可以研究试算、保存快照和导出PNG／SVG／CSV／JSON；正式发布按钮只在权重审定、整碟试听及人工证据齐备后开放。

星级参考页有四类各42格。华语歌曲优先使用R3的39位艺人、3个待选格。全部候选均保留未审定状态，不冒充正式标尺。

作品库、评分记录和数据管理可从左上角菜单打开。数据管理中，V0.40备份和旧版备份各有入口；换浏览器或地址前先导出相应备份。直接打开HTML、本机8765地址和GitHub Pages拥有各自浏览器数据，互不自动同步。

旧模型记录、冻结总分和N/A不重算。首页“V0.19归档工具”可继续使用原评分流程；V0.35研究工作区也保留。新版首次评分会在本机保留旧库保护副本，可在新版数据管理下载。

此目录只含可运行页面、两个启动入口和链接导入所需的小型服务。源码、测试、原始工作簿、私人评分备份和研究工作流材料均未复制进来。
`,
  "utf8",
);
console.log(`Ready-to-use local folder: ${destination}`);
