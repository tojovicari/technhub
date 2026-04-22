const LOGO_LIGHT = `<svg width="160" height="40" viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <line x1="26" y1="6" x2="26" y2="94" stroke="#06b6d4" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="26" y1="6" x2="50" y2="6" stroke="#06b6d4" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="26" y1="94" x2="50" y2="94" stroke="#06b6d4" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="26" cy="50" r="5" fill="#06b6d4"/>
  <circle cx="26" cy="50" r="10" fill="none" stroke="#06b6d4" stroke-width="1.2" opacity="0.25"/>
  <text x="62" y="62" font-family="system-ui,sans-serif" font-weight="500" font-size="38" letter-spacing="-1" fill="#0f172a">moas<tspan fill="#06b6d4">y</tspan></text>
  <text x="62" y="78" font-family="ui-monospace,monospace" font-size="8" letter-spacing="3" fill="#94a3b8">ENGINEERING GOVERNANCE</text>
</svg>`;

const LOGO_DARK = `<svg width="160" height="40" viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <line x1="26" y1="6" x2="26" y2="94" stroke="#06b6d4" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="26" y1="6" x2="50" y2="6" stroke="#06b6d4" stroke-width="3.5" stroke-linecap="round"/>
  <line x1="26" y1="94" x2="50" y2="94" stroke="#06b6d4" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="26" cy="50" r="5" fill="#06b6d4"/>
  <circle cx="26" cy="50" r="10" fill="none" stroke="#06b6d4" stroke-width="1.2" opacity="0.25"/>
  <text x="62" y="62" font-family="system-ui,sans-serif" font-weight="500" font-size="38" letter-spacing="-1" fill="#f1f5f9">moas<tspan fill="#06b6d4">y</tspan></text>
  <text x="62" y="78" font-family="ui-monospace,monospace" font-size="8" letter-spacing="3" fill="#475569">ENGINEERING GOVERNANCE</text>
</svg>`;

/**
 * Wraps an HTML body fragment in a full email layout with the moasy.tech logo.
 * Uses the light-theme logo (dark text on white background), which is standard for emails.
 */
export function wrapEmailLayout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="100%" style="max-width:580px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">

          <!-- Header / Logo -->
          <tr>
            <td style="padding:28px 32px 20px;border-bottom:1px solid #f1f5f9;">
              ${LOGO_LIGHT}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;font-size:15px;line-height:1.6;color:#334155;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;text-align:center;">
              moasy.tech &mdash; Engineering Governance Platform<br />
              You are receiving this email because of activity on your account.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
