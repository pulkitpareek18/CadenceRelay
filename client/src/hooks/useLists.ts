import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  listLists,
  createList,
  createSmartList,
  deleteList,
  SmartFilterCriteria,
} from '../api/lists.api';

export function useListsList() {
  return useQuery({
    queryKey: ['lists'],
    queryFn: listLists,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) => createList(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success('List created');
    },
    onError: () => {
      toast.error('Failed to create list');
    },
  });
}

export function useCreateSmartList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; filterCriteria: SmartFilterCriteria }) =>
      createSmartList(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success('Smart list created');
    },
    onError: () => {
      toast.error('Failed to create smart list');
    },
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success('List deleted');
    },
    onError: () => {
      toast.error('Failed to delete list');
    },
  });
}
