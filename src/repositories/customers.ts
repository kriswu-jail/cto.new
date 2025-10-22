import type Database from 'better-sqlite3';
import { generateId, nowISOString } from '../utils';
import type { Customer } from '../types';

export interface CreateCustomerInput {
  deviceFingerprint?: string;
}

export const findCustomerByAccessToken = (db: Database.Database, accessToken: string): Customer | undefined => {
  const statement = db.prepare<Customer>('SELECT * FROM customers WHERE access_token = ?');
  return statement.get(accessToken);
};

export const findCustomerByFingerprint = (db: Database.Database, fingerprint: string): Customer | undefined => {
  const statement = db.prepare<Customer>('SELECT * FROM customers WHERE device_fingerprint = ?');
  return statement.get(fingerprint);
};

export const createCustomer = (db: Database.Database, input: CreateCustomerInput): Customer => {
  const id = generateId();
  const now = nowISOString();
  const accessToken = generateId();
  const insert = db.prepare(
    `INSERT INTO customers (id, device_fingerprint, access_token, created_at, updated_at)
     VALUES (@id, @device_fingerprint, @access_token, @created_at, @updated_at)`
  );
  insert.run({
    id,
    device_fingerprint: input.deviceFingerprint ?? null,
    access_token: accessToken,
    created_at: now,
    updated_at: now,
  });
  const statement = db.prepare<Customer>('SELECT * FROM customers WHERE id = ?');
  return statement.get(id) as Customer;
};

export const touchCustomer = (db: Database.Database, id: string) => {
  const now = nowISOString();
  db.prepare('UPDATE customers SET last_seen_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
};
