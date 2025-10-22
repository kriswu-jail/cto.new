import type { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import { authenticate, type RequestWithCustomer } from '../middleware/auth';
import { createPaymentOrder } from '../services/payment-service';
import { findOrderById } from '../repositories/orders';
import { summarizeQuota } from '../services/quota-service';

export const createOrdersRouter = (db: Database.Database): Router => {
  const router = express.Router();

  router.use(express.json());

  router.post('/', authenticate(db), async (req, res, next) => {
    try {
      const { productId, channel, idempotencyKey, openId } = req.body ?? {};
      if (!productId || !channel) {
        res.status(400).json({ error: 'INVALID_REQUEST' });
        return;
      }
      const customer = (req as RequestWithCustomer).customer;
      const result = await createPaymentOrder({
        db,
        customer,
        productId,
        channel,
        idempotencyKey,
        openId,
      });
      res.json({
        order: {
          id: result.order.id,
          status: result.order.status,
          channel: result.order.channel,
          amountCents: result.order.amount_cents,
          currency: result.order.currency,
          qrcode: result.order.qrcode_url,
          paymentLink: result.order.payment_link,
          prepayId: result.order.prepay_id,
          createdAt: result.order.created_at,
          updatedAt: result.order.updated_at,
        },
        product: {
          id: result.product.id,
          name: result.product.name,
          credits: result.product.credits,
          concurrencyLimit: result.product.concurrency_limit,
          singleFileBytes: result.product.single_file_bytes,
        },
        payment: result.payment,
        quota: result.quota,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:orderId', authenticate(db), (req, res) => {
    const customer = (req as RequestWithCustomer).customer;
    const order = findOrderById(db, req.params.orderId);
    if (!order || order.customer_id !== customer.id) {
      res.status(404).json({ error: 'ORDER_NOT_FOUND' });
      return;
    }
    res.json({
      order: {
        id: order.id,
        status: order.status,
        channel: order.channel,
        amountCents: order.amount_cents,
        currency: order.currency,
        qrcode: order.qrcode_url,
        paymentLink: order.payment_link,
        prepayId: order.prepay_id,
        providerTransactionId: order.provider_transaction_id,
        paidAt: order.paid_at,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      },
      quota: summarizeQuota(db, customer.id),
    });
  });

  return router;
};
