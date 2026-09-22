// Pino redact filters object keys, but cannot remove secrets embedded in messages/stacks.
export function safeError(error, env = process.env) {
  const secrets = new Set();
  const add = value => {
    if (typeof value !== 'string' || !value) return;
    secrets.add(value);
    secrets.add(encodeURIComponent(value));
    secrets.add(JSON.stringify(value).slice(1, -1));
  };
  for (const [key, value] of Object.entries(env)) {
    if (/secret|password|passwd|senha|token|credential|(?:^|_)key|api_?key|private_?key|authorization|cookie|database.*url|connection_string|dsn|pguser|pgpassword/i.test(key)) add(value);
    if (typeof value === 'string' && /url|uri/i.test(key)) {
      try {
        const url = new URL(value);
        if (url.password || /^postgres/.test(url.protocol)) {
          add(value);
          for (const part of [url.username, url.password]) {
            add(part);
            try { add(decodeURIComponent(part)); } catch { /* Malformed encoding. */ }
          }
        }
      } catch { /* Invalid URLs are still redacted by their environment key. */ }
    }
  }
  const values = [...secrets].sort((a, b) => b.length - a.length);
  const clean = value => {
    if (value == null) return undefined;
    let text = String(value);
    // Remove complete database URLs, including ones not present in process.env.
    text = text.replace(/postgres(?:ql)?:\/\/[^\s<>"']+/gi, '[REDACTED]');
    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]*@[^\s<>"']+/gi, '[REDACTED]');
    text = text.replace(/\bBearer\s+[^\s,"']+/gi, 'Bearer [REDACTED]');
    text = text.replace(/\b((?:[\w-]*(?:password|passwd|senha|secret|token|api_?key|private_?key)[\w-]*|DATABASE(?:_DIRECT)?_URL)["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[REDACTED]');
    for (const secret of values) text = text.split(secret).join('[REDACTED]');
    return text;
  };
  return {
    name: clean(error?.name || 'Error'),
    message: clean(error?.message ?? 'Erro sem mensagem'),
    code: clean(error?.code),
    stack: clean(error?.stack)
  };
}
