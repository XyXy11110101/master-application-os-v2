/** Provider-specific options must never leak to an unrelated compatible API. */
export function isOfficialDeepSeek(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com' &&
      !url.port && !url.username && !url.password;
  } catch { return false; }
}
