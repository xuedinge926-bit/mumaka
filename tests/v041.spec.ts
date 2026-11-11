import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const dimensions = ["歌词", "作曲", "表演", "制作", "愿景", "语境"];
async function start(page: Page, title = "体验验收（虚构技术样本）") {
  await page.goto("/");
  await page.getByRole("button", { name: "快速评分", exact: true }).click();
  await page.getByLabel("专辑名称", { exact: true }).fill(title);
  await page.getByLabel("艺术家", { exact: true }).fill("技术验收");
  await page
    .getByLabel("二级风格", { exact: true })
    .selectOption("genre:dance-pop");
}
async function rate(page: Page) {
  for (const name of dimensions) {
    const slider = page.getByRole("slider", {
      name: `${name}评分`,
      exact: true,
    });
    await slider.focus();
    await slider.press("End");
    await slider.press("ArrowLeft");
    await slider.press("ArrowLeft");
  }
}
async function go(page: Page, name: string) {
  await page.getByRole("button", { name: "展开导航菜单", exact: true }).click();
  await page
    .getByRole("navigation", { name: "应用导航", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

test("desktop drawer floats, closes on backdrop and Escape, traps focus and all navigation items remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const home = page.locator(".home-intro"),
    before = await home.boundingBox();
  await page.getByRole("button", { name: "展开导航菜单", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "功能菜单", exact: true }),
  ).toBeVisible();
  expect((await home.boundingBox())!.x).toBe(before!.x);
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('navigation', {name:'应用导航',exact:true}).getByRole('button',{name:'数据与工具',exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'收起侧边导航',exact:true})).toBeFocused();
  await expect(page.locator("#app-navigation")).not.toContainText(
    /MUMAKA|新乐评主义|研究评分|专业工作台/,
  );
  await page
    .getByLabel("关闭导航遮罩")
    .click({ position: { x: 1000, y: 300 } });
  await expect(page.locator("#app-navigation")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await page.getByRole("button", { name: "展开导航菜单", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "展开导航菜单", exact: true }),
  ).toBeFocused();
  for (const name of [
    "作品库",
    "评分记录",
    "风格管理",
    "星级标尺参考",
    "设置",
    "数据与工具",
    "首页",
  ]) {
    await go(page, name);
    await expect(page.locator("#app-navigation")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  }
  await page.screenshot({ path: "test-results/v041-home.png", fullPage: true });
});

test("appearance follows system changes, supports explicit override, persists accent and settings", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "外观与设置", exact: true }).click();
  const pop = page.getByRole("dialog", { name: "外观快捷设置", exact: true });
  await expect(pop).not.toContainText(/JSON|备份|研究|V0/);
  await pop.getByRole("button", { name: "亮色", exact: true }).click();
  await pop.getByRole("button", { name: "靛蓝", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
  await go(page, "设置");
  await page.getByRole("button", { name: "跟随系统", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("减少动画", { exact: true }).check();
  await page.getByLabel("默认展开参考专辑说明", { exact: true }).check();
  await page.getByLabel("默认导出比例", { exact: true }).selectOption("1:1");
  await page.getByLabel("默认卡片配色", { exact: true }).selectOption("ink");
  await page.getByLabel("默认地区", { exact: true }).selectOption("global");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduce-motion",
    "true",
  );
  await expect(
    page.getByLabel("默认展开参考专辑说明", { exact: true }),
  ).toBeChecked();
  await go(page, "首页");
  await page.getByRole("button", { name: "快速评分", exact: true }).click();
  await expect(page.getByLabel("卡片比例", { exact: true })).toHaveValue("1:1");
  await expect(page.getByLabel("卡片主题", { exact: true })).toHaveValue("ink");
  await expect(
    page
      .getByRole("group", { name: "地区分类", exact: true })
      .getByRole("button", { name: "外国", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("home offers manual scoring only and overview uses the same four reference sets", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (/spotify|album-import/.test(r.url())) calls.push(r.url());
  });
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("button", { name: "快速评分", exact: true }),
  ).toHaveCount(1);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main).not.toContainText(
    /Spotify|通过链接|V0.19|V0.35|专业工作台|爬取|配置/,
  );
  await page.getByRole("button", { name: "展开全部六维", exact: true }).click();
  const ids = new Set<string>();
  for (const name of ["中国歌曲", "中国乐曲", "国际歌曲", "国际乐曲"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.locator(".anchor-cell")).toHaveCount(42);
    (
      await page
        .locator("[data-anchor-id]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-anchor-id")!),
        )
    ).forEach((id) => ids.add(id));
  }
  expect(ids.size).toBe(168);
  expect(calls).toEqual([]);
  await page
    .getByRole("button", { name: "打开完整标尺 →", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/reference$/);
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await expect(page.locator("thead th")).toHaveCount(8);
});

