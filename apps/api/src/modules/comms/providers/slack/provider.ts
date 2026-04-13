import type { ChannelProvider, OutboundMessage } from '../../channel-provider.js';

export const slackProvider: ChannelProvider = {
  channel: 'slack',

  async send(_message: OutboundMessage): Promise<void> {
    // TODO: implement Slack provider (e.g. via Slack Incoming Webhooks or Bot API)
    console.warn('[comms] SlackProvider is not implemented — message not sent');
  },
};
