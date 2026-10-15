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
  };
  http.disable?.('x-powered-by');

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
    .build();
  return SwaggerModule.createDocument(app, document);
}