test("half-star hover previews every level without mutating draft, totals or the card; clicks commit precisely", async ({
  page,
}) => {
  await start(page);
  await rate(page);
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  const slider = page.getByRole("slider", { name: "歌词评分", exact: true }),
    row = page.locator('[data-dimension="歌词"]');
  for (let ticks = 1; ticks <= 10; ticks++) {
    const button = slider.locator("button").nth(Math.ceil(ticks / 2) - 1),
      box = (await button.boundingBox())!;
    const position = {
      x: box.width * (ticks % 2 ? 0.25 : 0.75),
      y: box.height / 2,
    };
    await button.hover({ position });
    await expect(row.locator(".star-level")).toContainText(
      `预览 ${(ticks / 2).toFixed(1)} 星`,
    );
    await expect(slider).toHaveAttribute("aria-valuenow", "4");
    await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  }
  const fourth = slider.locator("button").nth(3),
    b = (await fourth.boundingBox())!;
  await fourth.click({ position: { x: b.width * 0.25, y: b.height / 2 } });
  await expect(slider).toHaveAttribute("aria-valuenow", "3.5");
  await expect(page.getByTestId("dual-total")).toHaveText("7.81");
  await expect(page.locator(".dual-save")).toHaveAttribute("title", "已自动保存");
  await page.reload();
  await expect(page.getByTestId("dual-total")).toHaveText("7.81");
  await expect(page.locator("#dual-ratings input[type=number]")).toHaveCount(0);
  await expect(page.locator("#dual-ratings textarea:visible")).toHaveCount(0);
  const restored = page.getByRole("slider", { name: "歌词评分", exact: true });
  await restored.focus();
  await restored.press("Home");
  await expect(restored).toHaveAttribute("aria-valuenow", "0.5");
  await expect(
    page.locator('[data-dimension="歌词"] .star-level'),
  ).toContainText("不设参考专辑");
});

