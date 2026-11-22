import { OTP_EXPIRATION } from "../cache/constants.js";
import { t } from "../i18n/index.js";
import type { OtpPurpose } from "./types.js";

// Validity copy renders the minutes from the OTP TTL (120s → "2 phút").
const OTP_EXPIRATION_MINUTES = OTP_EXPIRATION / 60;

export function renderOtpEmail(
  code: string,
  purpose: OtpPurpose,
  lang: string,
): { subject: string; text: string; html: string } {
  const isSignup = purpose === "signup";
  const title = t(isSignup ? "EMAIL_OTP_TITLE_SIGNUP" : "EMAIL_OTP_TITLE_RESET", lang);
  const lead = t(isSignup ? "EMAIL_OTP_LEAD_SIGNUP" : "EMAIL_OTP_LEAD_RESET", lang);
  const minutes = String(OTP_EXPIRATION_MINUTES);

  const subject = t("EMAIL_OTP_SUBJECT", lang, { title, code });

  const text = [
    `LemonChat - ${title}`,
    "",
    lead,
    "",
    t("EMAIL_OTP_CODE_LINE", lang, { code }),
    "",
    t("EMAIL_OTP_EXPIRY_TEXT", lang, { minutes }),
    t("EMAIL_OTP_IGNORE_TEXT", lang),
    "",
    t("EMAIL_OTP_SIGN_OFF", lang),
  ]
    .join("\n")
    .trim();

  const html = `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f6f8f6;
      color: #1c1917;
    }
    .container {
      max-width: 520px;
      margin: 32px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #d6e8d6;
    }
    .header {
      background: #dcfce7;
      padding: 24px;
      text-align: center;
      border-bottom: 2px solid #00c853;
    }
    .header h1 {
      margin: 0;
      color: #1b5e20;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 32px 24px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin-top: 0;
      margin-bottom: 12px;
      color: #1c1917;
    }
    .description {
      font-size: 14px;
      line-height: 1.6;
      color: #57534e;
      margin-bottom: 24px;
    }
    .otp-box {
      background: #f0fdf4;
      border: 2px dashed #00e676;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      margin-bottom: 24px;
    }
    .otp-code {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 6px;
      color: #1b5e20;
      font-family: "Courier New", Courier, monospace;
      margin: 0;
    }
    .otp-expiry {
      font-size: 12px;
      color: #15803d;
      margin-top: 8px;
      margin-bottom: 0;
    }
    .warning {
      background: #fff1f2;
      border-left: 4px solid #f43f5e;
      padding: 12px;
      border-radius: 4px;
      font-size: 12px;
      color: #9f1239;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .footer {
      border-top: 1px solid #f4f4f5;
      padding: 16px 24px;
      font-size: 12px;
      color: #71717a;
      text-align: center;
      background: #fafafa;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🍋 LemonChat</h1>
    </div>
    <div class="content">
      <h2 class="title">${title}</h2>
      <p class="description">${lead}</p>
      <div class="otp-box">
        <p class="otp-code">${code}</p>
        <p class="otp-expiry">${t("EMAIL_OTP_EXPIRY_HTML", lang, { minutes })}</p>
      </div>
      <div class="warning">
        ${t("EMAIL_OTP_WARNING_HTML", lang)}
      </div>
    </div>
    <div class="footer">
      <p>© 2026 LemonChat. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}
