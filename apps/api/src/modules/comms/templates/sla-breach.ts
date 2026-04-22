import { wrapEmailLayout } from './layout.js';

export interface SlaBreachPayload {
  task_id: string;
  task_title: string;
  sla_name: string;
  breached_at: string;
  tenant_name?: string;
}

export function renderSlaBreach(data: SlaBreachPayload) {
  const base = process.env.APP_BASE_URL ?? 'https://app.moasy.tech';
  const url  = `${base}/tasks/${encodeURIComponent(data.task_id)}`;

  return {
    subject: `SLA breach detected: ${data.sla_name}`,
    body: wrapEmailLayout(`
      <p>Hi,</p>
      <p>
        Task <strong>${data.task_title}</strong> has breached the SLA
        <strong>${data.sla_name}</strong>.
      </p>
      <p>Breached at: <strong>${data.breached_at}</strong></p>
      <p style="margin-top:24px;">
        <a href="${url}" style="background:#DC2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          View Task
        </a>
      </p>
    `),
  };
}
