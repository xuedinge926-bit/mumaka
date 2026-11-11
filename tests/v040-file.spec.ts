import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("published file keeps V0.40 legacy storage, six dimensions and PNG through the legacy view", async ({
  page,
}) => {
  const output = join(tmpdir(), "mumaka-v040-file-test.html");
  execFileSync("node", ["scripts/build-standalone.mjs", output]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(output).href);
  await page.getByRole("button", { name: "快速评分", exact: true }).click();
  await page
    .getByLabel("专辑名称", { exact: true })
    .fill("直接打开单文件（技术测试）");
  await page.getByLabel("艺术家", { exact: true }).fill("测试员");
  await page
    .getByLabel("二级风格", { exact: true })
    .selectOption("genre:dance-pop");
  await page.getByRole("button", { name: "旧版评分", exact: true }).click();
  for (const label of ["歌词", "作曲", "表演", "制作", "愿景", "语境"]) {
    const slider = page.getByRole("slider", {
      name: `${label}评分`,
      exact: true,
    });
    await slider.focus();
    await slider.press("End");
  }
  await expect(page.getByTestId("dual-total")).toHaveText("10.00");
  await expect(page.locator(".dual-save")).toHaveAttribute("title", "已自动保存");
  await page.reload();
  await page.getByRole("button", { name: "旧版评分", exact: true }).click();
  await expect(page.getByTestId("dual-total")).toHaveText("10.00");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  const png = await readFile((await (await event).path())!);
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1350);
  await page.screenshot({ path: "test-results/v040-file.png", fullPage: true });
  expect(errors).toEqual([]);
});
