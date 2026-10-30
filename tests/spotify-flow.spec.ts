import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createSpotifyHandler } from "../server/spotify";

// Real browser -> real Node handler -> explicit technical upstream fixtures.
// These are not live Spotify account tests or real album reviews.
const releases = [
  {
    id: "A".repeat(22),
    q: "原创联调",
    title: "原创专辑端到端夹具",
    type: "album",
  },
  {
    id: "B".repeat(22),
    q: "翻唱联调",
    title: "翻唱专辑端到端夹具",
    type: "album",
  },
  {
    id: "C".repeat(22),
    q: "多风格联调",
    title: "多风格EP端到端夹具",
    type: "single",
  },
];
const upstreamAlbum = (release: (typeof releases)[number]) => ({
  id: release.id,
  name: release.title,
  album_type: release.type,
  artists: [{ name: "联调测试音乐人" }],
  release_date: "2026-10-30",
  images: [{ url: "https://i.scdn.co/image/mumaka-flow-fixture" }],
  external_urls: { spotify: `https://open.spotify.com/album/${release.id}` },
  total_tracks: 2,
  tracks: {
    items: [1, 2].map((n) => ({
      id: String(n).repeat(22),
      name: `测试曲目${n}`,
      artists: [{ name: "联调测试音乐人" }],
      duration_ms: 180_000 + n * 1000,
      disc_number: 1,
      track_number: n,
    })),
    next: null,
  },
});
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const handler = createSpotifyHandler({
    env: {
      SPOTIFY_CLIENT_ID: "fixture-id",
      SPOTIFY_CLIENT_SECRET: "fixture-secret-not-real",
    },
    fetch: (async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "accounts.spotify.com")
        return Response.json({
          access_token: "fixture-token-not-real",
          expires_in: 3600,
        });
      if (url.pathname === "/v1/search") {
        const release = releases.find((r) => r.q === url.searchParams.get("q"));
        return Response.json({
          albums: { items: release ? [upstreamAlbum(release)] : [] },
        });
      }
      const release = releases.find(
        (r) => url.pathname === `/v1/albums/${r.id}`,
      );
      return release
        ? Response.json(upstreamAlbum(release))
        : new Response("", { status: 404 });
    }) as typeof fetch,
  });
  const root = resolve("dist");
  server = createServer(async (req, res) => {
    if (
      new URL(req.url || "/", "http://localhost").pathname === "/api/spotify"
    ) {
      await handler(req, res);
      return;
    }
    try {
      const path = resolve(
        root,
        "." +
          (new URL(req.url || "/", "http://localhost").pathname === "/"
            ? "/index.html"
            : new URL(req.url || "/", "http://localhost").pathname),
      );
      if (!path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(path);
      res.setHeader(
        "Content-Type",
        path.endsWith(".js")
          ? "application/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
async function mainGenre(page: Page) {
  await page
    .getByRole("button", { name: "直接搜索细分风格", exact: true })
    .click();
  await page.getByLabel("专辑风格搜索全部风格").fill("Pop (General)");
  await page.locator(".global-choice .choice-options button").first().click();
}
for (const release of releases)
  test(`真实代理贯通（Spotify上游为夹具）：${release.q}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const png = await readFile("tests/fixtures/cover.png");
    await page.route("https://i.scdn.co/image/mumaka-flow-fixture", (route) =>
      route.fulfill({
        body: png,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
    );
    await page.goto(origin);
    await page.getByLabel("搜索专辑或音乐人").fill(release.q);
    await page.locator(".album-result").click();
    await expect(page.getByLabel("专辑名称", { exact: true })).toHaveValue(
      release.title,
    );
    await expect(page.getByLabel("发行年份", { exact: true })).toHaveValue(
      "2026",
    );
    if (release.type === "single") {
      await expect(page.getByLabel("作品类型")).not.toHaveValue("EP");
      await page.getByLabel("作品类型").selectOption("EP");
      await page.getByRole("button", { name: "多种风格", exact: true }).click();
      for (const [n, family, genre] of [
        [1, "流行", "Pop (General)"],
        [2, "摇滚", "Folk Rock"],
      ] as const) {
        await page
          .getByRole("button", { name: `曲目 ${n} 风格一级风格`, exact: true })
          .click();
        await page
          .locator(".choice-popover .choice-options button")
          .getByText(family, { exact: true })
          .click();
        await page.getByLabel(`曲目 ${n} 风格搜索二级风格`).fill(genre);
        await page
          .locator(".choice-popover .choice-options button")
          .first()
          .click();
      }
    } else await mainGenre(page);
    await page
      .getByLabel("歌曲主要来源")
      .selectOption(release.q === "翻唱联调" ? "cover" : "new");
    if (release.q === "翻唱联调") {
      await page
        .getByLabel("来源侧重方式")
        .selectOption("existing_dominant_standard");
      await page.getByLabel("来源是否重复计算").selectOption("clear");
    }
    await page
      .getByRole("button", { name: "下一步：评分", exact: true })
      .click();
    for (const name of ["作词", "作曲", "表演", "声音", "愿景", "语境"]) {
      const star = page
        .getByRole("slider", { name: `${name}评分`, exact: true })
        .locator("button")
        .nth(3);
      const box = (await star.boundingBox())!;
      await star.click({
        position: { x: box.width * 0.75, y: box.height / 2 },
      });
    }
    await page.getByRole("button", { name: "生成评分卡", exact: true }).click();
    await expect(page.locator("#score-card-svg")).toContainText("8.00");
    await expect(page.locator("#score-card-svg image")).toHaveAttribute(
      "href",
      /^data:image\/png/,
    );
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PNG", exact: true }).click();
    const output = await readFile((await (await event).path())!);
    expect(output.readUInt32BE(16)).toBe(1080);
    expect(output.readUInt32BE(20)).toBe(1350);
    await page.reload();
    await expect(page.locator("#score-card-svg")).toContainText("8.00");
    await page
      .getByRole("button", { name: "MUMAKA / 木马卡，返回首页", exact: true })
      .click();
    await expect(page.locator(".recent-album")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
