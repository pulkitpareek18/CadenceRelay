import apiClient from './client';

export interface CustomVariable {
  id: string;
  name: string;
  key: string;
  type: 'text' | 'number' | 'date' | 'select';
  options: string[];
  required: boolean;
  default_value: string | null;
  sort_order: number;
  created_at: string;
}

export async function getCustomVariables(): Promise<CustomVariable[]> {
  const res = await apiClient.get('/custom-variables');
  return res.data.variables;
}

export async function createCustomVariable(
  data: Partial<Omit<CustomVariable, 'id' | 'created_at' | 'sort_order'>>
): Promise<CustomVariable> {
  const res = await apiClient.post('/custom-variables', data);
  return res.data.variable;
}

export async function updateCustomVariable(
  id: string,
  data: Partial<Omit<CustomVariable, 'id' | 'created_at' | 'sort_order'>>
): Promise<CustomVariable> {
  const res = await apiClient.put(`/custom-variables/${id}`, data);
  return res.data.variable;
}

export async function deleteCustomVariable(id: string): Promise<void> {
  await apiClient.delete(`/custom-variables/${id}`);
}

export async function reorderCustomVariables(
  order: { id: string; sort_order: number }[]
): Promise<CustomVariable[]> {
  const res = await apiClient.put('/custom-variables/reorder', { order });
  return res.data.variables;
}
