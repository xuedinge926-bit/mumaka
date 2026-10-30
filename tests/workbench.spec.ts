import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DIMENSIONS, LABELS, newAlbum, type Album } from '../src/model/types';
const provenance = JSON.parse(readFileSync(new URL('../src/data/provenance.json', import.meta.url), 'utf8'));
const PNG = readFileSync(new URL('./fixtures/cover.png', import.meta.url));
async function chooseGenre(page: Page, query = 'Pop (General)') {
  await page.getByRole('button', { name: '直接搜索细分风格', exact: true }).click();
  await page.getByLabel('专辑风格搜索全部风格').fill(query);
  await page.locator('.global-choice .choice-options button').first().click();
}
async function manual(page: Page, title = '界面流程测试唱片（虚构）') {
  await page.goto('/');
  await page.getByRole('button', { name: '手动添加专辑', exact: true }).click();
  await page.getByLabel('专辑名称', { exact: true }).fill(title);
  await page.getByLabel('音乐人', { exact: true }).fill('测试音乐人');
  await page.getByLabel('发行年份', { exact: true }).fill('2026');
  await chooseGenre(page);
  await page.getByLabel('歌曲主要来源').selectOption('new');
}
async function stars(page: Page, label: string, value: number) {
  const slider = page.getByRole('slider', { name: `${label}评分`, exact: true });
  await expect(slider.locator('button')).toHaveCount(5);
  const star = slider.locator('button').nth(Math.ceil(value) - 1);
  const bounds = (await star.boundingBox())!;
  await star.click({ position: { x: bounds.width * (Number.isInteger(value) ? .75 : .25), y: bounds.height / 2 } });
  await expect(slider).toHaveAttribute('aria-valuenow', String(value));
}
async function rateFour(page: Page) {
  for (const d of DIMENSIONS) await stars(page, LABELS[d], 4);
}
async function backup(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部备份', exact: true }).click();
  const data = await readFile((await (await event).path())!, 'utf8');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  return data;
}
async function restore(page: Page, data: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(data) });
  await expect(page.getByRole('status')).toContainText('已导入');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
}

test('极简首页 → 手动评分零理由 → 三种比例真实PNG → 保存刷新与备份恢复', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('搜索专辑或音乐人')).toBeVisible();
  await expect(page.getByText('Spotify 搜索未配置')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(/SHA|L1|半入|模型|558|审核|权重|听评/);
  await page.screenshot({ path: '/tmp/nmc-ux-home.png', fullPage: true });
  await manual(page);
  await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: '下一步：评分', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveCount(6);
  await expect(page.locator('textarea')).toHaveCount(0);
  await stars(page, '作词', 3.5);
  await stars(page, '作词', 4);
  for (const d of DIMENSIONS.slice(1)) await stars(page, LABELS[d], 4);
  await page.getByRole('button', { name: '生成评分卡', exact: true }).click();
  await expect(page.locator('#score-card-svg')).toHaveAttribute('viewBox', '0 0 1080 1350');
  await expect(page.locator('#score-card-svg')).toContainText('8.00');
  await expect(page.locator('#score-card-svg image')).toHaveCount(1);
  await page.locator('#score-card-svg').screenshot({ path: '/tmp/nmc-ux-card.png' });
  const review = '听'.repeat(199) + '终';
  await page.getByLabel('专辑短评').fill(review);
  await expect(page.locator('#score-card-svg [aria-label="专辑短评"]')).toContainText('终');
  const lastTextInside = await page.locator('#score-card-svg').evaluate(svg => {
    const height = Number(svg.getAttribute('height'));
    return Array.from(svg.querySelectorAll('text')).every(t => t.getBBox().y + t.getBBox().height < height);
  });
  expect(lastTextInside).toBe(true);
  for (const [ratio, height] of [['4:5', 1350], ['3:4', 1440], ['1:1', 1080]] as const) {
    await page.getByRole('button', { name: ratio, exact: true }).click();
    await expect(page.locator('#score-card-svg')).toHaveAttribute('viewBox', `0 0 1080 ${height}`);
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 PNG', exact: true }).click();
    const bytes = await readFile((await (await event).path())!);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(height);
  }
  await page.getByRole('textbox', { name: '专辑短评', exact: true }).fill('听\n'.repeat(99) + '终');
  expect(await page.locator('#score-card-svg').evaluate(svg => {
    const height = Number(svg.getAttribute('height'));
    return Array.from(svg.querySelectorAll('text')).every(t => t.getBBox().y + t.getBBox().height < height);
  })).toBe(true);
  await page.getByRole('textbox', { name: '专辑短评', exact: true }).fill(review);
  const data = await backup(page);
  const saved = JSON.parse(data);
  expect(saved.albums[0].ratings.lyrics.evidence).toBe('');
  expect(saved.snapshots[0].calculation.publishEligible).toBe(false);
  await page.reload();
  await page.locator('.recent-album').click();
  await expect(page.getByLabel('专辑名称')).toHaveValue('界面流程测试唱片（虚构）');
  const fresh = await browser.newContext();
  const restored = await fresh.newPage();
  await restore(restored, data);
  await restored.locator('.recent-album').click();
  await restored.getByRole('button', { name: '下一步：评分', exact: true }).click();
  await restored.getByRole('button', { name: '生成评分卡', exact: true }).click();
  await expect(restored.locator('#score-card-svg')).toContainText('8.00');
  await expect(restored.getByRole('textbox', { name: '专辑短评', exact: true })).toHaveValue(review);
  await fresh.close();
  expect(errors).toEqual([]);
});

