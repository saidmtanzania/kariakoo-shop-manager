import { ApiError, apiFetch } from './api';

function respond(status: number, body?: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/problem+json' },
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('apiFetch', () => {
  it('sends the CSRF header, JSON body and same-origin credentials', async () => {
    const fetchMock = respond(204);
    await expect(
      apiFetch('/auth/login', { method: 'POST', body: { email: 'a@b.tz' } }),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/login');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: '{"email":"a@b.tz"}',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/json',
      },
    });
  });

  it('turns problem details into an ApiError with the API code', async () => {
    respond(401, {
      status: 401,
      code: 'invalid_credentials',
      detail: 'Email or password is incorrect.',
    });
    const err = await apiFetch('/auth/login', {
      method: 'POST',
      body: {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'invalid_credentials' });
  });

  it('reports a network failure as status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    await expect(apiFetch('/auth/session')).rejects.toMatchObject({
      status: 0,
      code: 'network',
    });
  });
});
