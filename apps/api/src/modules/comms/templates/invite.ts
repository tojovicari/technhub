import { wrapEmailLayout } from './layout.js';

export interface InvitePayload {
  email: string;
  invite_token: string;
  expires_at: string;
}

export function renderInvite(data: InvitePayload) {
  const base = process.env.APP_BASE_URL ?? 'https://app.moasy.tech';
  const url  = `${base}/register/invite?token=${encodeURIComponent(data.invite_token)}`;

  return {
    subject: 'You have been invited to moasy.tech',
    body: wrapEmailLayout(`
      <p>Hi,</p>
      <p>You have been invited to join <strong>moasy.tech</strong>.</p>
      <p style="margin-top:24px;">
        <a href="${url}" style="background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Accept Invitation
        </a>
      </p>
      <p>This link expires on <strong>${data.expires_at}</strong>.</p>
      <p>If you did not expect this email, you can safely ignore it.</p>
    `),
  };
}
