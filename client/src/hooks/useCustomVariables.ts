import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  getCustomVariables,
  createCustomVariable,
  updateCustomVariable,
  deleteCustomVariable,
  reorderCustomVariables,
  CustomVariable,
} from '../api/customVariables.api';

export function useCustomVariables() {
  return useQuery({
    queryKey: ['custom-variables'],
    queryFn: getCustomVariables,
  });
}

export function useCreateCustomVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Omit<CustomVariable, 'id' | 'created_at' | 'sort_order'>>) =>
      createCustomVariable(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-variables'] });
      toast.success('Custom variable created');
    },
    onError: () => {
      toast.error('Failed to create custom variable');
    },
  });
}

export function useUpdateCustomVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<CustomVariable, 'id' | 'created_at' | 'sort_order'>> }) =>
      updateCustomVariable(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-variables'] });
      toast.success('Custom variable updated');
    },
    onError: () => {
      toast.error('Failed to update custom variable');
    },
  });
}

export function useDeleteCustomVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCustomVariable(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-variables'] });
      toast.success('Custom variable deleted');
    },
    onError: () => {
      toast.error('Failed to delete custom variable');
    },
  });
}

export function useReorderCustomVariables() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: { id: string; sort_order: number }[]) =>
      reorderCustomVariables(order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-variables'] });
    },
    onError: () => {
      toast.error('Failed to reorder variables');
    },
  });
}
