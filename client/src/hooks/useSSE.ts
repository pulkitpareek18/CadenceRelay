import { useState, useEffect, useRef, useCallback } from 'react';

interface SSEOptions {
  /** Whether the SSE connection should be active. Defaults to true. */
  enabled?: boolean;
  /** Reconnect delay in ms. Defaults to 3000. */
  reconnectDelay?: number;
}

interface SSEState<T> {
  data: T | null;
  isConnected: boolean;
  error: string | null;
}

/**
 * Custom hook that connects to an SSE endpoint and returns reactive state.
 * Automatically reconnects on disconnect.
 */
export function useSSE<T = Record<string, unknown>>(
  url: string | null,
  options: SSEOptions = {}
): SSEState<T> {
  const { enabled = true, reconnectDelay = 3000 } = options;
  const [data, setData] = useState<T | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!url || !enabled) {
      cleanup();
      setIsConnected(false);
      return;
    }

    const connect = () => {
      cleanup();

      // Build the full URL with auth token
      const token = localStorage.getItem('accessToken');
      const separator = url.includes('?') ? '&' : '?';
      const fullUrl = token ? `${url}${separator}token=${encodeURIComponent(token)}` : url;

      const baseUrl = import.meta.env.VITE_API_URL || '/api/v1';
      const eventSource = new EventSource(`${baseUrl}/sse/${fullUrl}`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'error') {
            setError(parsed.message);
          } else if (parsed.type === 'done') {
            setData(parsed as T);
            // Connection will be closed by server
          } else {
            setData(parsed as T);
            setError(null);
          }
        } catch {
          // ignore parse errors
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.close();
        eventSourceRef.current = null;

        // Auto-reconnect
        reconnectTimerRef.current = setTimeout(() => {
          if (enabled) connect();
        }, reconnectDelay);
      };
    };

    connect();

    return cleanup;
  }, [url, enabled, reconnectDelay, cleanup]);

  return { data, isConnected, error };
}

// Campaign progress SSE types
export interface CampaignProgress {
  type: 'connected' | 'progress' | 'done' | 'error';
  sent?: number;
  failed?: number;
  opened?: number;
  total?: number;
  status?: string;
  currentEmail?: string | null;
  message?: string;
}

export function useCampaignProgress(campaignId: string | null, enabled = true) {
  return useSSE<CampaignProgress>(
    campaignId ? `campaign/${campaignId}` : null,
    { enabled }
  );
}

// Import progress SSE types
export interface ImportProgress {
  type: 'connected' | 'progress' | 'done' | 'waiting' | 'error';
  processed?: number;
  total?: number;
  imported?: number;
  duplicates?: number;
  errors?: number;
  status?: string;
  message?: string;
}

export function useImportProgress(jobId: string | null, enabled = true) {
  return useSSE<ImportProgress>(
    jobId ? `import/${jobId}` : null,
    { enabled }
  );
}
