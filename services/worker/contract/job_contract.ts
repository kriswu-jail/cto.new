// Job contract (TypeScript) to be used by Node API
import crypto from 'node:crypto';

export type TaskType =
| 'office_to_pdf'
| 'pdf_to_images'
| 'ocr'
| 'extract_tables'
| 'excel_to_csv'
| 'zip_batch_clean';

export interface Artifact {
  kind: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface OfficeToPdfPayload { source_url: string }
export interface PdfToImagesPayload { source_url: string; dpi?: number }
export interface OCRPayload { source_url: string; lang?: string }
export interface ExtractTablesPayload { source_url: string; flavor?: 'lattice' | 'stream'; pages?: string }
export interface ExcelToCsvPayload { source_url: string; sheet?: number | string | null }
export interface ZipBatchCleanPayload {
  source_url: string;
  allowed_extensions?: string[];
  replacements?: Record<string, string>;
  max_total_size_mb?: number;
}

export type Payload =
  | OfficeToPdfPayload
  | PdfToImagesPayload
  | OCRPayload
  | ExtractTablesPayload
  | ExcelToCsvPayload
  | ZipBatchCleanPayload;

export interface JobRequest {
  id?: string;
  type: TaskType;
  payload: Payload;
}

export interface JobResult {
  id?: string;
  type: TaskType;
  status: 'ok' | 'error';
  message?: string;
  artifacts: Artifact[];
}

export function computeSignature(secret: string, timestamp: string, body: string | Buffer) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.`);
  hmac.update(typeof body === 'string' ? Buffer.from(body) : body);
  return hmac.digest('hex');
}

