import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { buildOpenApiDocument, configureApp } from './app.setup.js';
import { AppModule } from './app.module.js';
import { loadLocalEnv } from './load-env.js';

// Writes docs/api/openapi.json without starting the HTTP server or touching
// the database.
loadLocalEnv();
const app = await NestFactory.create(AppModule, { logger: false });
configureApp(app);
const output = resolve(
  import.meta.dirname,
  '..',
  '..',
  'docs',
  'api',
  'openapi.json',
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`,
);
await app.close();
process.stdout.write(`OpenAPI written to ${output}\n`);
