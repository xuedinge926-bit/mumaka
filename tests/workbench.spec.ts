import { test, expect } from '@playwright/test';
import { newAlbum, DIMENSIONS, LABELS } from '../src/model/types';
import { readFile } from 'node:fs/promises';

test('预览环境缺少 randomUUID 和 subtle 时仍可编辑、创建曲目与保存快照', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true });
    Object.defineProperty(Crypto.prototype, 'subtle', { value: undefined, configurable: true });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('专辑 / EP 名称', { exact: true }).fill('预览兼容性技术验收');
  await page.getByRole('tab', { name: /曲目与来源/ }).click();
  await page.getByRole('button', { name: '添加曲目', exact: true }).click();
  await page.getByLabel('曲目 1 名称', { exact: true }).fill('兼容性技术曲目');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('tab', { name: /审核与版本/ }).click();
  await page.getByRole('button', { name: '保存版本快照', exact: true }).click();
  await expect(page.locator('.version-row')).toHaveCount(1);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.locator('.album-list-item')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.album-list-item')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('空作品库 → 人工评分 → 保存版本 → 刷新与离线 → 备份恢复 → 图片导出', async ({ page, context, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('让一张唱片，成为开始')).toBeVisible();
  await page.getByLabel('专辑 / EP 名称', { exact: true }).fill('技术验收虚构唱片');
  await page.getByLabel('音乐人 / 乐队', { exact: true }).fill('技术验收虚构音乐人');
  await page.getByRole('tab', { name: /风格与权重/ }).click();
  await page.getByRole('button', { name: '流行（一般） Pop (General)', exact: true }).click();
  await page.getByRole('tab', { name: /六维评价/ }).click();
  for (const dimension of DIMENSIONS) await page.getByRole('button', { name: `${LABELS[dimension]} 4 星`, exact: true }).click();
  await expect(page.locator('.preview-score strong')).toContainText('8.00');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('tab', { name: /审核与版本/ }).click();
  await page.getByRole('button', { name: '保存版本快照', exact: true }).click();
  await expect(page.locator('.version-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /人工批准发布/ })).toBeDisabled();
  await page.reload();
  await page.locator('.album-list-item', { hasText: '技术验收虚构唱片' }).click();
  await expect(page.getByLabel('专辑 / EP 名称', { exact: true })).toHaveValue('技术验收虚构唱片');
  await expect(page.locator('.preview-score strong')).toContainText('8.00');

  // The production shell, frozen data and local records all remain available offline.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.album-list-item', { hasText: '技术验收虚构唱片' }).click();
  await expect(page.locator('.preview-score strong')).toContainText('8.00');
  await context.setOffline(false);

  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全量备份', exact: true }).click();
  const backup = await backupDownload;
  const data = await readFile((await backup.path())!, 'utf8');
  const parsed = JSON.parse(data);
  expect(parsed.albums).toHaveLength(1);
  expect(parsed.snapshots).toHaveLength(1);
  expect(parsed.snapshots[0].calculation.total).toBe('8.00');

  await page.getByRole('button', { name: '预览与导出评分卡', exact: true }).click();
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG', exact: true }).click();
  const svg = await svgDownload;
  expect(await readFile((await svg.path())!, 'utf8')).toContain('技术验收虚构唱片');
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const png = await pngDownload;
  expect((await readFile((await png.path())!)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  await page.getByRole('button', { name: '关闭评分卡预览', exact: true }).click();

  const restoredContext = await browser.newContext();
  const restored = await restoredContext.newPage();
  await restored.goto('/');
  await restored.locator('input[type=file]').first().setInputFiles({ name: 'nmc-backup.json', mimeType: 'application/json', buffer: Buffer.from(data) });
  await restored.locator('.album-list-item', { hasText: '技术验收虚构唱片' }).click();
  await expect(restored.locator('.preview-score strong')).toContainText('8.00');
  await restored.getByRole('tab', { name: /审核与版本/ }).click();
  await expect(restored.locator('.version-row')).toHaveCount(1);
  await restoredContext.close();
  expect(errors).toEqual([]);
});

test('补齐人工证据才允许发表；已发表不可改写，新评价保留原快照', async ({ page, browser }) => {
  const album = newAlbum();
  Object.assign(album, {
    title: '发表门禁技术验收（虚构）', artist: '测试而非真实乐评', year: '2026', release: '技术测试版',
    genreId: 'genre:pop-general', chinaEntryId: 'cn-index:pop-general',
    genreEvidence: '技术用例：全碟以常规流行歌曲旋律与段落结构组织，不代表真实听评。', genreExclusions: '技术字段：无其他风格主体，不代表真实分类。',
    cultureNote: '技术用例：中文语境定性理解，没有数值文化加分。',
    sourceReviewed: true, noDoubleCount: true, fullListenConfirmed: true, releaseIdentityVerified: true, reviewer: '测试责任人',
    tracks: [{ id: 'test-track', title: '虚构测试曲目', duration: 180, genreId: 'genre:pop-general', lyricsSource: '技术测试新词署名', compositionSource: '技术测试新曲署名', sourceEvidence: '此为技术结构测试，无真实发行依据。' }],
  });
  for (const d of DIMENSIONS) Object.assign(album.ratings[d], { value: 4, evidence: '技术用例曲目段落', rationale: '独立维度理由的技术字段', counterEvidence: '技术用例反证字段' });
  const backup = { format: 'nmc-library', schemaVersion: 1, exportedAt: new Date().toISOString(), albums: [album], snapshots: [] };
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.locator('.album-list-item').filter({ has: page.locator('strong', { hasText: new RegExp(`^${album.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click();
  await page.getByRole('tab', { name: /审核与版本/ }).click();
  const approve = page.getByRole('button', { name: /人工批准发布/ });
  await expect(approve).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await approve.click();
  await expect(page.locator('.readonly-banner')).toBeVisible();
  await expect(page.locator('.version-row')).toHaveCount(1);
  await page.getByRole('tab', { name: /作品信息/ }).click();
  await expect(page.getByLabel('专辑 / EP 名称', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /复制/, exact: true }).click();
  await expect(page.getByLabel('专辑 / EP 名称', { exact: true })).toBeEnabled();
  await page.getByLabel('专辑 / EP 名称', { exact: true }).fill('新评价技术验收');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('button', { name: `${album.title} ${album.artist} 已人工批准发布 ${album.year}`, exact: true }).click();
  await expect(page.getByLabel('专辑 / EP 名称', { exact: true })).toHaveValue(album.title);
  await expect(page.locator('.preview-score strong')).toContainText('8.00');

  // A synthetic legacy-model snapshot intentionally differs from today's formula.
  // Restoration must display its archived result, never silently recalculate it.
  const backupEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全量备份', exact: true }).click();
  const archive = JSON.parse(await readFile((await (await backupEvent).path())!, 'utf8'));
  archive.albums = archive.albums.filter((a: { id: string }) => a.id === album.id);
  archive.snapshots[0].calculation.total = '6.66';
  archive.snapshots[0].calculation.exactTotal = '333/50';
  archive.snapshots[0].provenance.modelVersion = 'V0.17-technical-history';
  const legacyContext = await browser.newContext();
  const legacy = await legacyContext.newPage();
  await legacy.goto('/');
  await legacy.locator('input[type=file]').first().setInputFiles({ name: 'synthetic-legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
  await legacy.locator('.album-list-item').click();
  await expect(legacy.locator('.preview-score strong')).toContainText('6.66');
  await legacy.reload();
  await legacy.locator('.album-list-item').click();
  await expect(legacy.locator('.preview-score strong')).toContainText('6.66');
  await legacy.getByRole('button', { name: '预览与导出评分卡', exact: true }).click();
  await expect(legacy.locator('#score-card-svg')).toContainText('V0.17-technical-history');
  await legacyContext.close();
});

test('手机布局可操作且无水平溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('专辑 / EP 名称', { exact: true }).fill('手机端技术测试');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: /六维评价/ }).click();
  await page.getByRole('button', { name: '作词 3.5 星', exact: true }).click();
  await page.getByRole('button', { name: '打开作品库', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建专辑评价', exact: true })).toBeVisible();
});
