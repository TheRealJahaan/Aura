import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AuthContext, SessionsService } from './sessions.service';

type AuthedRequest = Request & { auth?: AuthContext };

/** Lets a request through only with a valid `Authorization: Bearer <token>` header. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const match = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '');
    const auth = match ? await this.sessions.verify(match[1]) : null;
    if (!auth) {
      throw new UnauthorizedException('Sign in to Aura first.');
    }
    request.auth = auth;
    return true;
  }
}

/** The signed-in user of a request that passed AuthGuard. */
export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) {
    throw new UnauthorizedException('Sign in to Aura first.');
  }
  return auth;
});