test('统一一级二级过滤、全局定位与中国排序切换均保留评分', async ({ page }) => {
  await manual(page);
  await page.getByRole('button', { name: '专辑风格一级风格', exact: true }).click();
  await page.getByLabel('专辑风格搜索一级风格').fill('摇滚');
  await page.locator('.choice-popover .choice-options button').getByText('摇滚', { exact: true }).click();
  await page.getByLabel('专辑风格搜索二级风格').fill('Folk Rock');
  await page.locator('.choice-popover .choice-options button').first().click();
  await expect(page.getByRole('button', { name: '专辑风格一级风格', exact: true })).toContainText('摇滚');
  await chooseGenre(page, 'Synth-Pop');
  await expect(page.getByRole('button', { name: '专辑风格一级风格', exact: true })).toContainText('流行');
  await page.getByRole('button', { name: '其他地区', exact: true }).click();
  await expect(page.getByRole('button', { name: '专辑风格二级风格', exact: true })).toContainText('合成器流行');
  await page.getByRole('button', { name: '下一步：评分', exact: true }).click();
  await rateFour(page);
  await page.getByRole('button', { name: '生成评分卡', exact: true }).click();
  await expect(page.locator('#score-card-svg')).toContainText('8.00');
});

test('移动端五颗星半星触摸与键盘，N/A和未评分严格区分', async ({ browser }) => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await mobile.newPage();
  await manual(page, '器乐技术测试（虚构）');
  await chooseGenre(page, 'Post-Rock');
  await page.getByRole('button', { name: '下一步：评分', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '生成评分卡', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '作词更多选项', exact: true }).click();
  await page.getByRole('button', { name: '纯器乐 · 作词不适用', exact: true }).click();
  await page.getByRole('button', { name: '确认不适用', exact: true }).click();
  for (const d of DIMENSIONS.slice(1)) await stars(page, LABELS[d], 4);
  const touchStar = page.getByRole('slider', { name: '声音评分', exact: true }).locator('button').nth(3);
  const hit = (await touchStar.boundingBox())!;
  await touchStar.tap({ position: { x: hit.width * .25, y: hit.height / 2 } });
  await expect(page.getByRole('slider', { name: '声音评分', exact: true })).toHaveAttribute('aria-valuenow', '3.5');
  await touchStar.tap({ position: { x: hit.width * .75, y: hit.height / 2 } });
  const performance = page.getByRole('slider', { name: '表演评分', exact: true });
  await performance.focus();
  await performance.press('End');
  await performance.press('ArrowLeft');
  await page.screenshot({ path: '/tmp/nmc-ux-mobile.png', fullPage: true });
  await expect(performance).toHaveAttribute('aria-valuenow', '4.5');
  await performance.press('ArrowLeft');
  await page.getByRole('button', { name: '生成评分卡', exact: true }).click();
  await expect(page.locator('#score-card-svg')).toContainText('8.00');
  await expect(page.locator('#score-card-svg')).toContainText('N/A');
  await mobile.close();
});

