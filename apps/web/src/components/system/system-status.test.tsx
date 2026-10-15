import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { SystemStatus } from './system-status';

function renderWithProviders(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const timestamp = '2026-10-15T05:00:00.000Z';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SystemStatus', () => {
  it('shows server and database connected when the API is ready', async () => {
    const fetchSpy = mockFetch(200, {
      status: 'ok',
      checks: { database: 'up' },
      timestamp,
    });
    renderWithProviders(<SystemStatus />);

    expect(screen.getByTestId('status-api')).toHaveTextContent('Checking…');
    await waitFor(() =>
      expect(screen.getByTestId('status-api')).toHaveTextContent('Connected'),
    );
    expect(screen.getByTestId('status-database')).toHaveTextContent(
      'Connected',
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/health/ready',
      expect.anything(),
    );
  });

  it('shows the database as not reachable when the API reports 503', async () => {
    mockFetch(503, {
      status: 'unavailable',
      checks: { database: 'down' },
      timestamp,
    });
    renderWithProviders(<SystemStatus />);

    await waitFor(() =>
      expect(screen.getByTestId('status-database')).toHaveTextContent(
        'Not reachable',
      ),
    );
    expect(screen.getByTestId('status-api')).toHaveTextContent('Connected');
  });

  it('shows the server as not reachable when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    renderWithProviders(<SystemStatus />);

    await waitFor(() =>
      expect(screen.getByTestId('status-api')).toHaveTextContent(
        'Not reachable',
      ),
    );
    expect(screen.getByTestId('status-database')).toHaveTextContent(
      'Not reachable',
    );
  });
});
