import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  getSettings,
  updateProvider,
  updateGmailConfig,
  updateSesConfig,
  updateThrottleDefaults,
  updateReplyTo,
  sendTestEmail,
} from '../api/settings.api';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });
}

export function useUpdateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: 'gmail' | 'ses') => updateProvider(provider),
    onSuccess: (_data, provider) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`Switched to ${provider.toUpperCase()}`);
    },
    onError: () => {
      toast.error('Failed to switch provider');
    },
  });
}

export function useUpdateGmailConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: { user: string; pass: string; host?: string; port?: number }) =>
      updateGmailConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Gmail config saved');
    },
    onError: () => {
      toast.error('Failed to save Gmail config');
    },
  });
}

export function useUpdateSesConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: { region: string; accessKeyId: string; secretAccessKey: string; fromEmail: string }) =>
      updateSesConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('SES config saved');
    },
    onError: () => {
      toast.error('Failed to save SES config');
    },
  });
}

export function useUpdateThrottleDefaults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: { perSecond: number; perHour: number }) =>
      updateThrottleDefaults(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Throttle defaults saved');
    },
    onError: () => {
      toast.error('Failed to save throttle config');
    },
  });
}

export function useUpdateReplyTo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (replyTo: string) => updateReplyTo(replyTo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Reply-To address saved');
    },
    onError: () => {
      toast.error('Failed to save Reply-To address');
    },
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: (to: string) => sendTestEmail(to),
    onSuccess: (_data, to) => {
      toast.success(`Test email sent to ${to}`);
    },
    onError: () => {
      toast.error('Failed to send test email');
    },
  });
}
