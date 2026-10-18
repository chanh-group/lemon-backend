export type OtpPurpose = "signup" | "reset";

export interface SendOtpMailOptions {
  to: string;
  code: string;
  purpose: OtpPurpose;
  requestId?: string;
}

export interface MailJob {
  to: string;
  subject: string;
  text: string;
  html: string;
  requestId?: string;
}
