import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get('city') || '';
  if (!city.trim()) {
    return NextResponse.json({ error: 'City is required' }, { status: 400 });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=uk&q=${encodeURIComponent(city)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Local CRM lead generation' },
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Geocode request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
