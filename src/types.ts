export type PaymentChannel = 'wechat_native' | 'wechat_jsapi' | 'alipay_pc' | 'alipay_f2f';

export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'expired';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  credits: number;
  concurrency_limit: number;
  single_file_bytes: number;
  sort_order: number;
  is_active: 0 | 1;
  channel_support: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  device_fingerprint: string | null;
  access_token: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface QuotaAllocation {
  id: string;
  customer_id: string;
  source: string;
  total_credits: number;
  used_credits: number;
  concurrency_limit: number;
  single_file_bytes: number;
  expires_at: string | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  customer_id: string;
  product_id: string;
  channel: PaymentChannel;
  status: OrderStatus;
  amount_cents: number;
  currency: string;
  idempotency_key: string | null;
  out_trade_no: string;
  provider: string;
  provider_transaction_id: string | null;
  payment_link: string | null;
  qrcode_url: string | null;
  prepay_id: string | null;
  notify_payload: string | null;
  last_error: string | null;
  attempts: number;
  sandbox: number;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  expired_at: string | null;
}
