export interface EmailVerificationPayload {
  email: string;
  verification_token: string;
  expires_at: string;
}

export function renderEmailVerification(data: EmailVerificationPayload) {
  const base = process.env.APP_BASE_URL ?? 'https://app.moasy.tech';
  const url  = `${base}/verify-email?token=${encodeURIComponent(data.verification_token)}`;

  return {
    subject: 'Confirm your moasy.tech account',
    body: `
      <p>Hi,</p>
      <p>Thanks for signing up for <strong>moasy.tech</strong>. Please confirm your email address to activate your account.</p>
      <p>
        <a href="${url}" style="background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Confirm email address
        </a>
      </p>
      <p>This link expires on <strong>${data.expires_at}</strong>.</p>
      <p>If you did not create an account, you can safely ignore this email.</p>
    `,
  };
}
