import { wrapEmailLayout } from './layout.js';

export interface DoraDigestPayload {
  period: string;
  team_name: string;
  deployment_frequency?: string;
  lead_time_for_changes?: string;
  change_failure_rate?: string;
  mean_time_to_restore?: string;
}

export function renderDoraDigest(data: DoraDigestPayload) {
  const base = process.env.APP_BASE_URL ?? 'https://app.moasy.tech';
  const url  = `${base}/dora`;

  const row = (label: string, value: string | undefined) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;">${label}</td>` +
    `<td style="padding:6px 12px;border-bottom:1px solid #E5E7EB;font-weight:600;">${value ?? 'N/A'}</td></tr>`;

  return {
    subject: `DORA digest — ${data.team_name} (${data.period})`,
    body: wrapEmailLayout(`
      <h2 style="color:#1E293B;margin-top:0;">DORA Metrics Digest</h2>
      <p>Team: <strong>${data.team_name}</strong> &nbsp;|&nbsp; Period: <strong>${data.period}</strong></p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <thead>
          <tr style="background:#F1F5F9;">
            <th style="padding:8px 12px;text-align:left;">Metric</th>
            <th style="padding:8px 12px;text-align:left;">Value</th>
          </tr>
        </thead>
        <tbody>
          ${row('Deployment Frequency',   data.deployment_frequency)}
          ${row('Lead Time for Changes',  data.lead_time_for_changes)}
          ${row('Change Failure Rate',    data.change_failure_rate)}
          ${row('Mean Time to Restore',   data.mean_time_to_restore)}
        </tbody>
      </table>
      <p style="margin-top:24px;">
        <a href="${url}" style="background:#2563EB;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          View Full Dashboard
        </a>
      </p>
    `),
  };
}
