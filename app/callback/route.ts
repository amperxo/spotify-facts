import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCodeForTokens } from '@/lib/spotify';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/?error=access_denied`);
  }

  const cookieStore = await cookies();
  const verifier = cookieStore.get('pkce_verifier')?.value;
  const savedState = cookieStore.get('oauth_state')?.value;

  if (!code || !verifier || !state || state !== savedState) {
    return NextResponse.redirect(`${origin}/?error=invalid_callback`);
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, verifier);
  } catch (err) {
    console.error('Token exchange error:', err);
    return NextResponse.redirect(`${origin}/?error=token_exchange_failed`);
  }

  const isProduction = process.env.NODE_ENV === 'production';

  cookieStore.set('access_token', tokens.access_token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: tokens.expires_in,
  });

  cookieStore.set('refresh_token', tokens.refresh_token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 60, // 60 days
  });

  cookieStore.delete('pkce_verifier');
  cookieStore.delete('oauth_state');

  return NextResponse.redirect(`${origin}/`);
}
