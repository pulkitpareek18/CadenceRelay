import apiClient from './client';

export async function getDashboardData(params: Record<string, string> = {}) {
  const res = await apiClient.get('/analytics/dashboard', { params });
  return res.data;
}

export async function getCampaignAnalytics(id: string) {
  const res = await apiClient.get(`/analytics/campaigns/${id}`);
  return res.data;
}

export async function exportAnalytics(params: Record<string, string> = {}) {
  const res = await apiClient.get('/analytics/export', { params, responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'analytics.csv');
  document.body.appendChild(link);
  link.click();
  link.remove();
}
