import type { OtpPurpose } from "./types.js";

export function renderOtpEmail(
  code: string,
  purpose: OtpPurpose,
): { subject: string; text: string; html: string } {
  const isSignup = purpose === "signup";
  const actionTitle = isSignup ? "Xác thực đăng ký tài khoản" : "Đặt lại mật khẩu";
  const subject = `[LemonChat] ${actionTitle} - Mã OTP: ${code}`;

  const messageLead = isSignup
    ? "Cảm ơn bạn đã đăng ký tài khoản tại LemonChat! Vui lòng sử dụng mã OTP dưới đây để hoàn tất quá trình xác thực email:"
    : "Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản LemonChat của bạn. Vui lòng sử dụng mã OTP dưới đây:";

  const text = `
LemonChat - ${actionTitle}

${messageLead}

Mã xác thực OTP của bạn là: ${code}

Lưu ý: Mã OTP này có hiệu lực trong vòng 2 phút. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.
Nếu bạn không yêu cầu hành động này, vui lòng bỏ qua email này.

Trân trọng,
Đội ngũ LemonChat
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${actionTitle}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f4f4f5;
      color: #18181b;
    }
    .container {
      max-width: 520px;
      margin: 32px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #e4e4e7;
    }
    .header {
      background: #fef08a;
      padding: 24px;
      text-align: center;
      border-bottom: 2px solid #eab308;
    }
    .header h1 {
      margin: 0;
      color: #713f12;
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
      color: #27272a;
    }
    .description {
      font-size: 14px;
      line-height: 1.6;
      color: #52525b;
      margin-bottom: 24px;
    }
    .otp-box {
      background: #fefce8;
      border: 2px dashed #eab308;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      margin-bottom: 24px;
    }
    .otp-code {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 6px;
      color: #854d0e;
      font-family: "Courier New", Courier, monospace;
      margin: 0;
    }
    .otp-expiry {
      font-size: 12px;
      color: #a16207;
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
      <h2 class="title">${actionTitle}</h2>
      <p class="description">${messageLead}</p>
      <div class="otp-box">
        <p class="otp-code">${code}</p>
        <p class="otp-expiry">⏳ Mã này sẽ hết hạn sau <strong>2 phút</strong></p>
      </div>
      <div class="warning">
        <strong>Bảo mật:</strong> Tuyệt đối không chia sẻ mã này cho bất kỳ ai, kể cả nhân viên LemonChat. Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email.
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
