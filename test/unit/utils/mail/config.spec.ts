import { describe, expect, it } from "vitest";
import {
  buildTransportOptions,
  from_env,
  isEnabled,
  securityForPort,
  validate,
  type MailConfig,
} from "../../../../src/utils/mail/config.js";

const disabled = (): MailConfig => ({
  host: "smtp.gmail.com",
  port: 587,
  username: "",
  password: "",
  from: "",
});

describe("mail config", () => {
  it("rejects half credentials (username only)", () => {
    expect(() =>
      validate({ ...disabled(), username: "lemon@gmail.com" }),
    ).toThrow(
      "set both SMTP_USERNAME and SMTP_PASSWORD, or neither to disable mail",
    );
  });

  it("rejects half credentials (password only)", () => {
    expect(() =>
      validate({ ...disabled(), password: "secret" }),
    ).toThrow(
      "set both SMTP_USERNAME and SMTP_PASSWORD, or neither to disable mail",
    );
  });

  it("rejects credentials without from", () => {
    expect(() =>
      validate({
        ...disabled(),
        username: "lemon@gmail.com",
        password: "secret",
      }),
    ).toThrow("SMTP_FROM is required when SMTP credentials are set");
  });

  it("treats empty config as disabled log-only and valid", () => {
    const config = disabled();
    expect(isEnabled(config)).toBe(false);
    expect(() => validate(config)).not.toThrow();
  });

  it("treats from-only config as an enabled dev relay", () => {
    const config = { ...disabled(), from: "dev@localhost" };
    expect(isEnabled(config)).toBe(true);
    expect(() => validate(config)).not.toThrow();
  });

  it("accepts full credentials with from", () => {
    const config: MailConfig = {
      ...disabled(),
      username: "lemon@gmail.com",
      password: "secret",
      from: "LemonChat <lemon@gmail.com>",
    };
    expect(isEnabled(config)).toBe(true);
    expect(() => validate(config)).not.toThrow();
  });

  it("reads Rust defaults from env", () => {
    const config = from_env((key: string, def?: string) => {
      if (key === "SMTP_FROM") return "LemonChat <lemon@gmail.com>";
      return def ?? "";
    });
    expect(config.host).toBe("smtp.gmail.com");
    expect(config.port).toBe(587);
  });

  it("maps ports to Rust transport modes", () => {
    expect(securityForPort(465)).toBe("implicit-tls");
    expect(securityForPort(587)).toBe("starttls");
    expect(securityForPort(25)).toBe("starttls");
    expect(securityForPort(1025)).toBe("plaintext");
  });

  it("builds implicit-TLS options for 465 with timeout", () => {
    const options = buildTransportOptions({
      ...disabled(),
      host: "smtp.gmail.com",
      port: 465,
      username: "lemon@gmail.com",
      password: "secret",
      from: "LemonChat <lemon@gmail.com>",
    });
    expect(options.secure).toBe(true);
    expect(options.auth).toEqual({
      user: "lemon@gmail.com",
      pass: "secret",
    });
    expect(options.connectionTimeout).toBe(10_000);
    expect(options.plaintextRelay).toBe(false);
  });

  it("marks non-standard ports as plaintext relay without auth", () => {
    const options = buildTransportOptions({
      ...disabled(),
      host: "127.0.0.1",
      port: 1025,
    });
    expect(options.secure).toBe(false);
    expect(options.plaintextRelay).toBe(true);
    expect(options.auth).toBeUndefined();
  });
});
