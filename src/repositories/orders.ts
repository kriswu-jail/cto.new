import type Database from 'better-sqlite3';
import type { Order, OrderStatus, PaymentChannel } from '../types';
import { generateId, nowISOString } from '../utils';

export interface CreateOrderInput {
  customerId: string;
  productId: string;
  channel: PaymentChannel;
  amountCents: number;
  currency: string;
  idempotencyKey?: string;
  provider: string;
  outTradeNo: string;
  sandbox: boolean;
}

export const createOrder = (db: Database.Database, input: CreateOrderInput): Order => {
  const now = nowISOString();
  const id = generateId();
  const insert = db.prepare(
    `INSERT INTO orders (
       id, customer_id, product_id, channel, status, amount_cents, currency, idempotency_key, out_trade_no, provider, sandbox, created_at, updated_at
     ) VALUES (@id, @customer_id, @product_id, @channel, @status, @amount_cents, @currency, @idempotency_key, @out_trade_no, @provider, @sandbox, @created_at, @updated_at)`
  );
  insert.run({
    id,
    customer_id: input.customerId,
    product_id: input.productId,
    channel: input.channel,
    status: 'pending',
    amount_cents: input.amountCents,
    currency: input.currency,
    idempotency_key: input.idempotencyKey ?? null,
    out_trade_no: input.outTradeNo,
    provider: input.provider,
    sandbox: input.sandbox ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  const statement = db.prepare<Order>('SELECT * FROM orders WHERE id = ?');
  return statement.get(id) as Order;
};

export const findOrderById = (db: Database.Database, id: string): Order | undefined => {
  const statement = db.prepare<Order>('SELECT * FROM orders WHERE id = ?');
  return statement.get(id);
};

export const findOrderByOutTradeNo = (db: Database.Database, outTradeNo: string): Order | undefined => {
  const statement = db.prepare<Order>('SELECT * FROM orders WHERE out_trade_no = ?');
  return statement.get(outTradeNo);
};

export const findOrderByIdempotencyKey = (db: Database.Database, key: string): Order | undefined => {
  const statement = db.prepare<Order>('SELECT * FROM orders WHERE idempotency_key = ?');
  return statement.get(key);
};

export const updateOrderStatus = (
  db: Database.Database,
  id: string,
  status: OrderStatus,
  extra?: Partial<Omit<Order, 'id'>>
): Order => {
  const now = nowISOString();
  const fields: string[] = ['status = @status', 'updated_at = @updated_at'];
  const params: Record<string, unknown> = {
    status,
    updated_at: now,
    id,
  };
  if (extra) {
    if (extra.payment_link !== undefined) {
      fields.push('payment_link = @payment_link');
      params.payment_link = extra.payment_link;
    }
    if (extra.qrcode_url !== undefined) {
      fields.push('qrcode_url = @qrcode_url');
      params.qrcode_url = extra.qrcode_url;
    }
    if (extra.prepay_id !== undefined) {
      fields.push('prepay_id = @prepay_id');
      params.prepay_id = extra.prepay_id;
    }
    if (extra.notify_payload !== undefined) {
      fields.push('notify_payload = @notify_payload');
      params.notify_payload = extra.notify_payload;
    }
    if (extra.last_error !== undefined) {
      fields.push('last_error = @last_error');
      params.last_error = extra.last_error;
    }
    if (extra.provider_transaction_id !== undefined) {
      fields.push('provider_transaction_id = @provider_transaction_id');
      params.provider_transaction_id = extra.provider_transaction_id;
    }
    if (extra.paid_at !== undefined) {
      fields.push('paid_at = @paid_at');
      params.paid_at = extra.paid_at;
    }
    if (extra.expired_at !== undefined) {
      fields.push('expired_at = @expired_at');
      params.expired_at = extra.expired_at;
    }
  }
  const statement = db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = @id`);
  statement.run(params);
  const select = db.prepare<Order>('SELECT * FROM orders WHERE id = ?');
  return select.get(id) as Order;
};

export const incrementOrderAttempts = (db: Database.Database, id: string) => {
  const statement = db.prepare('UPDATE orders SET attempts = attempts + 1, updated_at = ? WHERE id = ?');
  statement.run(nowISOString(), id);
};

export const appendPaymentEvent = (
  db: Database.Database,
  params: { orderId: string; channel: PaymentChannel; eventType: string; rawPayload: string }
) => {
  const statement = db.prepare(
    `INSERT INTO payment_events (id, order_id, channel, event_type, raw_payload, created_at)
     VALUES (@id, @order_id, @channel, @event_type, @raw_payload, @created_at)`
  );
  statement.run({
    id: generateId(),
    order_id: params.orderId,
    channel: params.channel,
    event_type: params.eventType,
    raw_payload: params.rawPayload,
    created_at: nowISOString(),
  });
};

export const listOrdersNeedingReconciliation = (db: Database.Database, limit = 20): Order[] => {
  const statement = db.prepare<Order>(
    `SELECT * FROM orders
     WHERE status IN ('pending', 'awaiting_payment', 'processing')
       AND attempts < 5
     ORDER BY created_at ASC
     LIMIT ?`
  );
  return statement.all(limit) as Order[];
};
