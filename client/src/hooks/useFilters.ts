import { useQuery } from '@tanstack/react-query';
import { getContactFilters } from '../api/contacts.api';

export function useContactFilters(params: { state?: string; district?: string } = {}) {
  const queryParams: Record<string, string> = {};
  if (params.state) queryParams.state = params.state;
  if (params.district) queryParams.district = params.district;

  return useQuery({
    queryKey: ['contactFilters', queryParams],
    queryFn: () => getContactFilters(queryParams),
  });
}
