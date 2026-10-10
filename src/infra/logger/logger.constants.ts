export const HEADER_REQUEST_ID = 'x-request-id';

export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.body.password',
  'req.body.oldPassword',
  'req.body.newPassword',
  'req.body.otp',
  '*.password',
  '*.passwordHash',
  '*.otp',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
];

export const LOG_REDACT_CENSOR = '***';

export const IGNORED_LOG_URLS = ['/health/live', '/health/ready', '/metrics'];

export const DEFAULT_LOG_LEVEL = 'info';
