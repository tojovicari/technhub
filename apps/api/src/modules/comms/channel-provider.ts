export type Channel = 'email' | 'slack' | 'whatsapp';

export interface OutboundMessage {
  to: string;
  channel: Channel;
  subject?: string;
  body: string;
}

export interface ChannelProvider {
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<void>;
}
