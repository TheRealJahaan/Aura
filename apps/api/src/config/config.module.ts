import { Global, Module } from '@nestjs/common';
import { TokenCipher } from '../common/crypto';
import { AppConfig } from './app-config';

@Global()
@Module({
  providers: [
    { provide: AppConfig, useFactory: () => AppConfig.fromEnv() },
    {
      provide: TokenCipher,
      useFactory: (config: AppConfig) => new TokenCipher(config.encryptionKey),
      inject: [AppConfig],
    },
  ],
  exports: [AppConfig, TokenCipher],
})
export class ConfigModule {}
