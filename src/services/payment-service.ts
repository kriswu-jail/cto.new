import type Database from 'better-sqlite3';
import fs from 'fs';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { config } from '../config';
import { findProductById } from '../repositories/products';
import {
  appendPaymentEvent,
  createOrder,
  findOrderById,
  findOrderByIdempotencyKey,
  findOrderByOutTradeNo,
  incrementOrderAttempts,
  listOrdersNeedingReconciliation,
  updateOrderStatus,
} from '../repositories/orders';
import { createAlipayF2FOrder, createAlipayPcOrder, queryAlipayOrder, verifyAlipayNotification } from '../payments/alipay';
import { createWechatOrder, parseWechatNotification, queryWechatOrder } from '../payments/wechat';
import type { Customer, Order, OrderStatus, PaymentChannel } from '../types';
import { generateId, nowISOString, parseJSONSafe } from '../utils';
import { applyPaidAllocation, summarizeQuota } from './quota-service';
import { logger } from '../logger';

interface CreatePaymentParams {
  db: Database.Database;
  customer: Customer;
  productId: string;
  channel: PaymentChannel;
  idempotencyKey?: string;
  openId?: string;
}

const supportedProviders: Record<PaymentChannel, 'wechat' | 'alipay'> = {
  wechat_native: 'wechat',
  wechat_jsapi: 'wechat',
  alipay_pc: 'alipay',
  alipay_f2f: 'alipay',
};

const generateOutTradeNo = () => {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const random = crypto.randomBytes(4).toString('hex');
  return `${timestamp}${random}`;
};

const parseChannelSupport = (value: string) => {
  const parsed = parseJSONSafe<string[]>(value);
  if (!parsed) {
    return [];
  }
  return parsed;
};

export const createPaymentOrder = async (params: CreatePaymentParams) => {
  const product = findProductById(params.db, params.productId);
  if (!product) {
    throw new Error('PRODUCT_NOT_FOUND');
  }
  const channelSupport = parseChannelSupport(product.channel_support);
  if (!channelSupport.includes(params.channel)) {
    throw new Error('CHANNEL_NOT_SUPPORTED');
  }
  if (params.idempotencyKey) {
    const existing = findOrderByIdempotencyKey(params.db, params.idempotencyKey);
    if (existing && existing.status !== 'failed' && existing.status !== 'canceled') {
      return {
        order: existing,
        product,
        payment: buildPaymentPayload(existing, params.channel),
        quota: summarizeQuota(params.db, params.customer.id),
      };
    }
  }
  const outTradeNo = generateOutTradeNo();
  const provider = supportedProviders[params.channel];
  const order = createOrder(params.db, {
    customerId: params.customer.id,
    productId: product.id,
    channel: params.channel,
    amountCents: product.price_cents,
    currency: product.currency,
    idempotencyKey: params.idempotencyKey,
    provider,
    outTradeNo,
    sandbox: config.sandbox,
  });
  let updated: Order;
  if (provider === 'wechat') {
    const description = `${product.name}`;
    const notifyUrl = params.channel === 'wechat_native' ? config.wechat.notifyUrl : config.wechat.jsapiNotifyUrl;
    const response = await createWechatOrder({
      channel: params.channel,
      description,
      outTradeNo,
      amountCents: product.price_cents,
      notifyUrl,
      attach: JSON.stringify({ orderId: order.id }),
      openId: params.openId,
    });
    if (params.channel === 'wechat_native') {
      const codeUrl = response.code_url ?? '';
      const qr = await QRCode.toDataURL(codeUrl, { width: 300 });
      updated = updateOrderStatus(params.db, order.id, 'awaiting_payment', {
        qrcode_url: qr,
        payment_link: codeUrl,
        prepay_id: response.prepay_id ?? null,
      });
    } else {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = generateId().replace(/-/g, '');
      const packageValue = `prepay_id=${response.prepay_id}`;
      const signMessage = `${config.wechat.appId}\n${timestamp}\n${nonceStr}\n${packageValue}\n`;
      let paySign = crypto.createHash('sha256').update(signMessage).digest('hex');
      if (fs.existsSync(config.wechat.privateKeyPath)) {
        const privateKey = fs.readFileSync(config.wechat.privateKeyPath, 'utf8');
        paySign = crypto.createSign('RSA-SHA256').update(signMessage).sign(privateKey, 'base64');
      }
      updated = updateOrderStatus(params.db, order.id, 'awaiting_payment', {
        prepay_id: response.prepay_id ?? null,
        notify_payload: JSON.stringify({
          timeStamp: timestamp,
          nonceStr,
          package: packageValue,
          signType: 'RSA',
          paySign,
        }),
      });
    }
  } else {
    if (params.channel === 'alipay_pc') {
      const response = await createAlipayPcOrder({
        outTradeNo,
        subject: product.name,
        totalAmount: product.price_cents,
        returnUrl: config.alipay.returnUrl,
        notifyUrl: config.alipay.notifyUrl,
      });
      updated = updateOrderStatus(params.db, order.id, 'awaiting_payment', {
        payment_link: response.paymentLink,
        notify_payload: JSON.stringify({ form: response.form }),
      });
    } else {
      const response = await createAlipayF2FOrder({
        outTradeNo,
        subject: product.name,
        totalAmount: product.price_cents,
        notifyUrl: config.alipay.f2fNotifyUrl,
      });
      const qrCode = response.qrCode ?? response.qr_code ?? '';
      const qr = qrCode ? await QRCode.toDataURL(qrCode, { width: 300 }) : '';
      updated = updateOrderStatus(params.db, order.id, 'awaiting_payment', {
        qrcode_url: qr,
        payment_link: qrCode,
        notify_payload: JSON.stringify(response),
      });
    }
  }
  return {
    order: updated,
    product,
    payment: buildPaymentPayload(updated, params.channel),
    quota: summarizeQuota(params.db, params.customer.id),
  };
};

