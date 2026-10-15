import {
  BadRequestException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import {
  ProblemDetailsFilter,
  type ProblemDetails,
} from './problem-details.filter.js';

function run(exception: unknown) {
  const sent: { status?: number; type?: string; body?: ProblemDetails } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    type(t: string) {
      sent.type = t;
      return this;
    },
    json(body: ProblemDetails) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: '/api/v1/things/1', id: 'req-1' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(exception, host);
  return sent;
}

describe('ProblemDetailsFilter', () => {
  it('maps HTTP exceptions to RFC 9457 bodies', () => {
    const sent = run(new NotFoundException('Product not found'));
    expect(sent.status).toBe(404);
    expect(sent.type).toBe('application/problem+json');
    expect(sent.body).toMatchObject({
      status: 404,
      title: 'Not Found',
      code: 'not_found',
      detail: 'Product not found',
      instance: '/api/v1/things/1',
      traceId: 'req-1',
    });
  });

  it('lists validation messages as errors', () => {
    const sent = run(
      new BadRequestException({ message: ['name must be a string'] }),
    );
    expect(sent.body?.errors).toEqual([{ message: 'name must be a string' }]);
    expect(sent.body?.code).toBe('bad_request');
  });

  it('hides details of unexpected errors and logs them', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const sent = run(new Error('connection string with password'));
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain('password');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
