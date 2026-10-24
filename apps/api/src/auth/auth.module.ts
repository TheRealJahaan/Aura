import { Module } from '@nestjs/common';
import { GoogleOAuth, GoogleOAuthClient } from '../google/google-oauth';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { ProfileService } from './profile.service';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    AuthGuard,
    ProfileService,
    SessionsService,
    { provide: GoogleOAuth, useClass: GoogleOAuthClient },
  ],
  exports: [AuthGuard, ProfileService, SessionsService, GoogleOAuth],
})
export class AuthModule {}
