import nodemailer from 'nodemailer';
import type { ChannelProvider, OutboundMessage } from '../../channel-provider.js';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS environment variables are required');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export const smtpEmailProvider: ChannelProvider = {
  channel: 'email',

  async send(message: OutboundMessage): Promise<void> {
    const transporter = getTransporter();
    const fromEmail = process.env.COMMS_FROM_EMAIL ?? 'no-reply@moasy.tech';
    const fromName  = process.env.COMMS_FROM_NAME  ?? 'moasy.tech';

    await transporter.sendMail({
      from:    `"${fromName}" <${fromEmail}>`,
      to:      message.to,
      subject: message.subject ?? '(no subject)',
      html:    message.body,
    });
  },
};
