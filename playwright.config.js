// @ts-check
/**
 * @see https://playwright.dev/docs/test-configuration
 */
const config = {
  testDir: './tests',
  // 使用 file:// 直接打开静态页面，无需本地服务
  use: {
    headless: true,
    locale: 'zh-CN'
  },
  timeout: 60000,
  reporter: [['list']]
};

module.exports = config;
