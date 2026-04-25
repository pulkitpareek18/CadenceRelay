import apiClient from './client';

/**
 * Trigger backup download. Browser handles the file save via blob.
 */
export async function downloadBackup(): Promise<void> {
  const res = await apiClient.get('/backup/export', { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/zip' });
  const url = window.URL.createObjectURL(blob);

  // Try to extract filename from Content-Disposition
  const cd = res.headers['content-disposition'] || '';
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `cadencerelay-backup-${Date.now()}.crelay`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export interface RestoreResult {
  message: string;
  restored: Record<string, number>;
}

/**
 * Upload a .crelay backup file and restore it. Wipes existing data first.
 */
export async function restoreBackup(file: File, adminPassword: string): Promise<RestoreResult> {
  const formData = new FormData();
  formData.append('backup', file);
  formData.append('adminPassword', adminPassword);
  const res = await apiClient.post('/backup/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600000, // 10 minutes for large restores
  });
  return res.data;
}
