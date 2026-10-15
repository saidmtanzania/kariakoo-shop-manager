import { Global, Module } from '@nestjs/common';
import { validateEnv, type AppConfig } from './env.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => validateEnv(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
