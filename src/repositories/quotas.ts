import type Database from 'better-sqlite3';
import type { QuotaAllocation } from '../types';
import { generateId, nowISOString } from '../utils';

export interface AllocationSummary {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  concurrencyLimit: number;
  singleFileBytes: number;
}

type RawAllocation = QuotaAllocation;

export const getActiveAllocationsForCustomer = (db: Database.Database, customerId: string): RawAllocation[] => {
  const statement = db.prepare<RawAllocation>(
    `SELECT * FROM quota_allocations
     WHERE customer_id = ?
       AND is_active = 1
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC`
  );
  return statement.all(customerId, nowISOString()) as RawAllocation[];
};

export const createAllocation = (
  db: Database.Database,
  params: {
    customerId: string;
    source: string;
    totalCredits: number;
    concurrencyLimit: number;
    singleFileBytes: number;
    expiresAt?: string | null;
  }
): RawAllocation => {
  const statement = db.prepare(
    `INSERT INTO quota_allocations (
       id, customer_id, source, total_credits, used_credits, concurrency_limit, single_file_bytes, expires_at, is_active, created_at, updated_at
     ) VALUES (@id, @customer_id, @source, @total_credits, @used_credits, @concurrency_limit, @single_file_bytes, @expires_at, @is_active, @created_at, @updated_at)`
  );
  const id = generateId();
  const now = nowISOString();
  statement.run({
    id,
    customer_id: params.customerId,
    source: params.source,
    total_credits: params.totalCredits,
    used_credits: 0,
    concurrency_limit: params.concurrencyLimit,
    single_file_bytes: params.singleFileBytes,
    expires_at: params.expiresAt ?? null,
    is_active: 1,
    created_at: now,
    updated_at: now,
  });
  const select = db.prepare<RawAllocation>('SELECT * FROM quota_allocations WHERE id = ?');
  return select.get(id) as RawAllocation;
};

export const summarizeAllocations = (allocations: RawAllocation[]): AllocationSummary => {
  if (allocations.length === 0) {
    return {
      totalCredits: 0,
      usedCredits: 0,
      remainingCredits: 0,
      concurrencyLimit: 0,
      singleFileBytes: 0,
    };
  }
  return allocations.reduce(
    (acc, allocation) => {
      const remaining = allocation.total_credits - allocation.used_credits;
      return {
        totalCredits: acc.totalCredits + allocation.total_credits,
        usedCredits: acc.usedCredits + allocation.used_credits,
        remainingCredits: acc.remainingCredits + Math.max(remaining, 0),
        concurrencyLimit: Math.max(acc.concurrencyLimit, allocation.concurrency_limit),
        singleFileBytes: Math.max(acc.singleFileBytes, allocation.single_file_bytes),
      };
    },
    {
      totalCredits: 0,
      usedCredits: 0,
      remainingCredits: 0,
      concurrencyLimit: 0,
      singleFileBytes: 0,
    }
  );
};

export const recordUsageEvent = (
  db: Database.Database,
  params: {
    customerId: string;
    allocationId?: string | null;
    orderId?: string | null;
    deltaCredits: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }
) => {
  const insert = db.prepare(
    `INSERT INTO usage_events (id, customer_id, allocation_id, order_id, delta_credits, reason, metadata, created_at)
     VALUES (@id, @customer_id, @allocation_id, @order_id, @delta_credits, @reason, @metadata, @created_at)`
  );
  insert.run({
    id: generateId(),
    customer_id: params.customerId,
    allocation_id: params.allocationId ?? null,
    order_id: params.orderId ?? null,
    delta_credits: params.deltaCredits,
    reason: params.reason,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    created_at: nowISOString(),
  });
};

export const consumeCredits = (
  db: Database.Database,
  params: {
    customerId: string;
    requestedCredits: number;
  }
) => {
  const allocations = getActiveAllocationsForCustomer(db, params.customerId);
  let creditsToConsume = params.requestedCredits;
  const transaction = db.transaction(() => {
    for (const allocation of allocations) {
      if (creditsToConsume <= 0) {
        break;
      }
      const available = allocation.total_credits - allocation.used_credits;
      if (available <= 0) {
        continue;
      }
      const consume = Math.min(available, creditsToConsume);
      db.prepare('UPDATE quota_allocations SET used_credits = used_credits + ?, updated_at = ? WHERE id = ?').run(consume, nowISOString(), allocation.id);
      recordUsageEvent(db, {
        customerId: params.customerId,
        allocationId: allocation.id,
        deltaCredits: -consume,
        reason: 'usage',
      });
      creditsToConsume -= consume;
    }
    if (creditsToConsume > 0) {
      throw new Error('INSUFFICIENT_CREDITS');
    }
  });
  transaction();
};
