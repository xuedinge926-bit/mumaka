import { test, expect, type Page } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";

// No third-party website is mocked as a live success: the upstream is an explicit
// HTML / official API fixture. Browser -> local Python HTTP -> parser -> DB is real.
let service: ChildProcess;
let origin: string;
let metadata: Buffer;
const appleLink = "https://music.apple.com/us/album/fixture/123456789";
const bandcampLink = "https://fixture.bandcamp.com/album/fixture";
const snapshots = "docs/workspace-navigation/screenshots";
test.beforeAll(async () => {
  metadata = execFileSync(
    "python3",
    [
      "-c",
      "import json; from tools.album_import.importer import import_album; from tools.tests.test_album_import import FixtureFetcher; print(json.dumps(import_album('https://fixture.bandcamp.com/album/fixture', FixtureFetcher()),ensure_ascii=False))",
    ],
    { cwd: process.cwd() },
  );
  service = spawn("python3", ["tests/import-fixture-server.py"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  origin = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Local Python test service did not start")),
      10000,
    );
    service.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    service.stdout!.on("data", (chunk) => {
      output += chunk;
      const match = /READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    service.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Local Python test service exited ${code}`));
    });
  });
  await mkdir(snapshots, { recursive: true });
});
test.afterAll(() => {
  service?.kill();
});

async function openLink(page: Page, url: string) {
  await page.getByRole("button", { name: "通过链接添加", exact: true }).click();
  await page.getByLabel("专辑链接", { exact: true }).fill(url);
  await expect(
    page.getByRole("button", { name: "获取信息", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "获取信息", exact: true }).click();
}
async function genre(page: Page) {
  await page
    .getByRole("button", { name: "直接搜索细分风格", exact: true })
    .click();
  await page.getByLabel("专辑风格搜索全部风格").fill("Pop (General)");
  await page.locator(".global-choice .choice-options button").first().click();
}
async function rate(page: Page) {
  await page.getByRole("button", { name: "下一步：评分", exact: true }).click();
  for (const label of ["作词", "作曲", "表演", "声音", "愿景", "语境"]) {
    const slider = page.getByRole("slider", {
      name: `${label}评分`,
      exact: true,
    });
    await slider.focus();
    await slider.press("Home");
    for (let i = 0; i < 7; i++) await slider.press("ArrowRight");
  }
  await page.getByRole("button", { name: "生成评分卡", exact: true }).click();
  await expect(page.locator("#score-card-svg")).toContainText("8.00");
}
async function home(page: Page) {
  await page
    .getByRole("button", { name: "MUMAKA / 木马卡，返回首页", exact: true })
    .click();
}
async function fileImport(page: Page) {
  await page.getByRole("button", { name: "通过链接添加", exact: true }).click();
  await page
    .getByLabel("导入专辑元数据文件", { exact: true })
    .setInputFiles({
      name: "album.json",
      mimeType: "application/json",
      buffer: metadata,
    });
  await expect(page.getByLabel("导入专辑名称")).toHaveValue(
    "导入流程测试专辑（样本）",
  );
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
}

test("本地真实 HTTP 链接导入 → 修改确认 → 评分与卡片更新 → PNG → 重复作品保护（上游固定样本）", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin);
  await expect(
    page.getByText("Spotify 搜索未配置", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${snapshots}/home.png`, fullPage: true });
  await openLink(page, appleLink);
  await expect(page.getByLabel("导入专辑名称")).toHaveValue(
    "导入流程测试专辑（样本）",
  );
  await expect(page.getByLabel("导入曲目 1 名称")).toHaveValue("第一首");
  await expect(page.getByAltText("导入专辑封面")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await page.getByLabel("导入发行年份").fill("2025");
  await page.getByLabel("导入发行形式").selectOption("album");
  await page.screenshot({
    path: `${snapshots}/import-confirm.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await expect(page.getByLabel("发行年份", { exact: true })).toHaveValue(
    "2025",
  );
  await expect(
    page.getByRole("button", { name: "专辑风格二级风格", exact: true }),
  ).toContainText("选择细分风格");
  await expect(
    page.getByText("Alternative · 请自行选择下方风格"),
  ).not.toBeVisible();
  await genre(page);
  await rate(page);
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  const composition = page.getByRole("slider", {
    name: "作曲评分",
    exact: true,
  });
  await composition.focus();
  await composition.press("ArrowRight");
  await page.getByRole("button", { name: "生成评分卡", exact: true }).click();
  const updatedScore = await page
    .locator('#score-card-svg text[font-size="98"]')
    .textContent();
  expect(Number(updatedScore)).toBeGreaterThan(8);
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PNG", exact: true }).click();
  const bytes = await readFile((await (await event).path())!);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1350);
  await page
    .locator("#score-card-svg")
    .screenshot({ path: `${snapshots}/existing-card.png` });
  await home(page);
  await page.reload();
  await expect(page.locator(".recent-album")).toHaveCount(1);
  await openLink(page, appleLink);
  await expect(
    page.getByRole("region", { name: "可能重复的作品" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("可能重复");
  await page.getByRole("button", { name: /打开原记录/ }).click();
  await expect(page.getByLabel("发行年份", { exact: true })).toHaveValue(
    "2025",
  );
  await home(page);
  await openLink(page, appleLink);
  await page.getByLabel("另建一条独立记录").check();
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await home(page);
  await expect(page.locator(".recent-album")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("静态页面的 JSON 导入真实写入同库；采集拒绝后手动添加不丢记录", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "通过链接添加", exact: true }).click();
  await expect(
    page.getByText("当前页面没有本地采集服务。", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "获取信息", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("导入专辑元数据文件", { exact: true })
    .setInputFiles({
      name: "album.json",
      mimeType: "application/json",
      buffer: metadata,
    });
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await expect(page.getByLabel("作品类型")).toHaveValue("EP");
  await home(page);
  await page.reload();
  await expect(page.locator(".recent-album")).toHaveCount(1);
  // The blocked-source path uses the real local API but an explicit denial fixture.
  await page.goto(origin);
  await openLink(page, "https://fixture.bandcamp.com/album/blocked");
  await expect(page.getByRole("alert")).toContainText("来源限制");
  await page.getByRole("button", { name: "改为手动添加", exact: true }).click();
  await page
    .getByLabel("专辑名称", { exact: true })
    .fill("失败后仍能添加（样本）");
  await page.getByLabel("音乐人", { exact: true }).fill("测试者");
  await genre(page);
  await rate(page);
  await home(page);
  await expect(page.locator(".recent-album")).toHaveCount(1);
});

test("三首多风格 EP、新旧混合来源、工作台管理、备份与偏好完整走通", async ({
  page,
}) => {
  await page.goto(origin);
  await openLink(page, bandcampLink);
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await genre(page);
  await page.getByRole("button", { name: "多种风格", exact: true }).click();
  for (let i = 1; i <= 3; i++)
    await expect(
      page.getByRole("button", { name: `曲目 ${i} 风格二级风格`, exact: true }),
    ).toContainText("流行");
  for (const [n, family, term] of [
    [2, "摇滚", "Folk Rock"],
    [3, "电子", "Ambient Techno"],
  ] as const) {
    await page
      .getByRole("button", { name: `曲目 ${n} 风格一级风格`, exact: true })
      .click();
    await page
      .locator(".choice-popover .choice-options button")
      .getByText(family, { exact: true })
      .click();
    await page.getByLabel(`曲目 ${n} 风格搜索二级风格`).fill(term);
    await page
      .locator(".choice-popover .choice-options button")
      .first()
      .click();
  }
  await page.getByText("更多选项", { exact: true }).click();
  await page.getByLabel("使用已核实的曲目时长（默认每首等份）").check();
  await page.getByRole("button", { name: "多种风格", exact: true }).click();
  await expect(
    page.getByLabel("使用已核实的曲目时长（默认每首等份）"),
  ).toBeChecked();
  await page.getByLabel("歌曲主要来源").selectOption("mixed");
  await page.getByLabel("来源侧重方式").selectOption("mixed_light");
  await page.getByLabel("来源是否重复计算").selectOption("clear");
  await page.screenshot({
    path: `${snapshots}/multi-style.png`,
    fullPage: true,
  });
  await rate(page);
  await home(page);
  await page.getByRole("button", { name: "专业工作台", exact: true }).click();
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "作品库", exact: true })
    .click();
  await expect(page.locator(".library-row")).toHaveCount(1);
  await page.screenshot({ path: `${snapshots}/workbench.png`, fullPage: true });
  await page.getByLabel("搜索作品库").fill("no-match");
  await expect(page.locator(".library-row")).toHaveCount(0);
  await page.getByLabel("搜索作品库").fill("");
  await page.getByLabel("作品排序").selectOption("artist");
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await page.getByLabel("专辑名称", { exact: true }).fill("工作台副本（样本）");
  await page.getByRole("button", { name: "返回上一级", exact: true }).click();
  await expect(page.locator(".library-row")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".library-row", { hasText: "工作台副本（样本）" })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.locator(".library-row")).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "评分记录", exact: true })
    .click();
  await expect(page.locator(".rating-record")).toHaveCount(1);
  await expect(page.locator(".rating-record")).toContainText("8.00");
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "数据管理", exact: true })
    .click();
  const backupEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部备份", exact: true }).click();
  const data = JSON.parse(
    await readFile((await (await backupEvent).path())!, "utf8"),
  );
  expect(data.albums).toHaveLength(1);
  expect(data.snapshots).toHaveLength(1);
  expect(data.albums[0].importSource.url).toBe(bandcampLink);
  expect(data.albums[0].blendMode).toBe("duration");
  expect(
    new Set(data.albums[0].tracks.map((t: { genreId: string }) => t.genreId))
      .size,
  ).toBe(3);
  const csvEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出作品库 CSV", exact: true })
    .click();
  expect(await readFile((await (await csvEvent).path())!, "utf8")).toContain(
    "导入流程测试专辑（样本）",
  );
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("默认导出比例").selectOption("3:4");
  await home(page);
  await page.getByRole("button", { name: "快速评分", exact: true }).click();
  await page.getByLabel("专辑名称", { exact: true }).fill("偏好验证（样本）");
  await page.getByLabel("音乐人", { exact: true }).fill("测试者");
  await genre(page);
  await rate(page);
  await expect(page.locator("#score-card-svg")).toHaveAttribute(
    "viewBox",
    "0 0 1080 1440",
  );
});

test("手机导入确认与工作台在 390px 和 320px 宽度下可操作且不横向溢出", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await openLink(page, bandcampLink);
  await expect(page.getByLabel("导入专辑名称")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${snapshots}/mobile-import.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await genre(page);
  await home(page);
  await page.getByRole("button", { name: "专业工作台", exact: true }).click();
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "作品库", exact: true })
    .click();
  await expect(page.locator(".library-row")).toHaveCount(1);
  await page.screenshot({
    path: `${snapshots}/mobile-workbench.png`,
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

for (const provider of ["netease", "qq-music"] as const)
  test(`国内专辑短链 -> Python解析 -> 确认 -> 原数据库与卡片（${provider} 上游固定样本）`, async ({
    page,
  }) => {
    const url =
      provider === "netease"
        ? "https://163cn.tv/fixture"
        : "https://c6.y.qq.com/base/fcgi-bin/u?__=fixture";
    const title =
      provider === "netease"
        ? "网易云导入测试（固定样本）"
        : "QQ 导入测试（固定样本）";
    await page.goto(origin);
    await openLink(page, "分享专辑《固定样本》 " + url + " @音乐平台");
    await expect(page.getByLabel("导入专辑名称")).toHaveValue(title);
    await expect(
      page.getByText(
        "资料来源：" + (provider === "netease" ? "网易云音乐" : "QQ 音乐"),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("导入曲目 3 名称")).toHaveValue("样本曲目三");
    await page.screenshot({
      path: `${snapshots}/${provider}-import-fixture.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "确认并继续", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "专辑风格二级风格", exact: true }),
    ).toContainText("选择细分风格");
    await page.getByText("查看曲目（3 首）", { exact: true }).click();
    await expect(page.getByLabel("曲目 2 时长", { exact: true })).toHaveValue(
      "3:30",
    );
    await genre(page);
    await rate(page);
    await expect(page.locator("#score-card-svg image")).toHaveAttribute(
      "href",
      /^data:image\/png/,
    );
    await page.getByRole("button", { name: "文件与备份", exact: true }).click();
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出全部备份", exact: true })
      .click();
    const data = JSON.parse(
      await readFile((await (await event).path())!, "utf8"),
    );
    expect(data.albums[0].importSource.provider).toBe(provider);
    expect(data.albums[0].importSource.originalUrl).toBe(url);
    expect(data.albums[0].tracks).toHaveLength(3);
    expect(data.snapshots[0].calculation.total).toBe("8.00");
  });
