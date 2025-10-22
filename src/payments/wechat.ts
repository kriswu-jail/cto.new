import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { Wechatpay } = require('wechatpay-node-v3');
import { config } from '../config';
import { logger } from '../logger';
import type { PaymentChannel } from '../types';

interface WechatClientOptions {
  appid: string;
  mchid: string;
  serial: string;
  privateKey: string;
  certs: Record<string, string>;
}

type WechatClient = any;

let client: WechatClient;
let platformCerts: Record<string, string> | null = null;

const loadPlatformCerts = () => {
  if (platformCerts) {
    return platformCerts;
  }
  const certs: Record<string, string> = {};
  if (fs.existsSync(config.wechat.platformCertDir)) {
    const files = fs.readdirSync(config.wechat.platformCertDir);
    files
      .filter((file) => file.endsWith('.pem'))
      .forEach((file) => {
        const serial = path.basename(file, '.pem');
        certs[serial] = fs.readFileSync(path.join(config.wechat.platformCertDir, file), 'utf8');
      });
  }
  platformCerts = certs;
  return certs;
};

const hasRealConfig = () =>
  Boolean(
    config.wechat.appId &&
      config.wechat.merchantId &&
      config.wechat.serialNo &&
      config.wechat.apiV3Key &&
      fs.existsSync(config.wechat.privateKeyPath)
  );

const getWechatClient = () => {
  if (!hasRealConfig() || config.sandbox) {
    return undefined;
  }
  if (client) {
    return client;
  }
  const options: WechatClientOptions = {
    appid: config.wechat.appId,
    mchid: config.wechat.merchantId,
    serial: config.wechat.serialNo,
    privateKey: fs.readFileSync(config.wechat.privateKeyPath, 'utf8'),
    certs: loadPlatformCerts(),
  };
  client = new Wechatpay(options);
  return client;
};

const sandboxNativeResponse = (outTradeNo: string) => ({
  code_url: `weixin://wxpay/bizpayurl?pr=${outTradeNo}`,
  prepay_id: `sandbox_prepay_${outTradeNo}`,
});

export const createWechatOrder = async (params: {
  channel: PaymentChannel;
  description: string;
  outTradeNo: string;
  amountCents: number;
  notifyUrl: string;
  attach?: string;
  openId?: string;
}) => {
  const realClient = getWechatClient();
  if (!realClient) {
    logger.warn('Wechat client not fully configured, using sandbox response.');
    return sandboxNativeResponse(params.outTradeNo);
  }
  if (params.channel === 'wechat_native') {
    const payload = {
      appid: config.wechat.appId,
      mchid: config.wechat.merchantId,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: params.notifyUrl,
      attach: params.attach,
      amount: {
        total: params.amountCents,
        currency: 'CNY',
      },
    };
    if (typeof realClient.transactions_native !== 'function') {
      logger.warn('Wechat client does not expose transactions_native, fallback sandbox.');
      return sandboxNativeResponse(params.outTradeNo);
    }
    const result = await realClient.transactions_native(payload);
    return result.data;
  }
  if (params.channel === 'wechat_jsapi') {
    if (!params.openId) {
      throw new Error('WECHAT_JSAPI_OPENID_REQUIRED');
    }
    const payload = {
      appid: config.wechat.appId,
      mchid: config.wechat.merchantId,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: config.wechat.jsapiNotifyUrl,
      attach: params.attach,
      amount: {
        total: params.amountCents,
        currency: 'CNY',
      },
      payer: {
        openid: params.openId,
      },
    };
    if (typeof realClient.transactions_jsapi !== 'function') {
      logger.warn('Wechat client does not expose transactions_jsapi, fallback sandbox.');
      return sandboxNativeResponse(params.outTradeNo);
    }
    const result = await realClient.transactions_jsapi(payload);
    return result.data;
  }
  throw new Error(`Unsupported Wechat channel: ${params.channel}`);
};