test("independent draft tabs and category switches keep metadata and scores through reload", async ({
  page,
}) => {
  await start(page, "评分甲");
  await rate(page);
  const firstURL = page.url();
  await page.getByRole("button", { name: "添加评分草稿", exact: true }).click();
  await expect(page.getByLabel("专辑名称", { exact: true })).toHaveValue("");
  await page.getByLabel("专辑名称", { exact: true }).fill("评分乙");
  await page
    .getByRole("group", { name: "作品类别", exact: true })
    .getByRole("button", { name: "乐曲", exact: true })
    .click();
  const material = page.getByRole("slider", { name: "素材评分", exact: true });
  await material.focus();
  await material.press("End");
  await page.getByRole("tab", { name: "评分甲", exact: true }).click();
  await expect(page).toHaveURL(firstURL);
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  await page
    .getByRole("group", { name: "作品类别", exact: true })
    .getByRole("button", { name: "乐曲", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "素材评分", exact: true }),
  ).toHaveAttribute("aria-valuetext", "未评分");
  await page.getByRole("tab", { name: "评分乙", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "素材评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "5");
  await page.reload();
  await expect(page.getByLabel("专辑名称", { exact: true })).toHaveValue(
    "评分乙",
  );
  await expect(
    page.getByRole("slider", { name: "素材评分", exact: true }),
  ).toHaveAttribute("aria-valuenow", "5");
});

for (const width of [320, 390])
  test(`touch at ${width}px supports half-stars, info, drawer and reference scrolling`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(baseURL!);
    await page.getByRole("button", { name: "展开导航菜单", exact: true }).tap();
    await page
      .getByLabel("关闭导航遮罩")
      .tap({ position: { x: width - 6, y: 300 } });
    await page.getByRole("button", { name: "快速评分", exact: true }).tap();
    await page.getByRole("button", { name: "歌词说明", exact: true }).tap();
    await expect(
      page.locator('[data-dimension="歌词"] .dimension-tooltip'),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭歌词说明", exact: true }).tap();
    const slider = page.getByRole("slider", { name: "歌词评分", exact: true }),
      star = slider.locator("button").nth(3),
      box = (await star.boundingBox())!;
    await star.tap({ position: { x: box.width * 0.25, y: box.height / 2 } });
    await expect(slider).toHaveAttribute("aria-valuenow", "3.5");
    await star.tap({ position: { x: box.width * 0.75, y: box.height / 2 } });
    await expect(slider).toHaveAttribute("aria-valuenow", "4");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await go(page, "星级标尺参考");
    await page.getByRole("tab", { name: "国际乐曲", exact: true }).tap();
    await expect(page.locator(".anchor-cell")).toHaveCount(42);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/v041-mobile-${width}.png`,
      fullPage: true,
    });
    await context.close();
  });

test("reference manager replaces one candidate locally; home shares it; backup retains review metadata", async ({
  page,
}) => {
  await page.goto("/#/data");
  await page.getByText("管理标尺候选", { exact: true }).click();
  await page
    .getByLabel("管理参考格位", { exact: true })
    .selectOption("china-song-Production-5");
  await expect(page.getByLabel("参考专辑名", { exact: true })).toHaveValue(
    "慢慢懂",
  );
  await page
    .getByLabel("参考理由", { exact: true })
    .fill("用户候选校对：重编与新作的层次安排是比较起点，尚待完整试听审定。");
  await page.route('https://example.com/mumaka-test-missing-cover.png', route => route.fulfill({status:404,body:'missing test image'}));
  await page.getByLabel('参考封面地址',{exact:true}).fill('https://example.com/mumaka-test-missing-cover.png');
  await page.getByLabel('参考封面出处',{exact:true}).fill('https://example.com/mumaka-test-cover');
  await page.getByLabel('参考封面版权',{exact:true}).fill('测试封面，仅用于缺图回退验证');
  await page.getByRole("button", { name: "保存此格", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("参考已保存在本机");
  await page.goto("/#/reference");
  await page.getByLabel("参考维度", { exact: true }).selectOption("制作");
  const cell = page.locator('[data-anchor-id="china-song-Production-5"]');
  await cell.getByText("为何作参照", { exact: true }).click();
  await expect(cell).toContainText("用户候选校对");
  await expect(cell.locator('.reference-cover')).toHaveAttribute('aria-label','暂无封面');
  await expect(cell.locator('img')).toHaveCount(0);
  await page.goto("/#/data");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出V0.40完整备份", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  const saved = backup.catalog.anchors.find(
    (a: { id: string }) => a.id === "china-song-Production-5",
  );
  expect(saved.status).toBe("draft");
  expect(saved.feature).toContain("用户候选校对");
});

test("completed manual score exports real SVG, CSV and JSON and keeps an immutable saved version", async ({
  page,
}) => {
  await start(page);
  await rate(page);
  await page.getByRole("button", { name: "保存评分版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存冻结快照");
  for (const [button, needle] of [
    ["SVG", "<svg"],
    ["CSV", "歌词"],
    ["评分JSON", "weightsSnapshot"],
  ] as const) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    const text = await readFile((await (await download).path())!, "utf8");
    expect(text).toContain(button === "评分JSON" ? "catalogSnapshot" : needle);
  }
  await go(page, "评分记录");
  await page.getByRole("button", { name: "查看冻结卡片", exact: true }).click();
  await expect(page.getByTestId("dual-total")).toHaveText("8.00");
  await expect(
    page.getByRole("slider", { name: "歌词评分", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});
