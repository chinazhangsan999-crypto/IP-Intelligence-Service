export class HttpError extends Error {
  constructor(statusCode, code, message, { details = null, headers = {} } = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}
