import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const names = ["歌词", "作曲", "表演", "制作", "愿景", "语境"];
const instrumental = ["素材", "结构", "表演", "制作", "愿景", "语境"];
async function start(page: Page, title = "双体系浏览器技术样本（虚构）") {
  await page.goto("/");
  await page.getByRole("button", { name: "快速评分", exact: true }).click();
  await page.getByLabel("专辑名称", { exact: true }).fill(title);
  await page.getByLabel("艺术家", { exact: true }).fill("技术验收");
  await page.getByLabel("发行年份", { exact: true }).fill("2026");
  await choose(page);
}
async function choose(page: Page) {
  await page
    .getByLabel("二级风格", { exact: true })
    .selectOption("genre:dance-pop");
}
async function star(page: Page, name: string, value = 4) {
  const slider = page.getByRole("slider", { name: `${name}评分`, exact: true });
  await slider.focus();
  await slider.press("Home");
  for (let i = 1; i < value * 2; i++) await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", String(value));
}
async function rate(page: Page, dimensions = names, value = 4) {
  for (const name of dimensions) await star(page, name, value);
}
async function category(page: Page, value: "歌曲" | "乐曲") {
  await page
    .getByRole("group", { name: "作品类别", exact: true })
    .getByRole("button", { name: value, exact: true })
    .click();
}
async function png(page: Page, height: number) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(height);
}
test("single page has all four sections, live exact score, six petals and three genuine PNG ratios", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page);
  for (const id of ["dual-info", "dual-genres", "dual-ratings", "dual-preview"])
    await expect(page.locator(`#${id}`)).toBeAttached();
  await expect(
    page.getByRole("button", { name: /下一步|生成评分卡/ }),
  ).toHaveCount(0);
  await expect(page.getByText("有歌词", { exact: true })).toHaveCount(0);
  await page
    .locator(
      '.dual-workspace input[type=file][accept="image/png,image/jpeg,image/webp"]',
    )
    .setInputFiles(resolve("tests/fixtures/cover.png"));
  await rate(page);
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  const card = page.locator("#score-card-svg");
  await expect(card.locator("[data-petal]")).toHaveCount(6);
  const petal = card.locator("[data-petal=lyrics]");
  const before = await petal.getAttribute("d");
  await star(page, "歌词", 3.5);
  await expect(page.getByTestId("dual-total")).toHaveText("7.81");
  expect(await petal.getAttribute("d")).not.toBe(before);
  await star(page, "歌词", 4);
  await page.getByText("可选笔记与复核", { exact: true }).click();
  await page
    .getByLabel("专辑短评", { exact: true })
    .fill("单页实时预览；技术测试，不代表真实评价。");
  await expect(card).toContainText("v0.40.0");
  await expect(page.getByRole("button", { name: /正式发布/ })).toHaveCount(0);
  for (const [ratio, height] of [
    ["4:5", 1350],
    ["3:4", 1440],
    ["1:1", 1080],
  ] as const) {
    await page.getByLabel("卡片比例", { exact: true }).selectOption(ratio);
    await png(page, height);
  }
  await page.getByLabel("卡片比例", { exact: true }).selectOption("4:5");
  await page.screenshot({
    path: "test-results/v040-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("switching modes keeps separate ratings, evidence, genre weights and saved drafts through refresh", async ({
  page,
}) => {
  await start(page);
  await rate(page);
  await page.getByText("可选笔记与复核", { exact: true }).click();
  await page.getByLabel("歌词文字证据").fill("歌曲专属证据");
  await category(page, "乐曲");
  await expect(
    page.getByRole("slider", { name: "素材评分", exact: true }),
  ).toHaveAttribute("aria-valuetext", "未评分");
  await expect(page.getByLabel("二级风格", { exact: true })).toHaveValue("");
  await choose(page);
  await page
    .getByLabel("条件适用依据")
    .fill("此测试作品确有可独立评价的器乐材料与组织。");
  await rate(page, instrumental, 3.5);
  await page.getByLabel("素材文字证据").fill("乐曲专属证据");
  await expect(page.getByTestId("dual-total")).toHaveText("7.00");
  await expect(page.locator(".dual-weights")).toContainText("18%");
  await category(page, "歌曲");
  await expect(page.getByLabel("歌词文字证据")).toHaveValue("歌曲专属证据");
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  await page.reload();
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  await category(page, "乐曲");
  await expect(page.getByTestId("dual-total")).toHaveText("7.00");
  await page.getByText("可选笔记与复核", { exact: true }).click();
  await expect(page.getByLabel("素材文字证据")).toHaveValue("乐曲专属证据");
});
test("mixed albums require reviewed artistic shares and count vision/context once", async ({
  page,
}) => {
  await start(page);
  await rate(page);
  await page.getByLabel("混合歌曲与器乐专辑", { exact: true }).check();
  await star(page, "愿景");
  await star(page, "语境");
  await category(page, "乐曲");
  await choose(page);
  await page.getByLabel("条件适用依据").fill("器乐部分具有完整的材料与结构");
  await rate(page, instrumental.slice(0, 4), 3);
  await expect(page.getByTestId("dual-total")).toHaveText("—");
  await page.getByLabel("歌曲艺术比重", { exact: true }).fill("60");
  await page
    .getByLabel("艺术比重依据", { exact: true })
    .fill(
      "歌曲部分承担主要叙述，器乐承担整碟时间推进；人工比重，不依据曲目数。",
    );
  await page.getByLabel("比重审核人", { exact: true }).fill("人工测试员");
  await page.getByLabel("已人工审核艺术比重", { exact: true }).check();
  await expect(page.getByTestId("dual-total")).toHaveText("7.44");
  await expect(page.locator("#score-card-svg")).toContainText("专辑一次");
  await png(page, 1350);
  await category(page, "歌曲");
  await expect(
    page.getByRole("slider", { name: "愿景评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "4");
  await page.getByLabel("歌曲艺术比重", { exact: true }).fill("60.5");
  await expect(page.getByTestId("dual-total")).toHaveText("—");
  await page.getByLabel("已人工审核艺术比重", { exact: true }).check();
  await expect(page.getByTestId("dual-total")).toHaveText("7.45");
});
test("snapshots are frozen; full JSON restore and single evaluation roundtrip do not overwrite", async ({
  page,
  browser,
  baseURL,
}) => {
  await start(page);
  await rate(page);
  await page.getByRole("button", { name: "保存评分版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存冻结快照");
  const exportEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "评分JSON", exact: true }).click();
  const evaluation = await readFile(
    (await (await exportEvent).path())!,
    "utf8",
  );
  await star(page, "歌词", 3);
  await page.goto("/#/ratings");
  await page.getByRole("button", { name: "查看冻结卡片", exact: true }).click();
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  await expect(
    page.getByRole("slider", { name: "歌词评分", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  const frozenURL = page.url();
  await page.reload();
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  expect(page.url()).toBe(frozenURL);
  await page.goto("/#/data");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出V0.40完整备份", exact: true })
    .click();
  const backup = await readFile((await (await event).path())!, "utf8");
  const copy = await browser.newPage();
  await copy.goto(baseURL + "/#/data");
  async function restore(data: string) {
    const chooser = copy.waitForEvent("filechooser");
    await copy
      .getByRole("button", { name: "恢复V0.40备份", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(data),
    });
  }
  await restore(backup);
  await expect(copy.getByRole("status")).toContainText("已恢复2条");
  await restore(backup);
  await expect(copy.getByRole("status")).toContainText("已恢复0条");
  await copy.goto(baseURL + "/#/ratings");
  await copy.getByRole("button", { name: "查看冻结卡片", exact: true }).click();
  await expect(copy.getByTestId("dual-total")).toHaveText("8.00");
  await copy.close();
  const single = await browser.newPage();
  await single.goto(baseURL + "/#/data");
  const chooser = single.waitForEvent("filechooser");
  await single
    .getByRole("button", { name: "恢复V0.40备份", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "evaluation.json",
    mimeType: "application/json",
    buffer: Buffer.from(evaluation),
  });
  await expect(single.getByRole("status")).toContainText("已恢复2条");
  await single.goto(baseURL + "/#/ratings");
  await single
    .getByRole("button", { name: "查看冻结卡片", exact: true })
    .click();
  await expect(single.getByTestId("dual-total")).toHaveText("8.00");
  await single.close();
});
for (const width of [320, 390])
  test(`single-page mobile at ${width}px has usable half-stars and no horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await start(page, `手机${width}技术样本`);
    await rate(page);
    await star(page, "歌词", 3.5);
    await expect(page.getByTestId("dual-total")).toHaveText("7.81");
    const box = await page
      .getByRole("slider", { name: "作曲评分", exact: true })
      .locator("button")
      .nth(2)
      .boundingBox();
    await page
      .getByRole("slider", { name: "作曲评分", exact: true })
      .locator("button")
      .nth(2)
      .click({ position: { x: box!.width / 4, y: box!.height / 2 } });
    await expect(
      page.getByRole("slider", { name: "作曲评分", exact: true }),
    ).toHaveAttribute("aria-valuenow", "2.5");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/v040-mobile-${width}.png`,
      fullPage: true,
    });
  });
test("four reference sets expose 168 named candidates and seven tiers", async ({ page }) => {
  await page.goto('/#/reference');
  const ids = new Set<string>();
  for (const label of ['中国歌曲','中国乐曲','国际歌曲','国际乐曲']) {
    await page.getByRole('tab', { name:label, exact:true }).click();
    await expect(page.locator('.anchor-cell')).toHaveCount(42);
    for (const id of await page.locator('.anchor-cell').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-anchor-id')!))) ids.add(id);
    await expect(page.locator('.anchor-cell h3').filter({ hasText: '待选专辑' })).toHaveCount(0);
  }
  expect(ids.size).toBe(168);
  await page.getByRole('tab', {name:'中国歌曲',exact:true}).click();
  await page.getByLabel('参考维度',{exact:true}).selectOption('歌词');
  await expect(page.locator('.anchor-cell')).toHaveCount(7);
});
test("manual entry has no links, Spotify or inferred stars and style", async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button',{name:/通过链接|Spotify|配置/})).toHaveCount(0);
  await page.getByRole('button',{name:'快速评分',exact:true}).click();
  await expect(page).toHaveURL(/#\/studio\/draft\//);
  await expect(page.getByRole('slider')).toHaveCount(6);
  await expect(page.getByLabel('二级风格',{exact:true})).toHaveValue('');
  await expect(page.getByTestId('dual-total')).toHaveText('—');
});
