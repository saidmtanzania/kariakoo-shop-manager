import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * API error body, following RFC 9457 (problem details). Decision A-004.
 * `code` is a stable machine-readable identifier; `errors` lists field-level
 * validation problems.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  instance?: string;
  traceId?: string;
  errors?: { field?: string; message: string }[];
}

const PROBLEM_TYPE_BASE = 'https://kariakoo-shop-manager.local/problems/';

function codeForStatus(status: number): string {
  const name = HttpStatus[status];
  return typeof name === 'string' ? name.toLowerCase() : 'error';
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string | number }>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception);
    problem.instance = request.originalUrl;
    if (request.id !== undefined) problem.traceId = String(request.id);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, traceId: problem.traceId },
        'Unhandled error while processing request',
      );
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (!(exception instanceof HttpException)) {
      // Never leak internal error messages to clients.
      return {
        type: `${PROBLEM_TYPE_BASE}internal_server_error`,
        title: 'Internal Server Error',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'internal_server_error',
      };
    }

    const status = exception.getStatus();
    const body = exception.getResponse();
    const code =
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
        ? body.code
        : codeForStatus(status);
    const title = HttpStatus[status]
      ? String(HttpStatus[status])
          .toLowerCase()
          .replace(
            /(^|_)(\w)/g,
            (_m, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase(),
          )
      : 'Error';

    const problem: ProblemDetails = {
      type: `${PROBLEM_TYPE_BASE}${code}`,
      title,
      status,
      code,
    };

    if (typeof body === 'string') {
      problem.detail = body;
    } else if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (Array.isArray(message)) {
        // ValidationPipe returns an array of messages.
        problem.detail = 'The request is invalid.';
        problem.errors = message.map((m) => ({ message: String(m) }));
      } else if (typeof message === 'string') {
        problem.detail = message;
      }
    }
    return problem;
  }
}
