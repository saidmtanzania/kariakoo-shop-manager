import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.setup.js';
import { AppModule } from './app.module.js';
import { APP_CONFIG } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { InvalidConfigError, validateEnv } from './config/env.schema.js';
import { loadLocalEnv } from './load-env.js';

async function bootstrap(): Promise<void> {
  loadLocalEnv();
  // Validate before Nest starts so a bad deployment fails with one clear message.
  validateEnv(process.env);
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Payment callbacks are verified over the exact bytes received.
    rawBody: true,
  });
  configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.PORT);
}

try {
  await bootstrap();
} catch (error) {
  if (error instanceof InvalidConfigError) {
    // The logger is not available yet; write a plain message and stop.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
