import fs from 'fs';
import AlipaySdk from '@alipay/alipay-sdk';
import { config } from '../config';
import { logger } from '../logger';

let sdk: AlipaySdk | undefined;

const hasRealConfig = () =>
  Boolean(
    config.alipay.appId &&
      fs.existsSync(config.alipay.privateKeyPath) &&
      fs.existsSync(config.alipay.alipayPublicKeyPath)
  );

const getSdk = () => {
  if (!hasRealConfig() || config.sandbox) {
    return undefined;
  }
  if (sdk) {
    return sdk;
  }
  sdk = new AlipaySdk({
    appId: config.alipay.appId,
    privateKey: fs.readFileSync(config.alipay.privateKeyPath, 'utf8'),
    alipayPublicKey: fs.readFileSync(config.alipay.alipayPublicKeyPath, 'utf8'),
    gateway: config.sandbox ? 'https://openapi.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do',
    signType: config.alipay.signType,
  });
  return sdk;
};

export const createAlipayPcOrder = async (params: {
  outTradeNo: string;
  subject: string;
  totalAmount: number;
  returnUrl: string;
  notifyUrl: string;
}) => {
  const sdkClient = getSdk();
  if (!sdkClient) {
    logger.warn('Alipay SDK not fully configured, returning sandbox form.');
    return {
      paymentLink: `${config.sandbox ? 'https://openapi.alipaydev.com' : 'https://openapi.alipay.com'}/gateway.do?sandbox_out_trade_no=${params.outTradeNo}`,
      form: `<form id="alipay-sandbox" action="#" method="POST"><input type="hidden" name="out_trade_no" value="${params.outTradeNo}" /></form>`,
    };
  }
  const orderInfo = {
    subject: params.subject,
    out_trade_no: params.outTradeNo,
    total_amount: (params.totalAmount / 100).toFixed(2),
    product_code: 'FAST_INSTANT_TRADE_PAY',
  };
  const form = await sdkClient.pageExec('alipay.trade.page.pay', {
    bizContent: orderInfo,
    returnUrl: params.returnUrl,
    notifyUrl: params.notifyUrl,
  });
  return {
    paymentLink: form,
    form,
  };
};

export const createAlipayF2FOrder = async (params: {
  outTradeNo: string;
  subject: string;
  totalAmount: number;
  notifyUrl: string;
}) => {
  const sdkClient = getSdk();
  if (!sdkClient) {
    return {
      qrCode: `https://sandbox.alipay.com/qrcode/${params.outTradeNo}`,
    };
  }
  const result = await sdkClient.exec('alipay.trade.precreate', {
    notifyUrl: params.notifyUrl,
    bizContent: {
      subject: params.subject,
      out_trade_no: params.outTradeNo,
      total_amount: (params.totalAmount / 100).toFixed(2),
    },
  });
  return result;
};

export const verifyAlipayNotification = (params: Record<string, string | undefined>) => {
  const sdkClient = getSdk();
  if (!sdkClient) {
    logger.warn('Skipping Alipay signature verification in sandbox mode.');
    return true;
  }
  return sdkClient.checkNotifySign(params);
};

export const queryAlipayOrder = async (outTradeNo: string) => {
  const sdkClient = getSdk();
  if (!sdkClient) {
    return {
      trade_status: 'TRADE_SUCCESS',
      out_trade_no: outTradeNo,
      trade_no: `sandbox_${outTradeNo}`,
    };
  }
  const response = await sdkClient.exec('alipay.trade.query', {
    bizContent: {
      out_trade_no: outTradeNo,
    },
  });
  return response;
};
