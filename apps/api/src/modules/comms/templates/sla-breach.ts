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
    body: `
      <p>Hi,</p>
      <p>
        Task <strong>${data.task_title}</strong> has breached the SLA
        <strong>${data.sla_name}</strong>.
      </p>
      <p>Breached at: <strong>${data.breached_at}</strong></p>
      <p>
        <a href="${url}" style="background:#DC2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">
          View Task
        </a>
      </p>
    `,
  };
}
