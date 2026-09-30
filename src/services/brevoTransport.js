// https://developers.brevo.com/reference/send-transac-email
export function createBrevoTransport({ apiKey, fetchImpl = globalThis.fetch }) {
  return { async sendMail(payload) {
    if (!apiKey) throw new Error('BREVO_API_KEY ausente.');
    const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: payload.from }, to: [{ email: payload.to }],
        subject: payload.subject, textContent: payload.text, htmlContent: payload.html })
    });
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error('Resposta JSON invalida da API Brevo.'), { statusCode: response.status }); }
    if (!response.ok) throw Object.assign(new Error(typeof result?.message === 'string' ? result.message : 'API Brevo recusou o envio.'),
      { statusCode: response.status, code: typeof result?.code === 'string' ? result.code : 'BREVO_HTTP_ERROR' });
    if (typeof result?.messageId !== 'string' || !result.messageId.trim()) {
      throw Object.assign(new Error('API Brevo nao confirmou messageId.'), { statusCode: response.status });
    }
    return { accepted: [payload.to], messageId: result.messageId, statusCode: response.status };
  } };
}
