import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const shot = "docs/workspace-navigation/screenshots";
test.beforeAll(async () => {
  await mkdir(shot, { recursive: true });
});
async function settleMenu(page: Page) {
  const panel = page.locator("#app-navigation");
  if ((await panel.getAttribute("aria-hidden")) === "false")
    await expect(panel).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  else await expect(panel).toHaveCSS("visibility", "hidden");
  await page.evaluate(() => scrollTo(0, 0));
}
async function navigate(page: Page, name: string) {
  const menu = page.getByRole("navigation", { name: "应用导航", exact: true });
  if (!(await menu.isVisible()))
    await page
      .getByRole("button", { name: "展开导航菜单", exact: true })
      .click();
  await menu.getByRole("button", { name, exact: true }).click();
}
async function chooseGenre(page: Page) {
  await page
    .getByRole("button", { name: "直接搜索细分风格", exact: true })
    .click();
  await page.getByLabel("专辑风格搜索全部风格").fill("Pop (General)");
  await page.locator(".global-choice .choice-options button").first().click();
}
async function create(page: Page, title: string) {
  await page.getByRole("button", { name: "手动添加专辑", exact: true }).click();
  await page.getByLabel("专辑名称", { exact: true }).fill(title);
  await page.getByLabel("音乐人", { exact: true }).fill("导航验收测试者");
  await page.getByLabel("发行年份", { exact: true }).fill("2024");
  await chooseGenre(page);
}
async function star(page: Page, label: string, value: number) {
  const slider = page.getByRole("slider", {
    name: label + "评分",
    exact: true,
  });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < (value - 0.5) * 2; i++) await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", String(value));
}
async function backup(page: Page) {
  await page.getByRole("button", { name: "文件与备份", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部备份", exact: true }).click();
  const data = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  await page
    .getByRole("button", { name: "关闭文件与备份", exact: true })
    .click();
  return data;
}

test("首页工作台入口展开同一菜单；全工作区往返与浏览器前进后退", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page).toHaveURL(/#\/home$/);
  await page.getByRole("button", { name: "专业工作台", exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(
    page.getByRole("navigation", { name: "应用导航" }).getByRole("button"),
  ).toHaveCount(7);
  await settleMenu(page);
  await page.screenshot({
    path: shot + "/desktop-home-menu.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "收起导航菜单", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "应用导航" }),
  ).not.toBeVisible();
  await navigate(page, "作品库");
  await expect(page).toHaveURL(/#\/library$/);
  await expect(
    page.getByRole("heading", { name: "作品库", exact: true }),
  ).toBeVisible();
  await navigate(page, "评分记录");
  await expect(page).toHaveURL(/#\/ratings$/);
  await navigate(page, "设置");
  await expect(page).toHaveURL(/#\/settings$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/ratings$/);
  await expect(
    page.getByRole("heading", { name: "评分记录", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/ratings$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/settings$/);
  await page.getByRole("button", { name: "返回上一级", exact: true }).click();
  await expect(page).toHaveURL(/#\/ratings$/);
  await page
    .getByRole("navigation", { name: "当前位置" })
    .getByRole("button", { name: "首页", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/home$/);
  await navigate(page, "风格管理");
  await expect(page.getByText("风格库只读", { exact: true })).toBeVisible();
  await navigate(page, "评分卡");
  await expect(
    page.getByRole("heading", { name: "评分卡", exact: true }),
  ).toBeVisible();
  await navigate(page, "数据管理");
  await expect(
    page.getByRole("button", { name: "导出全部备份", exact: true }),
  ).toBeVisible();
  await navigate(page, "首页");
  await expect(page.getByLabel("搜索专辑或音乐人")).toBeVisible();
  expect(errors).toEqual([]);
});

test("评分中切换菜单、其他工作区、返回与刷新，草稿及评分卡更新和PNG保留", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await create(page, "工作空间验收专辑（虚构样本）");
  await page.getByRole("button", { name: "下一步：评分", exact: true }).click();
  const values = [3.5, 4, 4, 4.5, 4, 3];
  const labels = ["作词", "作曲", "表演", "声音", "愿景", "语境"];
  for (let i = 0; i < 6; i++) await star(page, labels[i], values[i]);
  const ratingAddress = page.url();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(
    page.getByRole("button", { name: "展开导航菜单", exact: true }),
  ).toBeInViewport();
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("button", { name: "展开导航菜单", exact: true }).click();
  await settleMenu(page);
  await page.screenshot({
    path: shot + "/desktop-rating-menu.png",
    fullPage: true,
  });
  await navigate(page, "作品库");
  await expect(page.locator(".library-row")).toContainText(
    "工作空间验收专辑（虚构样本）",
  );
  await navigate(page, "设置");
  await navigate(page, "首页");
  await page.getByRole("button", { name: "快速评分", exact: true }).click();
  await expect(page).toHaveURL(ratingAddress);
  for (let i = 0; i < 6; i++)
    await expect(
      page.getByRole("slider", { name: labels[i] + "评分", exact: true }),
    ).toHaveAttribute("aria-valuenow", String(values[i]));
  await page.reload();
  await expect(page).toHaveURL(ratingAddress);
  await expect(
    page.getByRole("slider", { name: "作词评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "3.5");
  await page.getByRole("button", { name: "生成评分卡", exact: true }).click();
  const before = await page
    .locator('#score-card-svg text[font-size="98"]')
    .textContent();
  expect(Number(before)).toBeGreaterThan(0);
  await page
    .getByRole("textbox", { name: "专辑短评", exact: true })
    .fill("导航切换之后，短评也应保留。");
  const cardAddress = page.url();
  await navigate(page, "评分记录");
  await navigate(page, "首页");
  await page.getByRole("button", { name: "继续当前评分", exact: true }).click();
  await expect(page).toHaveURL(cardAddress);
  await expect(
    page.getByRole("textbox", { name: "专辑短评", exact: true }),
  ).toHaveValue("导航切换之后，短评也应保留。");
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  await star(page, "声音", 5);
  await page.getByRole("button", { name: "生成评分卡", exact: true }).click();
  expect(
    Number(
      await page.locator('#score-card-svg text[font-size="98"]').textContent(),
    ),
  ).toBeGreaterThan(Number(before));
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PNG", exact: true }).click();
  const bytes = await readFile((await (await event).path())!);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1350);
  await navigate(page, "作品库");
  await settleMenu(page);
  await page.screenshot({
    path: shot + "/desktop-library.png",
    fullPage: true,
  });
  const data = await backup(page);
  expect(data.albums).toHaveLength(1);
  expect(data.albums[0].ratings.lyrics.value).toBe(3.5);
  expect(data.albums[0].summary).toContain("短评也应保留");
  expect(data.snapshots.length).toBeGreaterThan(0);
});

test("浏览器历史在两个草稿之间切换不会串写，尚未到自动保存间隔也能恢复", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "草稿A（虚构）");
  await page.getByRole("button", { name: "下一步：评分", exact: true }).click();
  await star(page, "作词", 3.5);
  const addressA = page.url();
  await navigate(page, "作品库");
  await page.getByRole("button", { name: "添加作品", exact: true }).click();
  await page.getByLabel("专辑名称", { exact: true }).fill("草稿B（虚构）");
  await page.getByLabel("音乐人", { exact: true }).fill("另一位测试者");
  const addressB = page.url();
  await navigate(page, "首页");
  await page.goBack();
  await expect(page).toHaveURL(addressB);
  await expect(page.getByLabel("专辑名称", { exact: true })).toHaveValue(
    "草稿B（虚构）",
  );
  await page.goBack();
  await expect(page).toHaveURL(/#\/library$/);
  await page.goBack();
  await expect(page).toHaveURL(addressA);
  await expect(
    page.getByRole("slider", { name: "作词评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "3.5");
  await star(page, "作词", 4);
  await page.goForward();
  await expect(page).toHaveURL(/#\/library$/);
  await page.goForward();
  await expect(page).toHaveURL(addressB);
  await expect(page.getByLabel("专辑名称", { exact: true })).toHaveValue(
    "草稿B（虚构）",
  );
  const data = await backup(page);
  expect(
    data.albums.find((a: { title: string }) => a.title === "草稿A（虚构）")
      .ratings.lyrics.value,
  ).toBe(4);
  expect(
    data.albums.find((a: { title: string }) => a.title === "草稿B（虚构）")
      .ratings.lyrics.value,
  ).toBeNull();
});

test("只读风格库能搜索选择并明确应用到同一草稿，原评分保持", async ({
  page,
}) => {
  await page.goto("/");
  await create(page, "风格选择验收（虚构）");
  await page.getByRole("button", { name: "下一步：评分", exact: true }).click();
  await star(page, "声音", 4);
  await navigate(page, "风格管理");
  await page
    .getByRole("button", { name: "直接搜索细分风格", exact: true })
    .click();
  await page.getByLabel("风格库搜索全部风格").fill("Synth-Pop");
  await page.locator(".global-choice .choice-options button").first().click();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await settleMenu(page);
  await page.screenshot({ path: shot + "/genre-library.png", fullPage: true });
  await page
    .getByRole("button", { name: "应用到当前草稿", exact: true })
    .click();
  await expect(page.getByLabel("专辑名称", { exact: true })).toHaveValue(
    "风格选择验收（虚构）",
  );
  await expect(
    page.getByRole("button", { name: "专辑风格二级风格", exact: true }),
  ).toContainText("合成器流行");
  await page.getByRole("button", { name: "下一步：评分", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "声音评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "4");
});

test("手机抽屉支持触摸、遮罩、Escape及焦点返回；收起不离开当前评分", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const toggle = page.getByRole("button", {
    name: "展开导航菜单",
    exact: true,
  });
  await toggle.tap();
  await expect(
    page.getByRole("dialog", { name: "功能菜单", exact: true }),
  ).toBeVisible();
  await settleMenu(page);
  await page.screenshot({ path: shot + "/mobile-menu.png", fullPage: true });
  const scrim = page.getByRole("button", { name: "关闭导航遮罩", exact: true });
  const box = (await scrim.boundingBox())!;
  await scrim.tap({ position: { x: box.width - 15, y: box.height / 2 } });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.tap();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await create(page, "手机草稿（虚构）");
  await page.getByRole("button", { name: "下一步：评分", exact: true }).click();
  await star(page, "作词", 3.5);
  const address = page.url();
  await navigate(page, "设置");
  await expect(
    page.getByRole("navigation", { name: "应用导航" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "继续当前评分", exact: true }).click();
  await expect(page).toHaveURL(address);
  await expect(
    page.getByRole("slider", { name: "作词评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "3.5");
  await page.getByRole("button", { name: "展开导航菜单", exact: true }).tap();
  await page.getByRole("button", { name: "收起侧边导航", exact: true }).tap();
  await expect(page).toHaveURL(address);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await settleMenu(page);
  await page.screenshot({ path: shot + "/mobile-rating.png", fullPage: true });
  await context.close();
});

test("深链接、刷新以及不存在的记录均有可用返回入口", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByLabel("默认导出比例")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("默认导出比例")).toBeVisible();
  await page.getByRole("button", { name: "返回上一级", exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await page.goto("/#/album/this-record-does-not-exist/rating");
  await expect(
    page.getByRole("heading", { name: "暂时无法打开记录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回作品库", exact: true }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await navigate(page, "首页");
  await expect(page.getByLabel("搜索专辑或音乐人")).toBeVisible();
});
