import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface ServiceConfig {
  port: number;
  databasePath: string;
  sandbox: boolean;
  webhookRateLimitPerMinute: number;
  wechat: {
    appId: string;
    merchantId: string;
    apiV3Key: string;
    serialNo: string;
    privateKeyPath: string;
    platformCertDir: string;
    notifyUrl: string;
    jsapiNotifyUrl: string;
  };
  alipay: {
    appId: string;
    privateKeyPath: string;
    alipayPublicKeyPath: string;
    signType: 'RSA2';
    notifyUrl: string;
    returnUrl: string;
    f2fNotifyUrl: string;
  };
  support: {
    email: string;
    wechat: string;
  };
}

const rootDir = process.cwd();

const resolvePath = (value: string, fallback: string) => {
  if (!value) {
    return fallback;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.join(rootDir, value);
};

export const config: ServiceConfig = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  databasePath: resolvePath(process.env.DATABASE_PATH ?? '', path.join(rootDir, 'storage', 'app.db')),
  sandbox: (process.env.PAYMENT_SANDBOX ?? 'true').toLowerCase() === 'true',
  webhookRateLimitPerMinute: Number.parseInt(process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE ?? '120', 10),
  wechat: {
    appId: process.env.WECHAT_APP_ID ?? '',
    merchantId: process.env.WECHAT_MCH_ID ?? '',
    apiV3Key: process.env.WECHAT_API_V3_KEY ?? '',
    serialNo: process.env.WECHAT_SERIAL_NO ?? '',
    privateKeyPath: resolvePath(process.env.WECHAT_PRIVATE_KEY_PATH ?? '', path.join(rootDir, 'certs', 'wechat', 'apiclient_key.pem')),
    platformCertDir: resolvePath(process.env.WECHAT_PLATFORM_CERT_DIR ?? '', path.join(rootDir, 'certs', 'wechat', 'platform')),
    notifyUrl: process.env.WECHAT_NOTIFY_URL ?? 'https://example.com/api/payments/wechat/native/notify',
    jsapiNotifyUrl: process.env.WECHAT_JSAPI_NOTIFY_URL ?? 'https://example.com/api/payments/wechat/jsapi/notify',
  },
  alipay: {
    appId: process.env.ALIPAY_APP_ID ?? '',
    privateKeyPath: resolvePath(process.env.ALIPAY_PRIVATE_KEY_PATH ?? '', path.join(rootDir, 'certs', 'alipay', 'private_key.pem')),
    alipayPublicKeyPath: resolvePath(process.env.ALIPAY_PUBLIC_KEY_PATH ?? '', path.join(rootDir, 'certs', 'alipay', 'alipay_public_key.pem')),
    signType: 'RSA2',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL ?? 'https://example.com/api/payments/alipay/pc/notify',
    returnUrl: process.env.ALIPAY_RETURN_URL ?? 'https://example.com/payments/result.html',
    f2fNotifyUrl: process.env.ALIPAY_F2F_NOTIFY_URL ?? 'https://example.com/api/payments/alipay/f2f/notify',
  },
  support: {
    email: process.env.SUPPORT_EMAIL ?? 'support@example.com',
    wechat: process.env.SUPPORT_WECHAT ?? '',
  },
};
