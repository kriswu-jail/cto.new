import type { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import { getOrCreateCustomer } from '../services/customer-service';
import { summarizeQuota } from '../services/quota-service';
import { authenticate, type RequestWithCustomer } from '../middleware/auth';

export const createCustomersRouter = (db: Database.Database): Router => {
  const router = express.Router();

  router.use(express.json());

  router.post('/anonymous', (req, res) => {
    const { deviceFingerprint, accessToken } = req.body ?? {};
    const result = getOrCreateCustomer(db, { deviceFingerprint, accessToken });
    res.json({
      customer: {
        id: result.customer.id,
        accessToken: result.customer.access_token,
        deviceFingerprint: result.customer.device_fingerprint,
      },
      quota: result.quota,
      isNew: result.isNew,
    });
  });

  router.get('/me', authenticate(db), (req, res) => {
    const customer = (req as RequestWithCustomer).customer;
    const quota = summarizeQuota(db, customer.id);
    res.json({
      customer: {
        id: customer.id,
        deviceFingerprint: customer.device_fingerprint,
        createdAt: customer.created_at,
        updatedAt: customer.updated_at,
      },
      quota,
    });
  });

  return router;
};
