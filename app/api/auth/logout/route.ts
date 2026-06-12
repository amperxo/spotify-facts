import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requestOrigin } from '@/lib/origin';

export async function GET(request: Request) {
  const origin = requestOrigin(request);

  const cookieStore = await cookies();
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');

  return NextResponse.redirect(`${origin}/`);
}
