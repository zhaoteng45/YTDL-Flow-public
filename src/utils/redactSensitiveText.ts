const REDACTED = '<REDACTED>';

const URL_USERINFO = /(https?:\/\/)[^/\s:@]+(?::[^@\s/]*)?@/gi;
const SENSITIVE_QUERY_VALUE = /([?&](?:access_token|api_key|apikey|auth|authorization|password|passwd|po_token|secret|session(?:id)?|sig|signature|token|visitor_data)=)([^&#\s]+)/gi;
const SENSITIVE_ASSIGNMENT = /\b((?:access_token|api_key|apikey|authorization|password|passwd|po_token|secret|session(?:id)?|sig|signature|token|visitor_data)\s*[=:]\s*)([^;&\r\n]+)/gi;
const SENSITIVE_HEADER = /\b((?:authorization|cookie|x-api-key)\s*:\s*)([^\r\n]+)/gi;
const COOKIE_TEMP_FILE = /(?:[A-Za-z]:)?[^\s"'<>|]*ytdl_flow_cookies_[^\s"'<>|]+/gi;
const PROFILE_PATH = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\r\n"'<>|]+/gi;
const TEMP_PATH = /[A-Za-z]:[\\/]+(?:Windows[\\/]+)?Temp[\\/]+[^\s"'<>|]+/gi;

/**
 * Redacts credentials and bearer-like values from diagnostic text.
 * Execution inputs remain untouched; this helper is only for logs/errors/export surfaces.
 */
export function redactSensitiveText(input: string): string {
  if (!input) return input;

  return input
    .replace(COOKIE_TEMP_FILE, '<REDACTED-COOKIE-PATH>')
    .replace(PROFILE_PATH, '<REDACTED-PROFILE>')
    .replace(TEMP_PATH, '<REDACTED-TEMP-PATH>')
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(SENSITIVE_QUERY_VALUE, `$1${REDACTED}`)
    .replace(SENSITIVE_HEADER, `$1${REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT, `$1${REDACTED}`);
}
