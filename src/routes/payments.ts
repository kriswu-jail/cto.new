import type { Router } from 'express';
import express from 'express';
import type Database from 'better-sqlite3';
import { config } from '../config';
import { createRateLimiter } from '../middleware/rate-limit';
import { handleAlipayCallback, handleWechatCallback } from '../services/payment-service';

const wechatParser = express.raw({ type: '*/*' });
const formParser = express.urlencoded({ extended: false });

export const createPaymentsRouter = (db: Database.Database): Router => {
  const router = express.Router();
  const rateLimit = createRateLimiter({ windowMs: 60_000, max: config.webhookRateLimitPerMinute });

  const handleWechatNotify = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const bodyBuffer = req.body as Buffer;
      const bodyText = bodyBuffer.toString('utf8');
      handleWechatCallback(db, req.headers, bodyText);
      res.json({ code: 'SUCCESS', message: 'OK' });
    } catch (error) {
      next(error);
    }
  };

  router.post('/wechat/native/notify', wechatParser, rateLimit, handleWechatNotify);
  router.post('/wechat/jsapi/notify', wechatParser, rateLimit, handleWechatNotify);

  router.post('/alipay/pc/notify', formParser, rateLimit, (req, res, next) => {
    try {
      handleAlipayCallback(db, req.body as Record<string, string | undefined>);
      res.send('success');
    } catch (error) {
      next(error);
    }
  });

  router.post('/alipay/f2f/notify', formParser, rateLimit, (req, res, next) => {
    try {
      handleAlipayCallback(db, req.body as Record<string, string | undefined>);
      res.send('success');
    } catch (error) {
      next(error);
    }
  });

  return router;
};
