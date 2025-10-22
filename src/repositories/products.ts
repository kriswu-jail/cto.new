import type Database from 'better-sqlite3';
import type { Product } from '../types';

export const listActiveProducts = (db: Database.Database): Product[] => {
  const statement = db.prepare<Product>(
    'SELECT * FROM products WHERE is_active = 1 AND price_cents > 0 ORDER BY sort_order ASC'
  );
  return statement.all();
};

export const findProductById = (db: Database.Database, id: string): Product | undefined => {
  const statement = db.prepare<Product>('SELECT * FROM products WHERE id = ? AND is_active = 1');
  return statement.get(id);
};
