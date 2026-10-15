import {
  type INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';

export const API_PREFIX = 'api';

/**
 * Applies the cross-cutting HTTP conventions (decision A-004). Shared by
 * main.ts, the OpenAPI export and integration tests so they all exercise the
 * same pipeline.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  const http = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (setting: string, value: unknown) => void;
  };
  http.disable?.('x-powered-by');
  // Number of proxy hops whose X-Forwarded-For is trusted (the web app's
  // /api rewrite is one). Client IPs feed rate limits and audit logs.
  http.set?.('trust proxy', config.TRUST_PROXY);
  app.use(cookieParser());

  if (config.SWAGGER_ENABLED) {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, () =>
      buildOpenApiDocument(app),
    );
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = new DocumentBuilder()
    .setTitle('Kariakoo Shop Manager API')
    .setDescription('Versioned REST API. Errors use RFC 9457 problem details.')
    .setVersion('1')
    // Sessions are an HttpOnly cookie; the name has a __Host- prefix over HTTPS.
    .addCookieAuth('ksm_session')
    .build();
  return SwaggerModule.createDocument(app, document);
}
