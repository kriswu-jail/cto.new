import { config } from './config';
import { createApp } from './app';
import { logger } from './logger';
import { getDatabase } from './db';
import { reconcilePendingOrders } from './services/payment-service';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port}`);
});

const db = getDatabase();

const reconciliationInterval = Number.parseInt(process.env.RECONCILIATION_INTERVAL_MS ?? '60000', 10);

const reconciliationTimer = setInterval(() => {
  reconcilePendingOrders(db).catch((error) => {
    logger.error('Reconciliation job failed', { message: (error as Error).message });
  });
}, reconciliationInterval);

const shutdown = () => {
  clearInterval(reconciliationTimer);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