const buildPaymentPayload = (order: Order, channel: PaymentChannel) => {
  if (channel === 'wechat_native' || channel === 'alipay_f2f') {
    return {
      qrcode: order.qrcode_url,
      link: order.payment_link,
    };
  }
  if (channel === 'wechat_jsapi') {
    return parseJSONSafe<Record<string, string | undefined>>(order.notify_payload ?? '') ?? {};
  }
  if (channel === 'alipay_pc') {
    const payload = parseJSONSafe<{ form?: string }>(order.notify_payload ?? '') ?? {};
    return {
      form: payload.form ?? order.payment_link,
    };
  }
  return {};
};

export const handleWechatCallback = (
  db: Database.Database,
  headers: Record<string, string | string[] | undefined>,
  body: string
) => {
  const notification = parseWechatNotification(headers, body);
  const order = findOrderByOutTradeNo(db, notification.outTradeNo);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  appendPaymentEvent(db, {
    orderId: order.id,
    channel: order.channel,
    eventType: notification.eventType,
    rawPayload: body,
  });
  if (notification.tradeState !== 'SUCCESS') {
    updateOrderStatus(db, order.id, 'processing', {
      notify_payload: body,
      last_error: notification.tradeState,
    });
    return { status: 'processing' };
  }
  return finalizeSuccessfulPayment(db, order.id, notification.transactionId, notification.successTime, body);
};

const finalizeSuccessfulPayment = (
  db: Database.Database,
  orderId: string,
  providerTransactionId: string,
  paidAt: string,
  payload: string
) => {
  const order = findOrderById(db, orderId);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  if (order.status === 'paid') {
    return order;
  }
  const updated = updateOrderStatus(db, order.id, 'paid', {
    provider_transaction_id: providerTransactionId,
    paid_at: paidAt,
    notify_payload: payload,
  });
  const product = findProductById(db, order.product_id);
  if (!product) {
    throw new Error('PRODUCT_NOT_FOUND');
  }
  const allocation = applyPaidAllocation(db, {
    customerId: order.customer_id,
    product,
    orderId: order.id,
  });
  const quota = summarizeQuota(db, order.customer_id);
  return { order: updated, allocation, quota };
};

