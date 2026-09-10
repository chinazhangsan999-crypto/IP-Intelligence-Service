import { HttpError } from '../http/HttpError.js';
import { createRequestSignature, signaturesMatch } from './hmac.js';

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const NONCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const DUMMY_SECRET = 'invalid-client-timing-equalization-key';

function oneHeader(headers, name) {
  const value = headers[name];
  return typeof value === 'string' ? value : '';
}

export class RequestAuthenticator {
  constructor({
    clientRepository,
    clientService,
    replayGuard,
    rateLimiter,
    auditRepository,
    logger,
    clockSkewSeconds,
    now = Date.now,
  }) {
    this.clientRepository = clientRepository;
    this.clientService = clientService;
    this.replayGuard = replayGuard;
    this.rateLimiter = rateLimiter;
    this.auditRepository = auditRepository;
    this.logger = logger;
    this.clockSkewSeconds = clockSkewSeconds;
    this.now = now;
    this.lastUsedTouches = new Map();
  }

  audit(event) {
    if (!this.auditRepository) return;
    Promise.resolve().then(() => this.auditRepository.recordAudit(event)).catch((error) => {
      this.logger.error('authentication_audit_failed', { error });
    });
  }

  reject(statusCode, code, message, audit) {
    this.audit({ outcome: 'rejected', ...audit });
    throw new HttpError(statusCode, code, message);
  }

  touchClient(record) {
    const nowMs = this.now();
    const lastTouch = this.lastUsedTouches.get(record.id) || 0;
    if (nowMs - lastTouch < 60_000) return;
    this.lastUsedTouches.set(record.id, nowMs);
    Promise.resolve().then(() => this.clientRepository.touchLastUsed(record.id)).catch((error) => {
      this.logger.error('client_last_used_update_failed', {
        api_client_id: record.id,
        error,
      });
    });
  }

  async authenticate({ headers, method, requestTarget, rawBody, requestId }) {
    const clientId = oneHeader(headers, 'x-client-id');
    const timestampRaw = oneHeader(headers, 'x-timestamp');
    const nonce = oneHeader(headers, 'x-nonce');
    const signature = oneHeader(headers, 'x-signature');
    const auditBase = {
      eventType: 'authentication_failed',
      requestId,
      metadata: { reason: 'invalid_credentials' },
    };

    if (!clientId || !timestampRaw || !nonce || !signature) {
      this.reject(401, 'AUTH_REQUIRED', 'Authentication headers are required', auditBase);
    }
    if (!CLIENT_ID_PATTERN.test(clientId)
      || !/^\d{10,11}$/.test(timestampRaw)
      || !NONCE_PATTERN.test(nonce)
      || !SIGNATURE_PATTERN.test(signature)) {
      this.reject(401, 'INVALID_SIGNATURE', 'Invalid request signature', auditBase);
    }

    const timestamp = Number(timestampRaw);
    const nowSeconds = Math.floor(this.now() / 1_000);
    if (!Number.isSafeInteger(timestamp)
      || Math.abs(nowSeconds - timestamp) > this.clockSkewSeconds) {
      this.reject(401, 'INVALID_SIGNATURE', 'Invalid request signature', {
        ...auditBase,
        metadata: { reason: 'timestamp_out_of_window' },
      });
    }

    const record = await this.clientRepository.findAuthenticationRecord(clientId);
    const signatureInput = { method, requestTarget, timestamp: timestampRaw, nonce, rawBody };
    if (!record) {
      const dummyExpected = createRequestSignature(DUMMY_SECRET, signatureInput);
      signaturesMatch(signature, dummyExpected);
      this.reject(401, 'INVALID_SIGNATURE', 'Invalid request signature', {
        ...auditBase,
        metadata: { reason: 'unknown_client' },
      });
    }

    const secret = this.clientService.decryptAuthenticationSecret(record);
    const expectedSignature = createRequestSignature(secret, signatureInput);
    if (!signaturesMatch(signature, expectedSignature)) {
      this.reject(401, 'INVALID_SIGNATURE', 'Invalid request signature', {
        ...auditBase,
        apiClientId: record.id,
        metadata: { reason: 'signature_mismatch' },
      });
    }

    if (record.status !== 'active') {
      this.reject(403, 'CLIENT_DISABLED', 'Client is disabled', {
        ...auditBase,
        apiClientId: record.id,
        metadata: { reason: 'client_disabled' },
      });
    }

    try {
      if (!this.replayGuard.consume(clientId, nonce)) {
        this.reject(409, 'REPLAY_DETECTED', 'Request nonce has already been used', {
          ...auditBase,
          apiClientId: record.id,
          eventType: 'replay_detected',
          metadata: { reason: 'nonce_reused' },
        });
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      this.logger.error('nonce_store_failed', { error });
      throw new HttpError(503, 'SERVICE_NOT_READY', 'Authentication replay protection is unavailable');
    }

    const rate = this.rateLimiter.consume(clientId, record.rate_limit_per_minute);
    if (!rate.allowed) {
      this.audit({
        apiClientId: record.id,
        eventType: 'rate_limited',
        outcome: 'rejected',
        requestId,
        metadata: { reason: 'client_rate_limit' },
      });
      throw new HttpError(429, 'RATE_LIMITED', 'Client rate limit exceeded', {
        headers: {
          'retry-after': String(rate.retryAfterSeconds),
          'x-rate-limit-limit': String(rate.limit),
          'x-rate-limit-remaining': '0',
          'x-rate-limit-reset': String(rate.resetAfterSeconds),
        },
      });
    }

    this.touchClient(record);
    return {
      client: {
        id: record.id,
        client_id: record.client_id,
        display_name: record.display_name,
        rate_limit_per_minute: record.rate_limit_per_minute,
      },
      rate_limit_limit: rate.limit,
      rate_limit_remaining: rate.remaining,
      rate_limit_reset: rate.resetAfterSeconds,
    };
  }
}