test('Spotify接口测试夹具填入曲目与远程封面，不伪造风格或EP', async ({ page }) => {
  const id = 'ABCDEFGHIJKLMNOPQRSTUV';
  const item = { id, title: '接口技术测试唱片（夹具）', artist: '接口测试音乐人', year: '2026', releaseDate: '2026-10-30', releaseType: 'single', release: 'Single / 发行形式待确认', coverUrl: 'https://i.scdn.co/image/nmc-ux-test', url: `https://open.spotify.com/album/${id}` };
  await page.route('**/api/spotify?**', route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    const data = action === 'status' ? { configured: true } : action === 'search' ? [item] : { ...item, totalTracks: 2, label: '测试厂牌', tracks: [{ id: 't1', title: '接口测试一', artist: item.artist, duration: 180, discNumber: 1, trackNumber: 1 }, { id: 't2', title: '接口测试二', artist: item.artist, duration: 240, discNumber: 1, trackNumber: 2 }] };
    return route.fulfill({ json: { data } });
  });
  await page.route(item.coverUrl, route => route.fulfill({ body: PNG, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('/');
  await page.getByLabel('搜索专辑或音乐人').fill('接口技术测试');
  await page.locator('.album-result').click();
  await expect(page.getByLabel('专辑名称')).toHaveValue(item.title);
  await expect(page.getByLabel('作品类型')).not.toHaveValue('EP');
  await expect(page.getByRole('button', { name: '专辑风格二级风格', exact: true })).toContainText('选择细分风格');
  await page.getByText('查看曲目（2 首）', { exact: true }).click();
  await expect(page.getByLabel('曲目 1 名称')).toHaveValue('接口测试一');
  await chooseGenre(page);
  await page.getByLabel('歌曲主要来源').selectOption('new');
  await page.getByRole('button', { name: '下一步：评分', exact: true }).click();
  await rateFour(page);
  await page.getByRole('button', { name: '生成评分卡', exact: true }).click();
  await expect(page.locator('#score-card-svg image')).toHaveAttribute('href', /^data:image\/png;base64,/);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG', exact: true }).click();
  const image = await readFile((await (await event).path())!);
  expect(image.readUInt32BE(16)).toBe(1080);
  const coverCenter = await page.locator('#score-card-svg image').evaluate(el => ({
    x: Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2,
    y: Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2,
  }));
  const pixel = await page.evaluate(async ({ encoded, center }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${encoded}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(Math.floor(center.x), Math.floor(center.y), 1, 1).data);
  }, { encoded: image.toString('base64'), center: coverCenter });
  expect(pixel).toEqual([167, 72, 57, 255]);
});

test('旧版已发表记录读取冻结分数，复制修改不覆盖历史，离线仍能打开', async ({ page, context }) => {
  const album = newAlbum();
  Object.assign(album, { title: '历史技术验收唱片', artist: '历史测试者', genreId: 'genre:pop-general', status: 'published', reviewer: '旧审核人' });
  for (const d of DIMENSIONS) album.ratings[d].value = 4;
  album.ratings.lyrics.evidence = '旧证据必须保留';
  const result = { total: '6.66', exactTotal: '333/50', valid: true, complete: true, publishEligible: true, baseWeights: ['21','23','14','12','15','15'], finalWeights: ['21','23','14','12','15','15'], errors: [], warnings: [], eligibilityIssues: [] };
  const snap = { id: 'legacy-snapshot', albumId: album.id, createdAt: album.updatedAt, reviewer: '旧审核人', album, calculation: result, kind: 'published', provenance: { ...provenance, modelVersion: 'V0.17-technical-legacy', dataHashes: { genres: 'a'.repeat(64), chinaIndex: 'b'.repeat(64) }, approval: { approvedBy: '旧审核人', approvedAt: album.updatedAt, action: 'explicit_manual_publication' } } };
  const data = JSON.stringify({ format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums: [album], snapshots: [snap] });
  await restore(page, data);
  await page.locator('.recent-album').click();
  await expect(page.locator('#score-card-svg')).toContainText('6.66');
  await page.getByRole('button', { name: '复制为新评分，继续修改', exact: true }).click();
  await page.getByLabel('专辑名称').fill('新副本');
  await page.getByRole('button', { name: 'MUMAKA / 木马卡，返回首页', exact: true }).click();
  await expect(page.locator('.recent-album')).toHaveCount(2);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.recent-album', { hasText: '历史技术验收唱片' }).click();
  await expect(page.locator('#score-card-svg')).toContainText('6.66');
});

// Synthetic release helper for multi-style transport: never added to the user's library.
function blendAlbum(): Album {
  const album = newAlbum();
  Object.assign(album, { title: '跨家族技术测试EP', artist: '测试者', kind: 'EP', blendMode: 'equal', ux: { market: 'china', sourceKind: 'new' }, tracks: [{ id: 'one', title: '第一首', duration: 180, genreId: '', lyricsSource: '', compositionSource: '', sourceEvidence: '' }, { id: 'two', title: '第二首', duration: 240, genreId: '', lyricsSource: '', compositionSource: '', sourceEvidence: '' }] });
  return album;
}
test('多风格EP逐曲与批量分配，只评整碟六维且不要求理由', async ({ page }) => {
  const album = blendAlbum();
  await restore(page, JSON.stringify({ format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums: [album], snapshots: [] }));
  await page.locator('.recent-album').click();
  await page.getByRole('button', { name: '批量指定风格', exact: true }).click();
  await page.getByLabel('全选曲目', { exact: true }).check();
  await page.getByRole('button', { name: '批量曲目风格一级风格', exact: true }).click();
  await page.locator('.choice-popover .choice-options button').getByText('流行', { exact: true }).click();
  await page.getByLabel('批量曲目风格搜索二级风格').fill('Pop (General)');
  await page.locator('.choice-popover .choice-options button').first().click();
  await page.getByRole('button', { name: '应用到 2 首', exact: true }).click();
  await page.getByRole('button', { name: '曲目 2 风格一级风格', exact: true }).click();
  await page.locator('.choice-popover .choice-options button').getByText('摇滚', { exact: true }).click();
  await page.getByLabel('曲目 2 风格搜索二级风格').fill('Folk Rock');
  await page.locator('.choice-popover .choice-options button').first().click();
  await page.getByRole('button', { name: '下一步：评分', exact: true }).click();
  await rateFour(page);
  await page.getByRole('button', { name: '生成评分卡', exact: true }).click();
  await expect(page.locator('#score-card-svg')).toContainText('8.00');
});
