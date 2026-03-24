import { EmailProvider } from './EmailProvider';
import { GmailProvider } from './GmailProvider';
import { SESProvider } from './SESProvider';
import { decryptCredential, isEncrypted } from '../../utils/crypto';

/**
 * Decrypt a credential value if it's encrypted, otherwise return as-is.
 * This provides backwards compatibility with unencrypted configs.
 */
function maybeDecrypt(value: string): string {
  if (!value) return value;
  if (isEncrypted(value)) {
    const decrypted = decryptCredential(value);
    if (decrypted !== null) return decrypted;
  }
  return value; // not encrypted or decryption failed, return as-is
}

export function createProvider(provider: string, config: Record<string, unknown>): EmailProvider {
  switch (provider) {
    case 'gmail': {
      const gmailConfig = config as { host: string; port: number; user: string; pass: string };
      return new GmailProvider({
        ...gmailConfig,
        pass: maybeDecrypt(gmailConfig.pass),
      });
    }
    case 'ses': {
      const sesConfig = config as { region: string; accessKeyId: string; secretAccessKey: string; fromEmail: string };
      return new SESProvider({
        ...sesConfig,
        accessKeyId: maybeDecrypt(sesConfig.accessKeyId),
        secretAccessKey: maybeDecrypt(sesConfig.secretAccessKey),
      });
    }
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}
