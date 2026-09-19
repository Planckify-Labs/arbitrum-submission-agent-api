import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net'
import { NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { loadAgentCards } from './agents/loadAgentCards'
import { assertRegistryInvariants } from './agents/registry'
import { AppModule } from './app.module'
import { TOOL_REGISTRY } from './tools/registry'
import { enabledResources } from './x402/catalog'

// Node 22's Happy-Eyeballs per-address connect attempt defaults to 250ms
// (Node 26: 500ms). A bare TCP handshake to Deepgram's US edge takes
// 300–450ms from SE Asia, so every /chat/transcribe upstream call died
// with `fetch failed` → AggregateError(ETIMEDOUT, ENETUNREACH) before the
// socket ever opened. Give each address attempt a realistic budget; the
// overall call is still bounded by each fetch's own AbortSignal.
setDefaultAutoSelectFamilyAttemptTimeout(2_000)

async function bootstrap() {
  // Multi-agent registry boot — fail loud if cards / manifest / tool
  // registry are out of sync (spec §5, §4.1). Must run before we accept
  // traffic. CLAUDE.md user-facing-error rule: the throw lands here in
  // process logs; users never see the raw violation string.
  loadAgentCards()
  assertRegistryInvariants(Object.keys(TOOL_REGISTRY))

  // Mandatory API Key checks
  const requiredKeys = ['KIMI_K2_API_KEY', 'CHAT_API_KEY', 'DEEPGRAM_API_KEY']
  for (const key of requiredKeys) {
    if (!process.env[key]) {
      throw new Error(
        `${key} is not set. This API key is required for the agent to function.`,
      )
    }
  }

  const fastifyAdapter = new FastifyAdapter({
    // Enable streaming support. 10MB: mobile `POST /chat/respond` carries
    // tool results that echo JSON payloads (e.g. a 75-item opportunity
    // list, an x402 resource body); 1MB was too tight and produced 413s.
    bodyLimit: 10 * 1024 * 1024, // 10MB
  })

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
  )

  // Buffer raw multipart bodies so /chat/transcribe can unwrap the
  // audio part and forward its bytes to Deepgram. The 25MB cap covers
  // ~30min of typical voice-memo audio while keeping a hard ceiling far
  // below Deepgram's 2GB pre-recorded limit.
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(
      'multipart/form-data',
      { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 },
      (_req, body, done) => {
        done(null, body)
      },
    )

  // Enable CORS for streaming
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  })

  const port = process.env.PORT ?? 3000
  await app.listen(port, '0.0.0.0')
  console.log(`Server is running on port ${port}`)
  // x402 catalog visibility (x402-extensibility-spec §4). One line per
  // enabled resource; empty means the agent can't call x402_fetch (no
  // capability in the enum). Resources come exclusively from the DB
  // (Valkey-cached) — seed the table once with `pnpm seed:x402`.
  const x402Resources = enabledResources()
  console.log(
    x402Resources.length
      ? `[x402] catalog (${x402Resources.length}): ${x402Resources
          .map((r) => `${r.id} → ${r.url}`)
          .join(', ')}`
      : '[x402] catalog: EMPTY — seed the X402Resource table (pnpm seed:x402)',
  )
}

bootstrap()
