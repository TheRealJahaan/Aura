import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Logger, Patch, UseGuards } from '@nestjs/common';
import { updateProfileRequestSchema, type UpdateProfileRequest, type UserProfile } from '@aura/shared';
import { isValidTimeZone } from '../common/time';
import { TokenCipher } from '../common/crypto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GoogleOAuth } from '../google/google-oauth';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard, CurrentAuth } from './auth.guard';
import { ProfileService } from './profile.service';
import { type AuthContext, SessionsService } from './sessions.service';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(
    private readonly profiles: ProfileService,
    private readonly prisma: PrismaService,
    private readonly google: GoogleOAuth,
    private readonly cipher: TokenCipher,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext): Promise<UserProfile> {
    return this.profiles.get(auth.userId);
  }

  /** The desktop app sends the computer's time zone so "3 PM" means the user's 3 PM. */
  @Patch()
  async update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
  ): Promise<UserProfile> {
    if (!isValidTimeZone(body.timezone)) {
      throw new BadRequestException([`timezone: "${body.timezone}" is not a known time zone`]);
    }
    await this.prisma.user.update({ where: { id: auth.userId }, data: { timezone: body.timezone } });
    return this.profiles.get(auth.userId);
  }

  /** Disconnects Google: revokes Aura's access at Google and signs out every device. */
  @Delete('google')
  @HttpCode(204)
  async disconnect(@CurrentAuth() auth: AuthContext): Promise<void> {
    const connection = await this.prisma.googleConnection.findUnique({ where: { userId: auth.userId } });
    if (connection) {
      try {
        await this.google.revoke(this.cipher.decrypt(connection.encryptedRefreshToken));
      } catch (err) {
        // Still remove our copy; the user can also revoke at myaccount.google.com/permissions.
        this.logger.warn(`Could not revoke the Google token: ${(err as Error).message}`);
      }
      await this.prisma.googleConnection.delete({ where: { id: connection.id } });
    }
    await this.sessions.revokeAll(auth.userId);
  }
}
