import type Database from 'better-sqlite3';
import { createCustomer, findCustomerByAccessToken, findCustomerByFingerprint, touchCustomer } from '../repositories/customers';
import { ensureFreeAllocation, summarizeQuota } from './quota-service';

export const getOrCreateCustomer = (
  db: Database.Database,
  params: { deviceFingerprint?: string; accessToken?: string }
) => {
  if (params.accessToken) {
    const existingByToken = findCustomerByAccessToken(db, params.accessToken);
    if (existingByToken) {
      touchCustomer(db, existingByToken.id);
      ensureFreeAllocation(db, existingByToken.id);
      return {
        customer: existingByToken,
        quota: summarizeQuota(db, existingByToken.id),
        isNew: false,
      };
    }
  }
  if (params.deviceFingerprint) {
    const existingByFingerprint = findCustomerByFingerprint(db, params.deviceFingerprint);
    if (existingByFingerprint) {
      touchCustomer(db, existingByFingerprint.id);
      ensureFreeAllocation(db, existingByFingerprint.id);
      return {
        customer: existingByFingerprint,
        quota: summarizeQuota(db, existingByFingerprint.id),
        isNew: false,
      };
    }
  }
  const customer = createCustomer(db, { deviceFingerprint: params.deviceFingerprint });
  ensureFreeAllocation(db, customer.id);
  return {
    customer,
    quota: summarizeQuota(db, customer.id),
    isNew: true,
  };
};
