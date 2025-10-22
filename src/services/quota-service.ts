import type Database from 'better-sqlite3';
import { findProductById } from '../repositories/products';
import {
  createAllocation,
  getActiveAllocationsForCustomer,
  recordUsageEvent,
  summarizeAllocations,
  type AllocationSummary,
} from '../repositories/quotas';
import type { Product } from '../types';
import { nowISOString } from '../utils';

const FREE_PRODUCT_ID = 'free-tier';

const ensureProductExists = (product: Product | undefined, productId: string) => {
  if (!product) {
    throw new Error(`PRODUCT_NOT_FOUND:${productId}`);
  }
};

export const ensureFreeAllocation = (db: Database.Database, customerId: string) => {
  const allocations = getActiveAllocationsForCustomer(db, customerId);
  const hasFree = allocations.some((allocation) => allocation.source === FREE_PRODUCT_ID);
  if (hasFree) {
    return;
  }
  const product = findProductById(db, FREE_PRODUCT_ID);
  ensureProductExists(product, FREE_PRODUCT_ID);
  createAllocation(db, {
    customerId,
    source: FREE_PRODUCT_ID,
    totalCredits: product!.credits,
    concurrencyLimit: product!.concurrency_limit,
    singleFileBytes: product!.single_file_bytes,
  });
};

export const applyPaidAllocation = (
  db: Database.Database,
  params: {
    customerId: string;
    product: Product;
    orderId: string;
  }
) => {
  const allocation = createAllocation(db, {
    customerId: params.customerId,
    source: params.product.id,
    totalCredits: params.product.credits,
    concurrencyLimit: params.product.concurrency_limit,
    singleFileBytes: params.product.single_file_bytes,
  });
  recordUsageEvent(db, {
    customerId: params.customerId,
    allocationId: allocation.id,
    orderId: params.orderId,
    deltaCredits: allocation.total_credits,
    reason: 'topup',
    metadata: {
      product: params.product.id,
      activated_at: nowISOString(),
    },
  });
  return allocation;
};

export const summarizeQuota = (db: Database.Database, customerId: string): AllocationSummary => {
  const allocations = getActiveAllocationsForCustomer(db, customerId);
  return summarizeAllocations(allocations);
};
