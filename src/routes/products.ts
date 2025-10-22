import type { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import { listActiveProducts } from '../repositories/products';

export const createProductsRouter = (db: Database.Database): Router => {
  const router = express.Router();

  router.get('/', (req, res) => {
    const products = listActiveProducts(db).map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: product.price_cents,
      currency: product.currency,
      credits: product.credits,
      concurrencyLimit: product.concurrency_limit,
      singleFileBytes: product.single_file_bytes,
      channelSupport: product.channel_support,
    }));
    res.json({ products });
  });

  return router;
};
