import { randomUUID } from 'crypto';

export const generateId = () => randomUUID();

export const nowISOString = () => new Date().toISOString();

export const toCents = (yuan: number) => Math.round(yuan * 100);

export const parseJSONSafe = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return null;
  }
};
