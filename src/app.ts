import express from 'express';
import cors from 'cors';
import path from 'path';
import { getDatabase } from './db';
import { createCustomersRouter } from './routes/customers';
import { createProductsRouter } from './routes/products';
import { createOrdersRouter } from './routes/orders';
import { createPaymentsRouter } from './routes/payments';
import { createMetaRouter } from './routes/meta';
import { logger } from './logger';

export const createApp = () => {
  const app = express();
  const db = getDatabase();

  app.use(cors());
  app.use((req, _res, next) => {
    req.app.locals.db = db;
    next();
  });

  app.use('/api/customers', createCustomersRouter(db));
  app.use('/api/products', createProductsRouter(db));
  app.use('/api/orders', createOrdersRouter(db));
  app.use('/api/payments', createPaymentsRouter(db));
  app.use('/api/meta', createMetaRouter());

  const publicDir = path.join(process.cwd(), 'public');
  app.use('/payments', express.static(publicDir));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { message: err.message });
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  });

  return app;
};
