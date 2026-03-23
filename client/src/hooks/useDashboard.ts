import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '../api/analytics.api';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => getDashboardData(),
  });
}
