import apiClient from './client';

export async function getSettings() {
  const res = await apiClient.get('/settings');
  return res.data.settings;
}

export async function updateProvider(provider: 'gmail' | 'ses') {
  const res = await apiClient.put('/settings/provider', { provider });
  return res.data;
}

export async function updateGmailConfig(config: { user: string; pass: string; host?: string; port?: number }) {
  const res = await apiClient.put('/settings/gmail', config);
  return res.data;
}

export async function updateSesConfig(config: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fromEmail: string;
}) {
  const res = await apiClient.put('/settings/ses', config);
  return res.data;
}

export async function updateThrottleDefaults(config: { perSecond: number; perHour: number }) {
  const res = await apiClient.put('/settings/throttle', config);
  return res.data;
}

export async function sendTestEmail(to: string, options?: { subject?: string; html?: string }) {
  const res = await apiClient.post('/settings/test-email', { to, ...options });
  return res.data;
}
