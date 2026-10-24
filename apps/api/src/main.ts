import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';

function loadEnvFile(): void {
  try {
    // Reads apps/api/.env when it exists. Real environment variables win.
    process.loadEnvFile('.env');
  } catch {
    // No .env file: settings come from the environment.
  }
}

async function bootstrap() {
  loadEnvFile();
  let config: AppConfig;
  try {
    config = AppConfig.fromEnv();
  } catch (err) {
    console.error(`\n${(err as Error).message}\n`);
    process.exit(1);
  }
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // 127.0.0.1 keeps the API on this Mac only; nothing on your network can reach it.
  await app.listen(config.port, config.host);
  Logger.log(`Aura API is running at http://${config.host}:${config.port}`, 'Aura');
  Logger.log(`AI: ${config.llm.provider} (${config.llm.model})`, 'Aura');
}

void bootstrap();
