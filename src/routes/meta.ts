import type { Router } from 'express';
import express from 'express';
import { config } from '../config';

export const createMetaRouter = (): Router => {
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.json({
      sandbox: config.sandbox,
      support: config.support,
    });
  });
  return router;
};
