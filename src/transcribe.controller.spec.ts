import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { Test, type TestingModule } from '@nestjs/testing'
import { ApiKeyGuard } from './guards/api-key.guard'
import { TranscribeController } from './transcribe.controller'

const TEST_API_KEY = 'test-api-key'
const DEEPGRAM_KEY = 'dg-test-key'
const BOUNDARY = '----ExpoFormBoundaryTest'

// A few bytes that look like an m4a header followed by values that would
// corrupt a naive text-mode parse (NUL, CR/LF, `--`). The controller must
// forward them byte-for-byte.
const AUDIO = Buffer.from([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0xff,
  0x00, 0x0d, 0x0a, 0x2d, 0x2d, 0x0d, 0x0a,
])

type Part = {
  name: string
  data: Buffer | string
  filename?: string
  type?: string
}

/** Build a multipart body the way React Native's FormData does. */
function multipart(parts: Part[]): Buffer {
  const chunks: Buffer[] = []
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`
    const type = part.type ? `Content-Type: ${part.type}\r\n` : ''
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n`,
      ),
      Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data),
      Buffer.from('\r\n'),
    )
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`))
  return Buffer.concat(chunks)
}

const audioPart: Part = {
  name: 'file',
  filename: 'recording.m4a',
  type: 'audio/m4a',
  data: AUDIO,
}

/** Minimal `/v1/listen` success payload in Deepgram's real shape. */
function deepgramJson(
  channel: Record<string, unknown>,
  metadata: Record<string, unknown> = { request_id: 'req-1', duration: 2.5 },
) {
  return new Response(
    JSON.stringify({ metadata, results: { channels: [channel] } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('TranscribeController (Deepgram Nova-3)', () => {
  let app: NestFastifyApplication
  let env: Record<string, string | undefined>
  let fetchMock: jest.Mock
  const realFetch = global.fetch

  beforeAll(async () => {
    env = { CHAT_API_KEY: TEST_API_KEY, DEEPGRAM_API_KEY: DEEPGRAM_KEY }

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TranscribeController],
      providers: [
        ApiKeyGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => env[key] ?? fallback,
          },
        },
      ],
    }).compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    )
    // Same raw-buffer parser main.ts registers for this route.
    app
      .getHttpAdapter()
      .getInstance()
      .addContentTypeParser(
        'multipart/form-data',
        { parseAs: 'buffer' },
        (_req, body, done) => {
          done(null, body)
        },
      )
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    env.DEEPGRAM_API_KEY = DEEPGRAM_KEY
    env.DEEPGRAM_LANGUAGE = undefined
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  function post(
    payload: Buffer | string,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/chat/transcribe',
      headers: {
        'x-api-key': TEST_API_KEY,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        ...headers,
      },
      payload,
    })
  }

  async function upstreamCall() {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const body = init.body as Blob
    return {
      url,
      headers: init.headers as Record<string, string>,
      bytes: Buffer.from(await body.arrayBuffer()),
    }
  }

  it('unwraps the file part and posts its raw bytes to Nova-3 multilingual', async () => {
    fetchMock.mockResolvedValueOnce(
      deepgramJson({
        alternatives: [
          {
            transcript: 'Send 50 dollars a mi hermano.',
            languages: ['en', 'es'],
          },
        ],
      }),
    )

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      text: 'Send 50 dollars a mi hermano.',
      language: 'en',
      duration: 2.5,
    })

    const { url, headers, bytes } = await upstreamCall()
    expect(url.origin + url.pathname).toBe('https://api.deepgram.com/v1/listen')
    expect(url.searchParams.get('model')).toBe('nova-3')
    expect(url.searchParams.get('language')).toBe('multi')
    expect(url.searchParams.get('smart_format')).toBe('true')
    expect(headers.Authorization).toBe(`Token ${DEEPGRAM_KEY}`)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    // Raw audio only — no multipart framing, no byte mangling.
    expect(bytes.equals(AUDIO)).toBe(true)
  })

  it('honours DEEPGRAM_LANGUAGE and surfaces detected_language in single-language mode', async () => {
    env.DEEPGRAM_LANGUAGE = 'id'
    fetchMock.mockResolvedValueOnce(
      deepgramJson({
        detected_language: 'id',
        alternatives: [{ transcript: 'Kirim lima puluh ribu.' }],
      }),
    )

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(201)
    expect(res.json().language).toBe('id')
    const { url } = await upstreamCall()
    expect(url.searchParams.get('language')).toBe('id')
  })

  it('returns an empty transcript for silence rather than failing', async () => {
    fetchMock.mockResolvedValueOnce(
      deepgramJson({ alternatives: [{ transcript: '', languages: [] }] }),
    )

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ text: '', duration: 2.5 })
  })

  it('ignores extra form fields and picks the `file` part', async () => {
    fetchMock.mockResolvedValueOnce(
      deepgramJson({ alternatives: [{ transcript: 'ok' }] }),
    )

    const res = await post(
      multipart([{ name: 'note', data: 'ignored' }, audioPart]),
    )

    expect(res.statusCode).toBe(201)
    const { bytes } = await upstreamCall()
    expect(bytes.equals(AUDIO)).toBe(true)
  })

  it('500 stt_not_configured when DEEPGRAM_API_KEY is unset', async () => {
    env.DEEPGRAM_API_KEY = undefined

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(500)
    expect(res.json().code).toBe('stt_not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400 invalid_content_type for non-multipart bodies', async () => {
    const res = await post(JSON.stringify({ file: 'x' }), {
      'content-type': 'application/json',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('invalid_content_type')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400 missing_file when the multipart has no `file` part', async () => {
    const res = await post(multipart([{ name: 'note', data: 'hello' }]))

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('missing_file')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400 missing_file when the file part is empty', async () => {
    const res = await post(multipart([{ ...audioPart, data: Buffer.alloc(0) }]))

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('missing_file')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes a Deepgram 429 through as 429', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"err_code":"TOO_MANY_REQUESTS"}', { status: 429 }),
    )

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(429)
    expect(res.json()).toMatchObject({
      code: 'stt_upstream_error',
      status: 429,
    })
  })

  it('maps other Deepgram failures to 502', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"err_code":"INVALID_AUTH"}', { status: 401 }),
    )

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({
      code: 'stt_upstream_error',
      status: 401,
    })
  })

  it('502 stt_invalid_response when Deepgram returns no transcript', async () => {
    fetchMock.mockResolvedValueOnce(deepgramJson({ alternatives: [] }))

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(502)
    expect(res.json().code).toBe('stt_invalid_response')
  })

  it('502 stt_upstream_error when the fetch itself fails (network/timeout)', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'TimeoutError'),
    )

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(502)
    expect(res.json().code).toBe('stt_upstream_error')
  })

  it('logs the transport cause codes hidden inside `fetch failed`', async () => {
    // What undici throws on Node 22 when Happy Eyeballs gives up on every
    // address — the shape that hid the real ETIMEDOUT behind `TypeError`.
    const cause = new AggregateError([
      Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }),
    ])
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed', { cause }))
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)

    const res = await post(multipart([audioPart]))

    expect(res.statusCode).toBe(502)
    expect(res.json().code).toBe('stt_upstream_error')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('err=TypeError(ETIMEDOUT,ENETUNREACH)'),
    )
    warn.mockRestore()
  })

  it('401 without the chat API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/transcribe',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: multipart([audioPart]),
    })

    expect(res.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
