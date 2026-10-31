import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { newAlbum } from "../src/model/types";

const shots = "docs/v035/screenshots";
test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
});
async function enable(page: Page) {
  await page.goto("/#/research");
  await expect(
    page.getByRole("heading", { name: "V0.35 研究评分", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "备份旧库并启用研究版", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  await expect(
    page.getByRole("button", { name: "新建研究评分", exact: true }),
  ).toBeEnabled();
  return backup;
}
async function create(page: Page, title = "V035浏览器技术样本（虚构）") {
  await page.getByRole("button", { name: "新建研究评分", exact: true }).click();
  await page.getByLabel("研究专辑名", { exact: true }).fill(title);
  await page.getByLabel("研究音乐人", { exact: true }).fill("自动化技术测试");
  await page.getByLabel("研究发行版次与来源").fill("虚构版次；不代表真实发行");
  await choose(page, "genre:post-punk");
}
async function choose(page: Page, id: string) {
  await page.getByLabel("研究版搜索风格", { exact: true }).fill(id);
  await page.locator(".research-genre-list button").first().click();
  await page.getByRole("button", { name: "设为主风格", exact: true }).click();
}
async function stars(page: Page, first = "表意", value = 4) {
  for (const label of [first, "作曲", "表演", "声音", "愿景", "语境"]) {
    const slider = page.getByRole("slider", {
      name: `研究${label}评分`,
      exact: true,
    });
    await slider.focus();
    await slider.press("Home");
    for (let i = 1; i < value * 2; i++) await slider.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", String(value));
  }
}
async function oldContent(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("nmc-workbench-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(["albums", "snapshots"], "readonly");
    const get = (s: string) =>
      new Promise<unknown[]>((resolve) => {
        const r = tx.objectStore(s).getAll();
        r.onsuccess = () => resolve(r.result);
      });
    const [albums, snapshots] = await Promise.all([
      get("albums"),
      get("snapshots"),
    ]);
    db.close();
    return JSON.stringify({ albums, snapshots });
  });
}
test("V035备份真实当前测试origin并保留旧N/A；新草稿在浏览器后退、刷新后保留", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const legacy = newAlbum();
  legacy.title = "明确虚构的旧版N/A测试样本";
  legacy.artist = "自动化测试";
  legacy.genreId = "genre:pop-general";
  legacy.ratings.lyrics.value = "na";
  legacy.ratings.lyrics.naReason = "技术样本";
  legacy.ratings.composition.value = 4;
  await page.evaluate(async (album) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("nmc-workbench-v1", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("albums", { keyPath: "id" });
        r.result
          .createObjectStore("snapshots", { keyPath: "id" })
          .createIndex("albumId", "albumId");
      };
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("albums", "readwrite");
      tx.objectStore("albums").put(album);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, legacy);
  await page.reload();
  const before = await oldContent(page),
    backup = await enable(page);
  expect(backup.albums).toHaveLength(1);
  expect(backup.albums[0].ratings.lyrics.value).toBe("na");
  await page
    .getByLabel("选择旧版作品", { exact: true })
    .selectOption(legacy.id);
  await page
    .getByRole("button", { name: "复制资料为V0.35新草稿", exact: true })
    .click();
  await expect(page.getByLabel("研究专辑名", { exact: true })).toHaveValue(
    legacy.title,
  );
  for (const label of ["歌词", "作曲", "表演", "声音", "愿景", "语境"])
    await expect(
      page.getByRole("slider", { name: `研究${label}评分`, exact: true }),
    ).toHaveAttribute("aria-valuetext", "未评分");
  await page.getByLabel("研究专辑名", { exact: true }).fill("新草稿（虚构）");
  const address = page.url();
  await page.getByRole("button", { name: "研究作品库", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(page.getByLabel("研究专辑名", { exact: true })).toHaveValue(
    "新草稿（虚构）",
  );
  await page.reload();
  await expect(page.getByLabel("研究专辑名", { exact: true })).toHaveValue(
    "新草稿（虚构）",
  );
  expect(await oldContent(page)).toBe(before);
  expect(errors).toEqual([]);
});
test("V035国风待定义需显式研究许可；索引无权重；古风不合并", async ({
  page,
}) => {
  await enable(page);
  await page.getByRole("button", { name: "新建研究评分", exact: true }).click();
  await page.getByLabel("研究版搜索风格").fill("genre:j-pop");
  await page.locator(".research-genre-list button").click();
  await expect(
    page.getByRole("button", { name: "索引不可作为主风格", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "此项仅作检索索引，没有独立权重。请根据作品选择具体主风格。",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByLabel("研究版搜索风格").fill("genre:chinese-style-pop");
  await page.locator(".research-genre-list button").click();
  await expect(
    page.getByRole("heading", { name: "国风 / Guofeng", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "用于研究试算", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("我明确选择研究试算，知悉该风格定义尚待裁定").check();
  await page.getByRole("button", { name: "用于研究试算", exact: true }).click();
  await page.getByLabel("研究版搜索风格").fill("古风");
  await expect(page.locator(".research-genre-list")).toContainText("古风");
  await page.screenshot({
    path: shots + "/definition-review.png",
    fullPage: true,
  });
});
test("V035六维8.00、不可变快照、动态六瓣图、三比例与PNG/JSON/CSV", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await enable(page);
  await create(page);
  await page
    .getByRole("button", { name: "表意 Expression", exact: true })
    .click();
  await stars(page);
  await expect(page.locator(".research-total")).toContainText("8.00");
  await page.screenshot({
    path: shots + "/desktop-editor.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "保存不可变研究快照", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/research\/revision\//);
  await expect(page.getByLabel("研究专辑名")).toBeDisabled();
  await page.getByRole("button", { name: "评分卡与导出", exact: true }).click();
  const svg = page.locator(".research-card-preview svg");
  await expect(svg).toContainText("Expression");
  await expect(svg).toContainText("研究评分");
  await expect(svg.locator("[data-petal]")).toHaveCount(6);
  for (const [ratio, height] of [
    ["4:5", "1350"],
    ["3:4", "1440"],
    ["1:1", "1080"],
  ]) {
    await page.getByLabel("研究评分卡比例").selectOption(ratio);
    await expect(svg).toHaveAttribute("viewBox", `0 0 1080 ${height}`);
  }
  await page.screenshot({
    path: shots + "/research-card-square.png",
    fullPage: true,
  });
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON快照", exact: true }).click();
  const json = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  expect(json.snapshot.status).toBe("research_only");
  expect(json.snapshot.scoreCents).toBe(800);
  expect(json.snapshot.ratingsSnapshotTicks.first).toBe(8);
  expect(json.snapshot.profileStatus).toBe("research_candidate");
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV快照", exact: true }).click();
  const csv = await readFile((await (await csvEvent).path())!, "utf8");
  expect(csv).toContain(json.snapshot.integrityHash);
  expect(csv).toContain("Expression");
  const pngEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出研究PNG", exact: true }).click();
  const png = await readFile((await (await pngEvent).path())!);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1080);
  await writeFile(shots + "/research-card-export.png", png);
  await page.getByRole("button", { name: "另存为新修订", exact: true }).click();
  await page.getByLabel("研究专辑名").fill("新修订（虚构）");
  await page.goto("/#/research");
  await expect(
    page.getByRole("heading", { name: "不可变研究记录 · 1", exact: true }),
  ).toBeVisible();
});
test("V035混合首维4.25仅参考，复核前禁止快照，其他五维保持整碟星级", async ({
  page,
}) => {
  await enable(page);
  await create(page, "混合专辑技术样本（虚构）");
  await page
    .getByRole("button", {
      name: "歌词／表意 Lyrics / Expression",
      exact: true,
    })
    .click();
  for (let i = 1; i <= 2; i++) {
    await page
      .getByRole("button", { name: "添加评价单位", exact: true })
      .click();
    await page
      .getByLabel(`单位${i}名称`, { exact: true })
      .fill(`明确虚构单位${i}`);
    await page.getByLabel(`单位${i}时长秒`, { exact: true }).fill("200");
    await page
      .getByLabel(`单位${i}首维模式`)
      .selectOption(i === 1 ? "lyrics" : "expression");
    const s = page.getByRole("slider", {
      name: `单位${i}首维评分`,
      exact: true,
    });
    await s.focus();
    await s.press("Home");
    for (let n = 1; n < (i === 1 ? 8 : 9); n++) await s.press("ArrowRight");
    await page
      .getByLabel(`单位${i}证据`, { exact: true })
      .fill("虚构边界测试的语义证据");
  }
  await expect(page.getByText("4.25 星", { exact: true })).toBeVisible();
  await stars(page, "歌词／表意", 3.5);
  await page
    .getByLabel("整碟首维人工裁定理由")
    .fill("虚构边界测试：人工整碟裁定3.5星，其他维度未按曲目平均。");
  await expect(
    page.getByRole("button", { name: "保存不可变研究快照", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("中界已人工复听复核", { exact: true }).check();
  await expect(page.locator(".research-total")).toContainText("7.00");
  await page.screenshot({
    path: shots + "/mixed-midpoint.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "保存不可变研究快照", exact: true })
    .click();
  await expect(page).toHaveURL(/revision/);
});
test("V035手机流程、辅助标签上限、停用与恢复入口保留研究历史", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enable(page);
  await create(page, "手机研究技术样本（虚构）");
  for (const q of ["genre:folk-pop", "genre:twee-pop"]) {
    await page.getByLabel("搜索研究辅助标签").fill(q);
    await page.locator(".research-tag-options button").first().click();
  }
  await page.getByLabel("搜索研究辅助标签").fill("genre:j-pop");
  await expect(
    page.locator(".research-tag-options button").first(),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "表意 Expression", exact: true })
    .click();
  await stars(page);
  await page
    .getByRole("button", { name: "保存不可变研究快照", exact: true })
    .click();
  await page.screenshot({
    path: shots + "/mobile-research.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "备份与回滚", exact: true }).click();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出研究库完整备份", exact: true })
    .click();
  const backup = JSON.parse(await readFile((await (await dl).path())!, "utf8"));
  expect(backup.payload.revisions).toHaveLength(1);
  await page
    .getByRole("button", { name: "停用研究目录并回滚入口", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "研究目录已停用", exact: true }),
  ).toBeVisible();
  const reenable = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "备份旧库并启用研究版", exact: true })
    .click();
  await reenable;
  await page
    .getByRole("button", { name: "研究作品与记录", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "不可变研究记录 · 1", exact: true }),
  ).toBeVisible();
});
test("V035沿用元数据JSON导入且不写旧库、不自动赋风格和评分（固定样本）", async ({
  page,
}) => {
  await enable(page);
  const before = await oldContent(page);
  await page
    .getByRole("button", { name: "通过链接添加研究作品", exact: true })
    .click();
  const metadata = {
    format: "mumaka-album-import",
    schemaVersion: 1,
    source: {
      provider: "netease",
      url: "https://music.163.com/album?id=1234567",
      metadataUrl: "https://music.163.com/album?id=1234567",
      fetchedAt: "2026-10-31T00:00:00.000Z",
      adapter: "explicit-synthetic-test",
    },
    album: {
      title: "新版导入技术样本（虚构）",
      artist: "固定样本测试者",
      year: "2026",
      releaseDate: "2026-01-01",
      releaseType: "album",
      coverUrl: "",
      coverDataUrl: "",
      label: "虚构",
      tracks: [{ position: 1, title: "虚构曲目", duration: 200 }],
      referenceGenres: ["J-Pop"],
    },
    warnings: ["这是明确的固定样本，不代表真实平台连通"],
  };
  await page
    .getByLabel("导入专辑元数据文件", { exact: true })
    .setInputFiles({
      name: "synthetic-album.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(metadata)),
    });
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await expect(page.getByLabel("研究专辑名", { exact: true })).toHaveValue(
    metadata.album.title,
  );
  await expect(
    page.getByRole("slider", { name: "研究歌词评分", exact: true }),
  ).toHaveAttribute("aria-valuetext", "未评分");
  await expect(
    page.getByRole("button", { name: "保存不可变研究快照", exact: true }),
  ).toBeDisabled();
  expect(await oldContent(page)).toBe(before);
});
