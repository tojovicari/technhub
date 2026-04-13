import { renderInvite, type InvitePayload } from './invite.js';
import { renderSlaBreach, type SlaBreachPayload } from './sla-breach.js';
import { renderDoraDigest, type DoraDigestPayload } from './dora-digest.js';

export interface RenderedMessage {
  subject?: string;
  body: string;
}

type Renderer = (data: Record<string, unknown>) => RenderedMessage;

const templateMap: Record<string, Renderer> = {
  invite:       (d) => renderInvite(d as unknown as InvitePayload),
  'sla-breach': (d) => renderSlaBreach(d as unknown as SlaBreachPayload),
  'dora-digest':(d) => renderDoraDigest(d as unknown as DoraDigestPayload),
};

export function renderTemplate(key: string, data: Record<string, unknown>): RenderedMessage {
  const renderer = templateMap[key];
  if (!renderer) throw new Error(`[comms] Unknown template key: "${key}"`);
  return renderer(data);
}
