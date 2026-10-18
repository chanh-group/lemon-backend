// Mail config — ported from Rust `dsa/src/utils/email.rs` (`EmailConfig`).
//
// Single source of truth for SMTP settings; `from_env()` reads env with Rust
// defaults, `validate()` fails fast at boot on half-baked config, `isEnabled()`
// decides log-only vs SMTP delivery. Transport selection mirrors
// `build_transport`: 465 → implicit TLS, 587/25 → STARTTLS, other → plaintext
// dev relay with a boot warning.
import { get_env } from "../../helpers/index.js";

export const DEFAULT_SMTP_HOST = "smtp.gmail.com";
export const DEFAULT_SMTP_PORT = 587;
export const EMAIL_SMTP_TIMEOUT_MS = 10_000;

export interface MailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

/**
 * Read SMTP config from env. `SMTP_HOST` defaults to Gmail, `SMTP_PORT` to
 * 587; credentials/from default to empty (log-only mode).
 */
export function from_env(
  env: (key: string, def?: string) => string = get_env,
): MailConfig {
  return {
    host: env("SMTP_HOST", DEFAULT_SMTP_HOST),
    port: Number(env("SMTP_PORT", String(DEFAULT_SMTP_PORT))),
    username: env("SMTP_USERNAME", ""),
    password: env("SMTP_PASSWORD", ""),
    from: env("SMTP_FROM", ""),
  };
}

/**
 * Mail is enabled with full credentials, or with only `from` (dev relay like
 * Mailpit) — mirrors Rust `EmailConfig::is_enabled`.
 */
export function isEnabled(config: MailConfig): boolean {
  return (
    (config.username !== "" && config.password !== "") || config.from !== ""
  );
}

/**
 * Fail-fast validation at boot: half credentials or credentials without
 * `from` is a config error, not a runtime surprise.
 */
export function validate(config: MailConfig): void {
  const hasUser = config.username !== "";
  const hasPass = config.password !== "";
  if (hasUser !== hasPass) {
    throw new Error(
      "set both SMTP_USERNAME and SMTP_PASSWORD, or neither to disable mail",
    );
  }
  if (hasUser && config.from === "") {
    throw new Error("SMTP_FROM is required when SMTP credentials are set");
  }
}

export type SmtpSecurity = "implicit-tls" | "starttls" | "plaintext";

/** Port → security mode table, mirroring Rust `build_transport`. */
export function securityForPort(port: number): SmtpSecurity {
  if (port === 465) return "implicit-tls";
  if (port === 587 || port === 25) return "starttls";
  return "plaintext";
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  plaintextRelay: boolean;
}

/**
 * Build nodemailer options from a validated config. Non-standard ports fall
 * back to plaintext (dev relay); callers must warn so prod never mistakes it
 * for a secure transport.
 */
export function buildTransportOptions(config: MailConfig): SmtpTransportOptions {
  const security = securityForPort(config.port);
  return {
    host: config.host,
    port: config.port,
    secure: security === "implicit-tls",
    auth:
      config.username !== ""
        ? { user: config.username, pass: config.password }
        : undefined,
    connectionTimeout: EMAIL_SMTP_TIMEOUT_MS,
    plaintextRelay: security === "plaintext",
  };
}
