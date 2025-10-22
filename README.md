# 支付与配额体系（微信支付 V3 + 支付宝）

该项目实现了匿名用户升级到付费套餐的全流程，包括额度管理、订单模型、支付通道接入、支付回调验签、幂等处理、对账与补单、前端支付体验以及沙箱配置与安全注意事项。

## 功能总览

- **额度管理**：匿名用户自动领取免费额度，可通过付费套餐提升请求次数、并发限制及单文件大小限制。
- **支付通道**：支持微信支付 V3 Native 扫码（默认）、微信 JSAPI（预留 OpenID）、支付宝电脑网站与当面付扫码。
- **订单与回调**：订单持久化、签名验签、AES-GCM 解密（微信）、回调幂等处理、失败重试、对账及补单。
- **额度变更**：支付成功后自动增加额度、记录使用事件，可绑定设备指纹或发放访问令牌。
- **前端体验**：支付页（套餐选择 + 支付方式 + 二维码/表单展示）、支付结果页（状态轮询、失败重试、客服入口）。
- **安全与沙箱**：Webhook 速率限制、签名校验、密钥管理建议、沙箱开关与模拟返回。

## 快速开始

```bash
npm install
npm run dev
```

默认监听 `http://localhost:3000`，支付页访问 `http://localhost:3000/payments/payment.html`。

### 生产前准备

1. **配置环境变量**（见下文）。
2. 将微信/支付宝平台证书与私钥安全存储到 `certs/` 目录或自定义路径。
3. 在微信/支付宝商户后台配置回调地址。
4. 将 `PAYMENT_SANDBOX` 设为 `false` 以启用正式接口。

## 环境变量

在项目根目录创建 `.env`（已在 `.gitignore` 中忽略）：

```env
PORT=3000
DATABASE_PATH=storage/app.db
PAYMENT_SANDBOX=true
WEBHOOK_RATE_LIMIT_PER_MINUTE=120

WECHAT_APP_ID=
WECHAT_MCH_ID=
WECHAT_API_V3_KEY=
WECHAT_SERIAL_NO=
WECHAT_PRIVATE_KEY_PATH=certs/wechat/apiclient_key.pem
WECHAT_PLATFORM_CERT_DIR=certs/wechat/platform
WECHAT_NOTIFY_URL=https://example.com/api/payments/wechat/native/notify
WECHAT_JSAPI_NOTIFY_URL=https://example.com/api/payments/wechat/jsapi/notify

ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY_PATH=certs/alipay/private_key.pem
ALIPAY_PUBLIC_KEY_PATH=certs/alipay/alipay_public_key.pem
ALIPAY_NOTIFY_URL=https://example.com/api/payments/alipay/pc/notify
ALIPAY_RETURN_URL=https://example.com/payments/result.html
ALIPAY_F2F_NOTIFY_URL=https://example.com/api/payments/alipay/f2f/notify

SUPPORT_EMAIL=support@example.com
SUPPORT_WECHAT=cto-support
```

- **沙箱模式**：`PAYMENT_SANDBOX=true` 时不会调用真实接口，返回模拟二维码/表单便于联调。
- **数据库**：默认 SQLite 文件位于 `storage/app.db`，首次启动会自动建表并导入免费/付费套餐配置。

## 目录结构

```
src/
  app.ts                Express 启动及路由汇总
  index.ts              入口、对账定时任务
  config.ts             环境配置与默认值
  db.ts                 SQLite 初始化与数据种子
  logger.ts             控制台日志
  utils.ts              通用工具方法
  middleware/           鉴权与限流
  repositories/         数据访问层
  services/             业务逻辑（用户、额度、支付、对账）
  payments/             微信与支付宝适配器
  routes/               REST API（客户、产品、订单、支付通知、元信息）
public/
  payment.html          支付页（套餐 + 支付方式 + 二维码/表单）
  result.html           支付结果页（状态查询 + 失败重试）
```

## API 概览

| 方法 | 路径 | 描述 |
| ---- | ---- | ---- |
| `POST` | `/api/customers/anonymous` | 创建/获取匿名客户，返回访问令牌与当前额度 |
| `GET` | `/api/products` | 获取可用套餐列表 |
| `POST` | `/api/orders` | 创建支付订单（需 `Authorization: Bearer <token>`）|
| `GET` | `/api/orders/:orderId` | 查询订单状态及额度快照 |
| `POST` | `/api/payments/wechat/*/notify` | 微信支付回调（Native/JSAPI）|
| `POST` | `/api/payments/alipay/*/notify` | 支付宝回调（电脑网站/当面付）|
| `GET` | `/api/meta` | 沙箱状态与客服信息 |

## 支付回调与幂等

- **微信**：
  - 校验回调头部 `Wechatpay-Signature`/`Timestamp`/`Nonce`，匹配平台证书序列号。
  - 使用 `AES-256-GCM` 结合 `WECHAT_API_V3_KEY` 解密资源。
  - 回调体与订单号写入 `payment_events` 留存审计。
- **支付宝**：
  - 使用官方 SDK 校验 `sign` 字段。
  - 仅在状态为 `TRADE_SUCCESS`/`TRADE_FINISHED` 时提升额度。
- **幂等性**：
  - 订单表支持 `idempotency_key` 与 `out_trade_no` 唯一约束。
  - 回调多次到达时根据当前状态自动忽略。

## 对账与失败补单

- 定时任务（默认 60 秒）调用各支付查询接口，自动补单：
  - 成功：补记交易号、支付时间并发放额度。
  - 失败：更新状态与失败原因。
  - 待支付：保留在待处理队列中，记录重试次数。

## 前端支付体验

- 浏览器自动生成设备指纹，存储在 `localStorage`，并获取访问令牌。
- 展示套餐、支持的支付渠道，生成二维码（微信/支付宝扫码）或自动提交表单（支付宝电脑网站）。
- 支付结果页支持订单号查询、额度刷新、失败提示与客服指引。

## 安全注意事项

1. **密钥管理**：
   - 微信商户私钥、平台证书、支付宝公私钥需存储于安全位置并设置最小权限。
   - 建议使用 KMS/Secret Manager，并通过环境变量引入。
2. **签名校验**：
   - 微信：严格校验回调签名与序列号，失败直接返回 400。
   - 支付宝：依赖官方 SDK `checkNotifySign` 验签。
3. **Webhook 限流**：
   - 默认每分钟 120 次，可通过 `WEBHOOK_RATE_LIMIT_PER_MINUTE` 调整。
4. **Token 管理**：
   - 访问令牌仅存储在客户端本地，对服务端接口采用 Bearer Token 校验。
5. **沙箱测试**：
   - 保持 `PAYMENT_SANDBOX=true` 可模拟微信/支付宝返回，避免误付费。

## 开发与调试

- 运行 `npm run dev` 使用 `tsx` 实时编译。
- 通过 `DATABASE_PATH` 切换不同实例，便于本地/测试环境隔离。
- 若需额外套餐，可直接向 `products` 表插入记录或扩展种子逻辑。

## 许可证

本项目仅用于演示支付接入与额度管理，如需商用请确保符合微信支付与支付宝开放平台的相关政策与条款。
