import type { ChannelProvider, OutboundMessage } from '../../channel-provider.js';

export const whatsappProvider: ChannelProvider = {
  channel: 'whatsapp',

  async send(_message: OutboundMessage): Promise<void> {
    // TODO: implement WhatsApp provider (e.g. via Meta Cloud API or Twilio)
    console.warn('[comms] WhatsAppProvider is not implemented — message not sent');
  },
};
