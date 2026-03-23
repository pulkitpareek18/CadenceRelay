import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  listContacts,
  createContact,
  deleteContact,
  bulkDeleteContacts,
} from '../api/contacts.api';

export interface ContactsParams {
  page: number;
  limit?: number;
  search?: string;
  status?: string;
  listId?: string;
  state?: string;
  district?: string;
  block?: string;
  category?: string;
  management?: string;
}

export function useContactsList(params: ContactsParams) {
  const queryParams: Record<string, string> = {
    page: String(params.page),
    limit: String(params.limit || 50),
  };
  if (params.search) queryParams.search = params.search;
  if (params.status) queryParams.status = params.status;
  if (params.listId) queryParams.listId = params.listId;
  if (params.state) queryParams.state = params.state;
  if (params.district) queryParams.district = params.district;
  if (params.block) queryParams.block = params.block;
  if (params.category) queryParams.category = params.category;
  if (params.management) queryParams.management = params.management;

  return useQuery({
    queryKey: ['contacts', queryParams],
    queryFn: () => listContacts(queryParams),
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; name?: string; listIds?: string[] }) =>
      createContact(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact added');
    },
    onError: () => {
      toast.error('Failed to add contact');
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminPassword }: { id: string; adminPassword: string }) =>
      deleteContact(id, adminPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success('Contact deleted');
    },
    onError: () => {
      toast.error('Failed to delete contact');
    },
  });
}

export function useBulkDeleteContacts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, adminPassword }: { ids: string[]; adminPassword: string }) =>
      bulkDeleteContacts(ids, adminPassword),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      toast.success(`${variables.ids.length} contact(s) deleted`);
    },
    onError: () => {
      toast.error('Failed to delete contacts');
    },
  });
}