export const handleAlipayCallback = (db: Database.Database, params: Record<string, string | undefined>) => {
  const outTradeNo = params.out_trade_no;
  if (!outTradeNo) {
    throw new Error('ALIPAY_OUT_TRADE_NO_MISSING');
  }
  const order = findOrderByOutTradeNo(db, outTradeNo);
  if (!order) {
    throw new Error('ORDER_NOT_FOUND');
  }
  appendPaymentEvent(db, {
    orderId: order.id,
    channel: order.channel,
    eventType: params.trade_status ?? 'UNKNOWN',
    rawPayload: JSON.stringify(params),
  });
  if (!verifyAlipayNotification(params)) {
    throw new Error('ALIPAY_SIGNATURE_INVALID');
  }
  if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
    updateOrderStatus(db, order.id, 'processing', {
      last_error: params.trade_status ?? 'UNKNOWN',
      notify_payload: JSON.stringify(params),
    });
    return { status: 'processing' };
  }
  return finalizeSuccessfulPayment(db, order.id, params.trade_no ?? generateId(), params.notify_time ?? nowISOString(), JSON.stringify(params));
};

export const reconcilePendingOrders = async (db: Database.Database) => {
  const orders = listOrdersNeedingReconciliation(db, 10);
  const results: Array<{ orderId: string; status: OrderStatus; detail: string }> = [];
  for (const order of orders) {
    try {
      incrementOrderAttempts(db, order.id);
      if (order.provider === 'wechat') {
        const result = await queryWechatOrder(order.out_trade_no);
        if (result.trade_state === 'SUCCESS') {
          finalizeSuccessfulPayment(db, order.id, result.transaction_id ?? generateId(), result.success_time ?? nowISOString(), JSON.stringify(result));
          results.push({ orderId: order.id, status: 'paid', detail: 'wechat_success' });
          continue;
        }
        if (result.trade_state === 'NOTPAY') {
          results.push({ orderId: order.id, status: order.status, detail: 'pending' });
          continue;
        }
        if (result.trade_state === 'CLOSED' || result.trade_state === 'REVOKED') {
          updateOrderStatus(db, order.id, 'failed', {
            last_error: result.trade_state,
            notify_payload: JSON.stringify(result),
          });
          results.push({ orderId: order.id, status: 'failed', detail: result.trade_state ?? 'failed' });
          continue;
        }
      } else {
        const result = await queryAlipayOrder(order.out_trade_no);
        if (result.trade_status === 'TRADE_SUCCESS' || result.trade_status === 'TRADE_FINISHED') {
          finalizeSuccessfulPayment(db, order.id, result.trade_no ?? generateId(), result.send_pay_date ?? nowISOString(), JSON.stringify(result));
          results.push({ orderId: order.id, status: 'paid', detail: 'alipay_success' });
          continue;
        }
        if (result.trade_status === 'WAIT_BUYER_PAY') {
          results.push({ orderId: order.id, status: order.status, detail: 'pending' });
          continue;
        }
        if (result.trade_status === 'TRADE_CLOSED') {
          updateOrderStatus(db, order.id, 'failed', {
            last_error: result.trade_status,
            notify_payload: JSON.stringify(result),
          });
          results.push({ orderId: order.id, status: 'failed', detail: 'trade_closed' });
          continue;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN';
      logger.error('Reconciliation error', { orderId: order.id, message });
      updateOrderStatus(db, order.id, 'processing', {
        last_error: message,
      });
      results.push({ orderId: order.id, status: 'processing', detail: message });
    }
  }
  return results;
};
