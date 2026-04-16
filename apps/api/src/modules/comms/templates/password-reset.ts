export interface PasswordResetPayload {
  email: string;
  reset_token: string;
  expires_at: string;
}

export function renderPasswordReset(data: PasswordResetPayload) {
  const base = process.env.APP_BASE_URL ?? 'https://app.moasy.tech';
  const url  = `${base}/reset-password?token=${encodeURIComponent(data.reset_token)}`;

  return {
    subject: 'Reset your moasy.tech password',
    body: `
      <p>Hi,</p>
      <p>We received a request to reset the password for your <strong>moasy.tech</strong> account associated with ${data.email}.</p>
      <p>
        <a href="${url}" style="background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Reset password
        </a>
      </p>
      <p>This link expires on <strong>${data.expires_at}</strong>.</p>
      <p>If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
    `,
  };
}
