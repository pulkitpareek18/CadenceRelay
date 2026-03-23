import apiClient from './client';

export interface ContactList {
  id: string;
  name: string;
  description: string | null;
  contact_count: number;
  created_at: string;
}

export async function listLists() {
  const res = await apiClient.get('/lists');
  return res.data.lists as ContactList[];
}

export async function getList(id: string, params: Record<string, string> = {}) {
  const res = await apiClient.get(`/lists/${id}`, { params });
  return res.data;
}

export async function createList(data: { name: string; description?: string }) {
  const res = await apiClient.post('/lists', data);
  return res.data;
}

export async function updateList(id: string, data: { name?: string; description?: string }) {
  const res = await apiClient.put(`/lists/${id}`, data);
  return res.data;
}

export async function deleteList(id: string) {
  const res = await apiClient.delete(`/lists/${id}`);
  return res.data;
}

export async function addContactsToList(id: string, contactIds: string[]) {
  const res = await apiClient.post(`/lists/${id}/contacts`, { contactIds });
  return res.data;
}

export async function removeContactsFromList(id: string, contactIds: string[]) {
  const res = await apiClient.delete(`/lists/${id}/contacts`, { data: { contactIds } });
  return res.data;
}
