import { renderInvite, type InvitePayload } from './invite.js';
import { renderEmailVerification, type EmailVerificationPayload } from './email-verification.js';
import { renderPasswordReset, type PasswordResetPayload } from './password-reset.js';
import { renderSlaBreach, type SlaBreachPayload } from './sla-breach.js';
import { renderDoraDigest, type DoraDigestPayload } from './dora-digest.js';

export interface RenderedMessage {
  subject?: string;
  body: string;
}

type Renderer = (data: Record<string, unknown>) => RenderedMessage;

const templateMap: Record<string, Renderer> = {
  invite:               (d) => renderInvite(d as unknown as InvitePayload),
  'email-verification': (d) => renderEmailVerification(d as unknown as EmailVerificationPayload),
  'password-reset':     (d) => renderPasswordReset(d as unknown as PasswordResetPayload),
  'sla-breach':         (d) => renderSlaBreach(d as unknown as SlaBreachPayload),
  'dora-digest':        (d) => renderDoraDigest(d as unknown as DoraDigestPayload),
};

export function renderTemplate(key: string, data: Record<string, unknown>): RenderedMessage {
  const renderer = templateMap[key];
  if (!renderer) throw new Error(`[comms] Unknown template key: "${key}"`);
  return renderer(data);
}
