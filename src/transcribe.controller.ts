import {
  BadRequestException,
  Controller,
  HttpException,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiKeyGuard } from './guards/api-key.guard'

/**
 * Voice → text for the mobile agent input, backed by Deepgram Nova-3.
 *
 * Mobile posts `multipart/form-data` with a single `file` field (the
 * m4a / mp4 voice memo) and gets back `{ text, language?, duration? }`.
 * That wire contract is unchanged from the previous provider, so no
 * mobile release is needed to swap STT vendors.
 *
 * Deepgram's pre-recorded endpoint takes the raw audio bytes as the
 * request body (not multipart), so we unwrap the `file` part here and
 * forward only its bytes. The audio is never inspected or logged.
 *
 * Docs:
 *   https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
 *   https://developers.deepgram.com/docs/models-languages-overview#nova-3
 *   https://developers.deepgram.com/docs/multilingual-code-switching
 */

const DEEPGRAM_LISTEN_URL = 'https://api.deepgram.com/v1/listen'
const DEEPGRAM_MODEL = 'nova-3'
/**
 * `multi` enables Nova-3 multilingual code-switching (en, es, fr, de, hi,
 * ru, pt, ja, it, nl). Indonesian is NOT in that set — it is only served
 * as a monolingual Nova-3 language — so `DEEPGRAM_LANGUAGE=id` is the
 * escape hatch if `multi` proves inaccurate for Bahasa voice memos.
 */
const DEFAULT_LANGUAGE = 'multi'
/**
 * Mirrors the official SDK: bytes go up as `application/octet-stream`
 * and Deepgram sniffs the container (m4a/mp4/wav/…), so the mobile's
 * non-standard `audio/m4a` mime type never reaches the provider.
 */
const UPSTREAM_CONTENT_TYPE = 'application/octet-stream'
/** Same default as the official SDK. Deepgram itself 504s at 10 min. */
const UPSTREAM_TIMEOUT_MS = 60_000

type TranscribeResult = {
  text: string
  language?: string
  duration?: number
}

/** The subset of the `/v1/listen` response we read. */
type DeepgramListenResponse = {
  metadata?: { request_id?: string; duration?: number }
  results?: {
    channels?: Array<{
      /** Set when `detect_language=true` (single-language mode). */
      detected_language?: string
      alternatives?: Array<{
        transcript?: string
        confidence?: number
        /** Set when `language=multi` — every language heard, dominant first. */
        languages?: string[]
      }>
    }>
  }
}

type RawMultipartRequest = {
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

@UseGuards(ApiKeyGuard)
@Controller('chat')
export class TranscribeController {
  private readonly logger = new Logger(TranscribeController.name)

  constructor(private readonly config: ConfigService) {}

  @Post('transcribe')
  async transcribe(@Req() req: RawMultipartRequest): Promise<TranscribeResult> {
    const apiKey = this.config.get<string>('DEEPGRAM_API_KEY')
    if (!apiKey) {
      throw new HttpException(
        {
          code: 'stt_not_configured',
          message: 'DEEPGRAM_API_KEY is not set on the server.',
        },
        500,
      )
    }

    const rawContentType = req.headers['content-type']
    const contentType = Array.isArray(rawContentType)
      ? rawContentType[0]
      : rawContentType
    if (!contentType || !contentType.startsWith('multipart/form-data')) {
      throw new BadRequestException({
        code: 'invalid_content_type',
        message: 'Expected multipart/form-data with a file field.',
      })
    }

    // The raw multipart body is buffered by the per-route content-type
    // parser registered in `main.ts`.
    const body = req.body
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException({
        code: 'empty_body',
        message: 'Request body is empty.',
      })
    }

    const audio = await extractAudioPart(body, contentType)

    const url = new URL(DEEPGRAM_LISTEN_URL)
    url.searchParams.set('model', DEEPGRAM_MODEL)
    url.searchParams.set(
      'language',
      this.config.get<string>('DEEPGRAM_LANGUAGE') || DEFAULT_LANGUAGE,
    )
    url.searchParams.set('smart_format', 'true')

    let upstream: Response
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': UPSTREAM_CONTENT_TYPE,
        },
        body: audio,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (err) {
      // Never log the audio or the key — only shape/outcome (Guard F).
      this.logger.warn(
        `deepgram unreachable bytes=${audio.size} err=${describeFetchError(err)}`,
      )
      throw new HttpException(
        {
          code: 'stt_upstream_error',
          message: 'Speech-to-text provider unreachable.',
        },
        502,
      )
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '')
      this.logger.warn(
        `deepgram upstream failed status=${upstream.status} bytes=${audio.size}`,
      )
      throw new HttpException(
        { code: 'stt_upstream_error', status: upstream.status, detail },
        upstream.status === 429 ? 429 : 502,
      )
    }

    const json = (await upstream
      .json()
      .catch(() => null)) as DeepgramListenResponse | null
    const channel = json?.results?.channels?.[0]
    const alternative = channel?.alternatives?.[0]
    if (!channel || typeof alternative?.transcript !== 'string') {
      this.logger.warn(
        `deepgram returned no transcript request_id=${json?.metadata?.request_id ?? 'unknown'}`,
      )
      throw new HttpException(
        {
          code: 'stt_invalid_response',
          message: 'Upstream returned no transcript.',
        },
        502,
      )
    }

    return {
      text: alternative.transcript,
      language: channel.detected_language ?? alternative.languages?.[0],
      duration: json?.metadata?.duration,
    }
  }
}

/**
 * undici wraps every transport failure as `TypeError: fetch failed` and
 * hides the useful part (ETIMEDOUT, ENOTFOUND, cert errors, …) in
 * `cause` — often an AggregateError with one entry per address tried.
 * Flatten that into one loggable string. Timeouts from our own
 * AbortSignal arrive as a DOMException named `TimeoutError`.
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause
  if (!(cause instanceof Error)) return err.name
  const codes =
    cause instanceof AggregateError
      ? cause.errors.map((e) => (e as { code?: string }).code ?? e.name)
      : [(cause as { code?: string }).code ?? cause.name]
  return `${err.name}(${codes.join(',')})`
}

/**
 * Pull the `file` part out of the buffered multipart body using the
 * runtime's own parser (undici) — no extra dependency, and the bytes
 * come back untouched.
 */
async function extractAudioPart(
  body: Buffer,
  contentType: string,
): Promise<File> {
  let form: FormData
  try {
    // Buffer is a valid undici body at runtime; the cast only papers over
    // @types/node's `ArrayBufferLike` vs `BodyInit` mismatch.
    form = await new Response(body as unknown as BodyInit, {
      headers: { 'content-type': contentType },
    }).formData()
  } catch {
    throw new BadRequestException({
      code: 'invalid_multipart',
      message: 'Could not parse multipart body.',
    })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new BadRequestException({
      code: 'missing_file',
      message: 'Expected a non-empty `file` field.',
    })
  }
  return file
}
