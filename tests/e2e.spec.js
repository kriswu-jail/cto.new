// Playwright e2e: 关键用户路径（上传 -> 进度 -> 结果 -> FAQ）
const path = require('path');
const { test, expect } = require('@playwright/test');

const fileUrl = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

async function createVirtualFile(name, mimeType, content){
  return {
    name,
    mimeType,
    buffer: Buffer.from(content, 'utf-8')
  };
}

test('中文界面加载与基础元素', async ({ page }) => {
  await page.goto(fileUrl);
  await expect(page.getByRole('heading', { name: /多任务文件处理器/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'FAQ' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始处理' })).toBeVisible();
});

test('上传 -> 进度 -> 结果', async ({ page }) => {
  await page.goto(fileUrl);

  // 设置参数
  await page.locator('#type-select').selectOption('compress');
  await page.locator('#quality').fill('75');

  // 准备两个虚拟文件
  const f1 = await createVirtualFile('a.txt', 'text/plain', 'hello world');
  const f2 = await createVirtualFile('b.txt', 'text/plain', 'foo bar');

  // 选择文件
  await page.locator('#file-input').setInputFiles([f1, f2]);
  await page.getByRole('button', { name: '开始处理' }).click();

  // 等待进度出现
  const bars = page.locator('[role="progressbar"]');
  await expect(bars.first()).toBeVisible();

  // 等待至少一个完成并出现下载
  await expect(page.getByRole('link', { name: /下载结果/ }).first()).toBeVisible({ timeout: 30000 });

  // FAQ 可见
  await page.getByRole('link', { name: 'FAQ' }).click();
  await expect(page.locator('#faq')).toBeVisible();
});
