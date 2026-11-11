import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import { chromium } from "playwright";

const [stage, executablePath] = process.argv.slice(2);
const serving = createServer(async (req, res) => {
  if (new URL(req.url, "http://127.0.0.1").pathname !== "/") { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(await readFile(join(stage, "index.html")));
});
await new Promise((done, fail) => { serving.once("error", fail); serving.listen(0, "127.0.0.1", done); });
const loopbackUrl = `http://127.0.0.1:${serving.address().port}/`;
const source = JSON.parse(await readFile(new URL("./r6-public/data.json", import.meta.url), "utf8"));
const fixtures = [
  { file: "index.html", width: 1280, height: 850, expected: "10.00" },
  { file: "index.html", width: 320, height: 700, expected: "10.00" },
];
if (loopbackUrl) fixtures.push({ file: "index.html", width: 390, height: 844, expected: "10.00", targetUrl: loopbackUrl });
let browser;
try {
browser = await chromium.launch({
  executablePath,
  headless: true,
  timeout: 15_000,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
});
  for (const { file, width, height, expected, targetUrl } of fixtures) {
    const url = targetUrl ?? pathToFileURL(join(stage, file)).href;
    const context = await browser.newContext({ viewport: { width, height }, offline: !targetUrl, serviceWorkers: "block" });
    await context.route(/^https?:/, (route) =>
      targetUrl && new URL(route.request().url()).origin === new URL(targetUrl).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);

    const trigger = page.getByRole("button", { name: "R6 研究试算", exact: true });
    const dialog = page.getByRole("dialog", { name: "R6 研究试算", exact: true });
    const style = dialog.getByLabel("R6 风格", { exact: true });
    const total = dialog.locator("#mumaka-r6-score");
    const song = ["歌词", "作曲", "表演", "声音", "愿景", "语境"];
    const instrumental = ["素材", "结构", "表演", "声音", "愿景", "语境"];
    const chooseStars = async (names, ticks, scope = dialog) => {
      for (const [index, name] of names.entries()) {
        await scope.getByRole("combobox", { name: `${name}星级`, exact: true }).selectOption(String(ticks[index]));
      }
    };
    const verifyProfiles = async (mode, names) => {
      const profiles = source.records.filter((row) => row.evaluation_mode === mode && row.trial_eligible);
      for (const profile of profiles) {
        await style.selectOption(profile.record_key);
        const weights = [...profile.weights_pct.display_2_d1_d4, "15.00", "15.00"];
        const expectedRows = names.map((name, index) => [
          name,
          profile.grades_d1_d4[index] ?? "固定",
          `${weights[index]}%`,
        ]);
        const rows = await dialog.locator("#mumaka-r6-dimensions tr").evaluateAll((rows) =>
          rows.map((row) => Array.from(row.cells).slice(0, 3).map((cell) => cell.textContent)));
        assert.deepEqual(rows, expectedRows, profile.record_key);
      }
    };

    await expect(page.getByRole("button", { name: "快速评分", exact: true })).toBeVisible();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("研究候选 · 未批准");
    const methodDetails = dialog.getByText("六维方法、星级和声音取证", { exact: true });
    await methodDetails.click();
    const method = dialog.locator("#mumaka-r6-method");
    await expect(method).toContainText("声音 Sound");
    await expect(method).toContainText("3.0 星 · 良好、完整");
    await expect(method).toContainText("母带及具体发行版本");
    await methodDetails.click();
    await expect(style.locator("option")).toHaveCount(35);
    await verifyProfiles("song", song);
    await style.selectOption("candidate:bedroom-pop|song");
    const ledgerDetails = dialog.getByText("风格证据和待审提案", { exact: true });
    await ledgerDetails.click();
    const ledger = dialog.locator("#mumaka-r6-ledger");
    await expect(ledger).toContainText("Alyssa Barna");
    await expect(ledger).toContainText("B/A/A/S");
    await expect(ledger).toContainText("本轮未完成整碟听评");
    await ledgerDetails.click();
    await style.selectOption("candidate:progressive-rock|song");
    await expect(dialog.getByRole("columnheader")).toHaveText(["维度", "评级", "权重", "星级"]);
    await expect(total).toHaveText("—");
    await chooseStars(song, [1, 1, 7, 4, 8, 6]);
    await expect(total).toHaveText("4.51");
    const dispute = dialog.getByRole("checkbox", { name: "作品的歌曲／乐曲模式有实质争议" });
    await dispute.check();
    await expect(dialog.getByText(/needs_mode_review · 暂停出分/)).toBeVisible();
    await expect(total).toHaveText("—");
    await dispute.uncheck();
    await expect(total).toHaveText("4.51");

    const takeEvidence = dialog.getByText("记录本次取证 · 选填", { exact: true });
    await takeEvidence.click();
    const evidenceStatus = dialog.locator("#mumaka-r6-evidence-status");
    await expect(evidenceStatus).toContainText("声音证据尚缺");
    const performanceClaim = dialog.getByLabel("实际唱奏的评价命题 · 可听命题", { exact: true });
    const spaceClaim = dialog.getByLabel("录音／空间的可听命题 · 可听命题", { exact: true });
    const relationClaim = dialog.getByLabel("最终混音／声音关系的可听命题 · 可听命题", { exact: true });
    await performanceClaim.fill("虚构样本的独立命题。");
    await spaceClaim.fill("虚构样本的独立命题");
    await expect(evidenceStatus).toContainText("发现重复的艺术命题");
    await expect(total).toHaveText("—");
    await spaceClaim.fill("虚构样本的远近层次");
    await dialog.getByLabel("录音／空间的可听命题 · 曲目／版本／位置", { exact: true }).fill("测试曲 0:40");
    await relationClaim.fill("虚构样本的鼓与贝斯层次");
    await dialog.getByLabel("最终混音／声音关系的可听命题 · 曲目／版本／位置", { exact: true }).fill("测试曲 0:40");
    await expect(evidenceStatus).toContainText("两类声音证据已填写");
    await expect(total).toHaveText("4.51");
    await takeEvidence.click();
    const details = dialog.getByText("评级系数、计算公式与精确权重", { exact: true });
    await details.click();
    await expect(dialog.locator("#mumaka-r6-coefficients")).toHaveText(
      Object.entries(source.coefficient_by_grade).map(([grade, coefficient]) => `${grade} ${coefficient}`).join(" · "));
    await expect(dialog.locator("#mumaka-r6-key")).toContainText("歌词 87500/5659%");
    assert(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth));
    await details.click();

    await dialog.getByRole("radio", { name: "乐曲", exact: true }).check();
    await expect(style.locator("option")).toHaveCount(6);
    await expect(style).toHaveValue("");
    await verifyProfiles("instrumental", instrumental);
    await style.selectOption("candidate:progressive-rock|instrumental");
    await expect(dialog.getByRole("combobox", { name: "歌词星级" })).toHaveCount(0);
    await expect(total).toHaveText("—");
    await chooseStars(instrumental, [3, 5, 7, 9, 8, 6]);
    await expect(total).toHaveText("6.27");

    await dialog.getByRole("radio", { name: "歌曲", exact: true }).check();
    await expect(style).toHaveValue("candidate:progressive-rock|song");
    await expect(total).toHaveText("4.51");
    await style.selectOption("candidate:proto-punk|song");
    await expect(dialog).toContainText("原始朋克仅作历史索引，暂无试算配置。");
    await expect(total).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // The everyday draft opens with Sound, including before a profile is selected.
    await page.getByRole("button", { name: "快速评分", exact: true }).click();
    const studio = page.locator("#mumaka-r6-studio");
    const studioStyle = studio.getByLabel("R6 风格", { exact: true });
    const studioScore = studio.locator("#mumaka-r6-score");
    const studioAxes = studio.getByRole("rowheader");
    const legacy = studio.getByRole("button", { name: "旧版评分", exact: true });
    await expect(studioAxes).toHaveText(song);
    await expect(page.locator("#dual-ratings")).toBeHidden();
    await expect(page.locator("#dual-preview")).toBeHidden();
    await page.getByRole("link", { name: "评分", exact: true }).click();
    await expect(studio).toBeFocused();
    assert(await studio.evaluate((node) => node.scrollWidth <= node.clientWidth));
    await page.getByLabel("专辑名称", { exact: true }).fill("R6隔离测试（虚构）");
    await page.getByLabel("艺术家", { exact: true }).fill("技术测试");
    await page.getByLabel("二级风格", { exact: true }).selectOption("genre:dance-pop");
    await expect(studioStyle).toHaveValue("candidate:dance-pop|song");
    await legacy.click();

    // Keep the original Production flow available without migrating any ratings.
    const originalDimensions = ["歌词", "作曲", "表演", "制作", "愿景", "语境"];
    const originalTicks = file === "r2.html" ? [3, 5, 7, 9, 8, 6] : Array(6).fill(10);
    for (const [index, name] of originalDimensions.entries()) {
      const slider = page.getByRole("slider", { name: `${name}评分`, exact: true });
      await slider.press("End");
      for (let tick = 10; tick > originalTicks[index]; tick -= 1) await slider.press("ArrowLeft");
    }
    await expect(page.getByTestId("dual-total")).toHaveText(expected);
    await expect(page.locator(".dual-save")).toHaveAttribute("title", "已自动保存");
    const draftUrl = page.url();
    await page.reload();
    await expect(studioAxes).toHaveText(song);
    await expect(studioStyle).toHaveValue("candidate:dance-pop|song");
    await expect(studio.getByRole("combobox", { name: "声音星级", exact: true })).toHaveValue("0");
    await expect(studioScore).toHaveText("—");
    await trigger.click();
    await expect(studio).toBeFocused();
    await expect(dialog).toBeHidden();
    await chooseStars(song, [3, 5, 7, 9, 8, 6], studio);
    await expect(studioScore).toHaveText("6.44");
    await legacy.click();
    await expect(page.getByTestId("dual-total")).toHaveText(expected);

    if (file === "index.html") {
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "评分JSON", exact: true }).click();
      const exported = JSON.parse(await readFile(await (await pending).path(), "utf8"));
      assert.deepEqual(exported.calculation.weights.song, [38, 46, 32, 24, 30, 30]);
      assert.equal(exported.catalogSnapshot.sourceVersion, "v0.38.1");
    }

    await page.getByRole("button", { name: "保存评分版本", exact: true }).click();
    await expect(page.locator(".dual-save")).toHaveAttribute("title", /已保存冻结快照/);
    await page.goto(`${url}#/ratings`);
    await page.getByRole("button", { name: "查看冻结卡片", exact: true }).first().click();
    await expect(studio).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "制作评分", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("dual-total")).toHaveText(expected);
    await page.goto(draftUrl);
    await expect(studioAxes).toHaveText(song);
    await legacy.click();

    const genrePanel = page.locator("#dual-genres");
    const inline = genrePanel.getByRole("region", { name: "R6 研究评级与权重" });
    const inlineWeights = inline.getByRole("list", { name: "R6 各维评级与权重" });
    const legacyWeights = genrePanel.locator('[aria-label="当前六维权重"]');
    const genre = genrePanel.getByLabel("二级风格", { exact: true });
    const search = genrePanel.getByLabel("检索双体系风格");
    await genrePanel.getByLabel("一级风格", { exact: true }).selectOption("");
    await genre.selectOption("genre:alternative-rock");
    await expect(inline).toContainText("另类摇滚 · 歌曲 · 核心复核");
    await expect(inlineWeights.getByRole("listitem")).toHaveText([
      "歌词B 14.90%", "作曲A 17.44%", "表演A 17.44%", "声音S 20.23%", "愿景固定 15.00%", "语境固定 15.00%",
    ]);
    const beforeTrial = await legacyWeights.textContent();
    const scoreBeforeTrial = await page.getByTestId("dual-total").textContent();
    await inline.getByRole("button", { name: "用 R6 试算" }).click();
    await expect(studioStyle).toHaveValue("candidate:alternative-rock|song");
    await expect(studioScore).toHaveText("—");
    await expect(studio.getByRole("combobox", { name: "声音星级", exact: true })).toHaveValue("0");
    await chooseStars(song, [10, 10, 10, 10, 10, 10], studio);
    await expect(studioScore).toHaveText("10.00");
    await legacy.click();
    await expect(genre).toHaveValue("genre:alternative-rock");
    await expect(legacyWeights).toHaveText(beforeTrial);
    await expect(page.getByTestId("dual-total")).toHaveText(scoreBeforeTrial);

    await search.fill("国风流行");
    await expect(inline).toContainText("国风流行 · 歌曲 · 已修订 · 待批准");
    await expect(inlineWeights.getByRole("listitem")).toHaveText([
      "歌词A 16.83%", "作曲S 19.52%", "表演A 16.83%", "声音A 16.83%", "愿景固定 15.00%", "语境固定 15.00%",
    ]);
    await inline.getByRole("button", { name: "用 R6 试算" }).click();
    await expect(studioStyle).toHaveValue("candidate:chinese-style-pop|song");
    await search.fill("国风");
    await expect(genre.locator('option[value="genre:chinese-style-pop"]')).toHaveJSProperty("disabled", true);
    await expect(inline).toContainText("国风流行");
    await search.clear();
    await expect(inline).toContainText("另类摇滚");

    const workReview = studio.getByRole("checkbox", { name: "作品的歌曲／乐曲模式有实质争议" });
    await workReview.check();
    const categories = page.getByRole("group", { name: "作品类别", exact: true });
    await categories.getByRole("button", { name: "乐曲", exact: true }).click();
    await genre.selectOption("genre:alternative-rock");
    await expect(studioAxes).toHaveText(instrumental);
    await expect(studioStyle).toHaveValue("");
    await expect(inline).toContainText("当前乐曲暂无 R6 配置");
    await expect(inlineWeights).toBeHidden();
    await inline.getByRole("button", { name: "查看歌曲试算" }).click();
    await expect(style).toHaveValue("candidate:alternative-rock|song");
    await expect(dispute).toBeChecked();
    await expect(total).toHaveText("—");
    await expect(dialog.getByText(/needs_mode_review · 暂停出分/)).toBeVisible();
    await dispute.uncheck();
    await expect(total).toHaveText("10.00");
    await dispute.check();
    await page.keyboard.press("Escape");
    await expect(categories.getByRole("button", { name: "乐曲", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(studioAxes).toHaveText(instrumental);
    await categories.getByRole("button", { name: "歌曲", exact: true }).click();
    await expect(inlineWeights).toBeVisible();
    await expect(studioStyle).toHaveValue("candidate:chinese-style-pop|song");
    await expect(workReview).toBeChecked();
    await workReview.uncheck();
    await genrePanel.getByLabel("一级风格", { exact: true }).selectOption("");
    await genre.selectOption("genre:heavy-metal");
    await expect(inline).toContainText("当前风格暂无 R6 歌曲配置");
    await expect(inlineWeights).toBeHidden();
    await expect(studioStyle).toHaveValue("");
    await expect(studioAxes).toHaveText(song);
    await expect(studioScore).toBeHidden();

    await studioStyle.selectOption("candidate:alternative-rock|song");
    await expect(studioScore).toHaveText("10.00");
    await page.getByRole("button", { name: "添加评分草稿", exact: true }).click();
    await expect(page).not.toHaveURL(draftUrl);
    await expect(studioAxes).toHaveText(song);
    await studioStyle.selectOption("candidate:alternative-rock|song");
    await expect(studio.getByRole("combobox", { name: "声音星级", exact: true })).toHaveValue("0");
    await page.getByRole("tab", { name: "R6隔离测试（虚构）", exact: true }).click();
    await expect(page).toHaveURL(draftUrl);
    await expect(studioScore).toHaveText("10.00");

    await page.goto(`${url}#/genres`);
    const catalogSearch = page.getByLabel("搜索565风格");
    await catalogSearch.fill("另类摇滚");
    const catalogResults = page.locator(".dual-records");
    await expect(catalogResults).toContainText("核心复核");
    await expect(catalogResults).toContainText("14.90%");
    await catalogSearch.fill("genre:chinese-style-pop");
    const chinaStyle = catalogResults.locator("article");
    await expect(chinaStyle.getByRole("button", { name: "以此新建" })).toBeDisabled();
    await expect(chinaStyle).toContainText("19.52%");
    await catalogSearch.fill("国风流行");
    const researchMatch = page.getByRole("region", { name: "R6 研究评级与权重" });
    await expect(researchMatch).toContainText("国风流行 · 歌曲");
    await researchMatch.getByRole("button", { name: "用 R6 试算" }).click();
    await expect(style).toHaveValue("candidate:chinese-style-pop|song");

    assert.deepEqual(errors, []);
    console.log(`PASS ${targetUrl ?? file} ${width}×${height} · Sound in the everyday workspace, 38 profiles, linked mode review, preserved legacy ratings and frozen history`);
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(done => serving.close(done));
}
