import { NextRequest, NextResponse } from 'next/server';

const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

export async function POST(request: NextRequest) {
  const body = await request.text();
  const errors: string[] = [];

  try {
    for (const endpoint of overpassEndpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body,
        });
        const text = await response.text();
        if (response.ok) {
          return new NextResponse(text, {
            status: response.status,
            headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
          });
        }
        errors.push(`${endpoint}: ${response.status}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'network error';
        errors.push(`${endpoint}: ${message}`);
      }
    }

    return NextResponse.json(
      { error: 'All Overpass endpoints failed', details: errors },
      { status: 502 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Overpass request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
