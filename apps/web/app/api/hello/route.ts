import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true, message: '你好，API 正常工作！' });
}
