export function emailProvider(config) {
  if (typeof config.BREVO_API_KEY === 'string' && config.BREVO_API_KEY.trim()) return 'brevo_api';
  return config.EMAIL_PROVIDER || (config.RESEND_API_KEY ? 'resend' : 'smtp');
}

export function emailFields(config) {
  const provider = emailProvider(config);
  if (provider === 'brevo_api') return ['EMAIL_FROM', 'BREVO_API_KEY'];
  if (provider === 'resend') return ['EMAIL_FROM', 'RESEND_API_KEY'];
  return ['EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
}
