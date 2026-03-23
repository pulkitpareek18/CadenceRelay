import apiClient from './client';

export interface CampaignAttachment {
  filename: string;
  storagePath: string;
  size: number;
  contentType: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  provider: string;
  template_id: string;
  template_name?: string;
  template_subject?: string;
  list_id: string;
  list_name?: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  throttle_per_second: number;
  throttle_per_hour: number;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  bounce_count: number;
  open_count: number;
  click_count: number;
  complaint_count: number;
  attachments?: CampaignAttachment[];
  created_at: string;
}

export async function listCampaigns(params: Record<string, string> = {}) {
  const res = await apiClient.get('/campaigns', { params });
  return res.data;
}

export async function getCampaign(id: string) {
  const res = await apiClient.get(`/campaigns/${id}`);
  return res.data.campaign as Campaign;
}

export async function createCampaign(data: {
  name: string; templateId: string; listId: string; provider?: string;
  throttlePerSecond?: number; throttlePerHour?: number;
  attachments?: File[];
}) {
  const formData = new FormData();
  formData.append('name', data.name);
  formData.append('templateId', data.templateId);
  formData.append('listId', data.listId);
  if (data.provider) formData.append('provider', data.provider);
  if (data.throttlePerSecond) formData.append('throttlePerSecond', String(data.throttlePerSecond));
  if (data.throttlePerHour) formData.append('throttlePerHour', String(data.throttlePerHour));
  if (data.attachments) {
    data.attachments.forEach((file) => formData.append('attachments', file));
  }

  const res = await apiClient.post('/campaigns', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.campaign as Campaign;
}

export async function updateCampaign(id: string, data: Record<string, unknown>) {
  const res = await apiClient.put(`/campaigns/${id}`, data);
  return res.data.campaign as Campaign;
}

export async function deleteCampaign(id: string) {
  return apiClient.delete(`/campaigns/${id}`);
}

export async function scheduleCampaign(id: string, scheduledAt: string) {
  const res = await apiClient.post(`/campaigns/${id}/schedule`, { scheduledAt });
  return res.data;
}

export async function sendCampaign(id: string) {
  const res = await apiClient.post(`/campaigns/${id}/send`);
  return res.data;
}

export async function pauseCampaign(id: string) {
  const res = await apiClient.post(`/campaigns/${id}/pause`);
  return res.data;
}

export async function resumeCampaign(id: string) {
  const res = await apiClient.post(`/campaigns/${id}/resume`);
  return res.data;
}

export async function getCampaignRecipients(id: string, params: Record<string, string> = {}) {
  const res = await apiClient.get(`/campaigns/${id}/recipients`, { params });
  return res.data;
}

export async function addAttachments(id: string, files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append('attachments', file));
  const res = await apiClient.post(`/campaigns/${id}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.attachments as CampaignAttachment[];
}

export async function removeAttachment(id: string, index: number) {
  const res = await apiClient.delete(`/campaigns/${id}/attachments/${index}`);
  return res.data;
}