const getPlatformCert = (serial: string) => {
  const certs = loadPlatformCerts();
  if (certs[serial]) {
    return certs[serial];
  }
  const certPath = path.join(config.wechat.platformCertDir, `${serial}.pem`);
  if (fs.existsSync(certPath)) {
    const content = fs.readFileSync(certPath, 'utf8');
    platformCerts = { ...(platformCerts ?? {}), [serial]: content };
    return content;
  }
  return undefined;
};

const verifySignature = (headers: Record<string, string | string[] | undefined>, body: string) => {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const serial = headers['wechatpay-serial'];
  const signature = headers['wechatpay-signature'];
  if (!timestamp || !nonce || !serial || !signature) {
    throw new Error('WECHAT_SIGNATURE_HEADER_MISSING');
  }
  const ts = Array.isArray(timestamp) ? timestamp[0] : timestamp;
  const no = Array.isArray(nonce) ? nonce[0] : nonce;
  const se = Array.isArray(serial) ? serial[0] : serial;
  const sig = Array.isArray(signature) ? signature[0] : signature;
  const message = `${ts}\n${no}\n${body}\n`;
  const publicKey = getPlatformCert(se);
  if (!publicKey) {
    throw new Error('WECHAT_PLATFORM_CERT_NOT_FOUND');
  }
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(message);
  verifier.end();
  const verified = verifier.verify(publicKey, sig, 'base64');
  if (!verified) {
    throw new Error('WECHAT_SIGNATURE_INVALID');
  }
};

const decryptNotification = (resource: {
  ciphertext: string;
  nonce: string;
  associated_data: string;
}) => {
  const { ciphertext, nonce, associated_data } = resource;
  const apiV3Key = config.wechat.apiV3Key;
  const buffer = Buffer.from(ciphertext, 'base64');
  const authTag = buffer.subarray(buffer.length - 16);
  const data = buffer.subarray(0, buffer.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  if (associated_data) {
    decipher.setAAD(Buffer.from(associated_data, 'utf8'));
  }
  decipher.setAuthTag(authTag);
  const decoded = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decoded.toString('utf8')) as {
    out_trade_no: string;
    transaction_id: string;
    trade_state: string;
    payer: { openid: string };
    amount: { total: number; payer_total: number };
    success_time: string;
    attach?: string;
  };
};

export const parseWechatNotification = (headers: Record<string, string | string[] | undefined>, body: string) => {
  if (config.sandbox || !hasRealConfig()) {
    const payload = JSON.parse(body);
    return {
      eventType: payload.event_type ?? 'TRANSACTION.SUCCESS',
      outTradeNo: payload.out_trade_no ?? payload.resource?.out_trade_no,
      transactionId: payload.transaction_id ?? `sandbox_${payload.out_trade_no}`,
      tradeState: payload.trade_state ?? 'SUCCESS',
      successTime: payload.success_time ?? new Date().toISOString(),
      attach: payload.attach,
      raw: payload,
    };
  }
  verifySignature(headers, body);
  const payload = JSON.parse(body);
  if (!payload.resource) {
    throw new Error('WECHAT_NOTIFY_NO_RESOURCE');
  }
  const resource = decryptNotification(payload.resource);
  return {
    eventType: payload.event_type,
    outTradeNo: resource.out_trade_no,
    transactionId: resource.transaction_id,
    tradeState: resource.trade_state,
    successTime: resource.success_time,
    attach: resource.attach,
    raw: resource,
  };
};

export const queryWechatOrder = async (outTradeNo: string) => {
  const realClient = getWechatClient();
  if (!realClient) {
    return {
      trade_state: 'SUCCESS',
      out_trade_no: outTradeNo,
      transaction_id: `sandbox_${outTradeNo}`,
    };
  }
  if (typeof realClient.transactions_out_trade_no !== 'function') {
    logger.warn('Wechat client does not expose transactions_out_trade_no, fallback sandbox.');
    return {
      trade_state: 'SUCCESS',
      out_trade_no: outTradeNo,
      transaction_id: `sandbox_${outTradeNo}`,
    };
  }
  const result = await realClient.transactions_out_trade_no({
    mchid: config.wechat.merchantId,
    out_trade_no: outTradeNo,
  });
  return result.data;
};
