/**
 * GmailProvider — auth identity vs visible sender separation.
 *
 * The "gmail" provider is really a generic SMTP path. Brevo, Mailgun, and
 * Postmark all issue a synthetic SMTP login username (e.g. 9abc@smtp-brevo.com)
 * that is NOT a deliverable mailbox; the From: header has to be a separately
 * verified sender address. These tests pin the behaviour that:
 *
 *   - `user` is always the SMTP auth identity (login username).
 *   - `fromEmail`, when present and non-blank, is what recipients see in From:.
 *   - When `fromEmail` is missing/blank/whitespace, From: falls back to `user`
 *     so existing Gmail accounts keep working unchanged.
 *   - `fromName` wraps whichever sender address ended up being used.
 */

import { GmailProvider } from '../services/email/GmailProvider';

type GmailCfg = {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName?: string;
  fromEmail?: string;
};

const baseConfig: GmailCfg = {
  host: 'smtp.example.com',
  port: 587,
  user: 'auth-user@example.com',
  pass: 'irrelevant-for-this-test',
};

describe('GmailProvider — auth vs sender address', () => {
  const providers: GmailProvider[] = [];

  // Nodemailer opens a connection pool (`pool: true`) on construct that holds
  // sockets open and prevents Jest from exiting cleanly. Close them all.
  afterEach(async () => {
    while (providers.length) {
      const p = providers.pop()!;
      await p.close();
    }
  });

  const make = (cfg: Partial<GmailCfg> = {}) => {
    const p = new GmailProvider({ ...baseConfig, ...cfg });
    providers.push(p);
    return p;
  };

  it('defaults From: to the auth user when fromEmail is not provided', () => {
    const p = make({});
    expect(p.getFromAddress()).toBe('auth-user@example.com');
  });

  it('uses fromEmail as From: when provided (Brevo-style)', () => {
    const p = make({
      user: '9abc12@smtp-brevo.com',
      fromEmail: 'hello@thefoundersweb.com',
    });
    expect(p.getFromAddress()).toBe('hello@thefoundersweb.com');
  });

  it('wraps fromEmail with fromName when both are set', () => {
    const p = make({
      user: '9abc12@smtp-brevo.com',
      fromEmail: 'hello@thefoundersweb.com',
      fromName: "The Founders' Web",
    });
    expect(p.getFromAddress()).toBe('"The Founders\' Web" <hello@thefoundersweb.com>');
  });

  it('wraps auth user with fromName when fromEmail is absent', () => {
    const p = make({ fromName: 'Office Gmail' });
    expect(p.getFromAddress()).toBe('"Office Gmail" <auth-user@example.com>');
  });

  it('treats blank/whitespace fromEmail as absent', () => {
    const p = make({ fromEmail: '   ' });
    expect(p.getFromAddress()).toBe('auth-user@example.com');
  });

  it('treats empty-string fromEmail as absent (form-default case)', () => {
    const p = make({ fromEmail: '' });
    expect(p.getFromAddress()).toBe('auth-user@example.com');
  });
});
