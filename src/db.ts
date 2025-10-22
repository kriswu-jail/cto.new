import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';

let database: Database.Database | undefined;

const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      device_fingerprint TEXT UNIQUE,
      access_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT
    );`,
  `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      credits INTEGER NOT NULL,
      concurrency_limit INTEGER NOT NULL,
      single_file_bytes INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      channel_support TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
  `CREATE TABLE IF NOT EXISTS quota_allocations (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      source TEXT NOT NULL,
      total_credits INTEGER NOT NULL,
      used_credits INTEGER NOT NULL,
      concurrency_limit INTEGER NOT NULL,
      single_file_bytes INTEGER NOT NULL,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );`,
  `CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      allocation_id TEXT,
      order_id TEXT,
      delta_credits INTEGER NOT NULL,
      reason TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );`,
  `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      idempotency_key TEXT,
      out_trade_no TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_transaction_id TEXT,
      payment_link TEXT,
      qrcode_url TEXT,
      prepay_id TEXT,
      notify_payload TEXT,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      sandbox INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT,
      expired_at TEXT,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_out_trade_no_idx ON orders(out_trade_no);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx ON orders(idempotency_key);`,
  `CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );`,
  `CREATE TABLE IF NOT EXISTS reconciliation_logs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );`
];

const ensureStorageDir = () => {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });
};

const runMigrations = (db: Database.Database) => {
  db.pragma('journal_mode = WAL');
  const migrationTransaction = db.transaction(() => {
    migrations.forEach((statement) => {
      db.prepare(statement).run();
    });
  });
  migrationTransaction();
};

const seedDefaultProducts = (db: Database.Database) => {
  const exists = db.prepare('SELECT COUNT(1) as count FROM products').get() as { count: number };
  if (exists.count > 0) {
    return;
  }
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO products (
      id, name, description, price_cents, currency, credits, concurrency_limit, single_file_bytes, sort_order, is_active, channel_support, created_at, updated_at
    ) VALUES (@id, @name, @description, @price_cents, @currency, @credits, @concurrency_limit, @single_file_bytes, @sort_order, @is_active, @channel_support, @created_at, @updated_at)`
  );
  const products = [
    {
      id: 'free-tier',
      name: '免费额度',
      description: '面向匿名用户的默认基础额度。',
      price_cents: 0,
      currency: 'CNY',
      credits: 100,
      concurrency_limit: 1,
      single_file_bytes: 5 * 1024 * 1024,
      sort_order: 0,
      is_active: 1,
      channel_support: JSON.stringify(['quota']),
      created_at: now,
      updated_at: now,
    },
    {
      id: 'pro-500',
      name: '专业版 500 次',
      description: '适合中型团队，含并发与单文件提升。',
      price_cents: 19900,
      currency: 'CNY',
      credits: 500,
      concurrency_limit: 5,
      single_file_bytes: 20 * 1024 * 1024,
      sort_order: 10,
      is_active: 1,
      channel_support: JSON.stringify(['wechat_native', 'wechat_jsapi', 'alipay_pc', 'alipay_f2f']),
      created_at: now,
      updated_at: now,
    },
    {
      id: 'enterprise-2000',
      name: '企业版 2000 次',
      description: '面向企业客户，支持绑定设备指纹与令牌。',
      price_cents: 69900,
      currency: 'CNY',
      credits: 2000,
      concurrency_limit: 20,
      single_file_bytes: 50 * 1024 * 1024,
      sort_order: 20,
      is_active: 1,
      channel_support: JSON.stringify(['wechat_native', 'wechat_jsapi', 'alipay_pc', 'alipay_f2f']),
      created_at: now,
      updated_at: now,
    },
  ];
  const transaction = db.transaction(() => {
    products.forEach((product) => insert.run(product));
  });
  transaction();
  logger.info('Default products seeded');
};

export const getDatabase = () => {
  if (database) {
    return database;
  }
  ensureStorageDir();
  database = new Database(config.databasePath);
  runMigrations(database);
  seedDefaultProducts(database);
  return database;
};
