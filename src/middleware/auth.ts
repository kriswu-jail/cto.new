import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { findCustomerByAccessToken } from '../repositories/customers';
import type { Customer } from '../types';

export interface RequestWithCustomer extends Request {
  customer: Customer;
}

export const authenticate = (db: Database.Database) => (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  const customer = findCustomerByAccessToken(db, token);
  if (!customer) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  (req as RequestWithCustomer).customer = customer;
  next();
};
