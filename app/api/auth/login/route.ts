import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
} from '@/lib/spotify';

export async function GET() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = crypto.randomUUID();

  const cookieStore = await cookies();
  const isProduction = process.env.NODE_ENV === 'production';

  cookieStore.set('pkce_verifier', verifier, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 min — long enough for a slow OAuth dance
  });

  cookieStore.set('oauth_state', state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });

  return NextResponse.redirect(buildAuthUrl(challenge, state));
}
