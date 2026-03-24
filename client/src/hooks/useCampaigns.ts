import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  deleteCampaign,
  bulkDeleteCampaigns,
  sendCampaign,
  pauseCampaign,
  resumeCampaign,
  scheduleCampaign,
} from '../api/campaigns.api';

export function useCampaignsList(params: { page: number; limit?: number; status?: string; search?: string }) {
  const queryParams: Record<string, string> = {
    page: String(params.page),
    limit: String(params.limit || 20),
  };
  if (params.status) queryParams.status = params.status;
  if (params.search) queryParams.search = params.search;

  return useQuery({
    queryKey: ['campaigns', queryParams],
    queryFn: () => listCampaigns(queryParams),
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => getCampaign(id!),
    enabled: !!id,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign created');
    },
    onError: () => {
      toast.error('Failed to create campaign');
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminPassword }: { id: string; adminPassword: string }) =>
      deleteCampaign(id, adminPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign deleted');
    },
    onError: () => {
      toast.error('Failed to delete campaign');
    },
  });
}

export function useBulkDeleteCampaigns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, adminPassword }: { ids: string[]; adminPassword: string }) =>
      bulkDeleteCampaigns(ids, adminPassword),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(`${variables.ids.length} campaign(s) deleted`);
    },
    onError: () => {
      toast.error('Failed to delete campaigns');
    },
  });
}

export function useSendCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign sending started');
    },
    onError: () => {
      toast.error('Failed to start campaign send');
    },
  });
}

export function usePauseCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pauseCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign paused');
    },
    onError: () => {
      toast.error('Failed to pause campaign');
    },
  });
}

export function useResumeCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumeCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign resumed');
    },
    onError: () => {
      toast.error('Failed to resume campaign');
    },
  });
}

export function useScheduleCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      scheduleCampaign(id, scheduledAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign scheduled');
    },
    onError: () => {
      toast.error('Failed to schedule campaign');
    },
  });
}
