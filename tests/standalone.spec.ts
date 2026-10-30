import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('实际单文件在模拟 Pages HTTPS origin 运行，未配置 Python 时仍能评分及导出',async({page})=>{
  const output=join(tmpdir(),'mumaka-standalone-smoke.html');
  execFileSync('node',['scripts/build-standalone.mjs',output],{cwd:process.cwd()});
  const html=await readFile(output,'utf8');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // The route is a local HTTPS hosting simulation, not a claim about live Pages.
  await page.route('https://xuedinge926-bit.github.io/**',route=>new URL(route.request().url()).pathname==='/mumaka/'
    ? route.fulfill({body:html,contentType:'text/html'}) : route.fulfill({status:404,body:'Not configured'}));
  await page.goto('https://xuedinge926-bit.github.io/mumaka/');
  await expect(page).toHaveTitle('MUMAKA / 木马卡 · 新乐评主义');
  await page.getByRole('button',{name:'通过链接添加',exact:true}).click();
  await expect(page.getByRole('button',{name:'获取信息',exact:true})).toBeDisabled();
  await expect(page.getByText('在线版不会连接你电脑上的服务。',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'改为手动添加',exact:true}).click();
  await page.getByLabel('专辑名称',{exact:true}).fill('静态部署技术验证（样本）');await page.getByLabel('音乐人',{exact:true}).fill('测试者');
  await page.getByRole('button',{name:'直接搜索细分风格',exact:true}).click();await page.getByLabel('专辑风格搜索全部风格').fill('Pop (General)');await page.locator('.global-choice .choice-options button').first().click();
  await page.getByRole('button',{name:'下一步：评分',exact:true}).click();
  for(const label of ['作词','作曲','表演','声音','愿景','语境']){const slider=page.getByRole('slider',{name:`${label}评分`,exact:true});await slider.focus();await slider.press('End');}
  await page.getByRole('button',{name:'生成评分卡',exact:true}).click();await expect(page.locator('#score-card-svg')).toContainText('10.00');
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'下载 PNG',exact:true}).click();const bytes=await readFile((await(await event).path())!);expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBe(1350);
  expect(errors).toEqual([]);
});
