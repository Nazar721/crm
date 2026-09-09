import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runPipeline } from '@/lib/lead-generator/pipeline';
import { registerRun, unregisterRun } from '@/lib/lead-generator/runRegistry';
import { PipelineEvent } from '@/lib/lead-generator/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 660;

const bodySchema = z.object({
  requestId: z.string().trim().min(4).max(64),
  config: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return Response.json({ error: 'requestId and config are required' }, { status: 400 });
  }
  const { requestId, config } = parsedBody.data;

  const runController = new AbortController();
  registerRun(requestId, runController);

  const onClientDisconnect = () => runController.abort();
  request.signal.addEventListener('abort', onClientDisconnect, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const sendEvent = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
          runController.abort();
        }
      };

      try {
        await runPipeline(config, runController.signal, sendEvent);
      } finally {
        closed = true;
        request.signal.removeEventListener('abort', onClientDisconnect);
        unregisterRun(requestId);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // client disconnected: stop all server-side work immediately
      runController.abort();
      unregisterRun(requestId);
      request.signal.removeEventListener('abort', onClientDisconnect);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
