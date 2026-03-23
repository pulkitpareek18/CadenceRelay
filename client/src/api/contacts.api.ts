import apiClient from './client';

export interface Contact {
  id: string;
  email: string;
  name: string | null;
  metadata: Record<string, unknown>;
  status: string;
  bounce_count: number;
  send_count: number;
  last_sent_at: string | null;
  created_at: string;
  lists?: { id: string; name: string }[];
}

export async function listContacts(params: Record<string, string> = {}) {
  const res = await apiClient.get('/contacts', { params });
  return res.data;
}

export async function getContact(id: string) {
  const res = await apiClient.get(`/contacts/${id}`);
  return res.data;
}

export async function createContact(data: { email: string; name?: string; listIds?: string[] }) {
  const res = await apiClient.post('/contacts', data);
  return res.data;
}

export async function updateContact(id: string, data: Partial<Contact>) {
  const res = await apiClient.put(`/contacts/${id}`, data);
  return res.data;
}

export async function deleteContact(id: string) {
  const res = await apiClient.delete(`/contacts/${id}`);
  return res.data;
}

export async function importContacts(file: File, listId?: string) {
  const formData = new FormData();
  formData.append('file', file);
  if (listId) formData.append('listId', listId);
  const res = await apiClient.post('/contacts/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function exportContacts(listId?: string) {
  const params = listId ? { listId } : {};
  const res = await apiClient.get('/contacts/export', { params, responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'contacts.csv');
  document.body.appendChild(link);
  link.click();
  link.remove();
}
