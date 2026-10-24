import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  confirmRequestSchema,
  turnRequestSchema,
  type ActivityResponse,
  type ConfirmRequest,
  type TurnRequest,
  type TurnResponse,
  type UndoResponse,
} from '@aura/shared';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/sessions.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgentService } from './agent.service';

@Controller('assistant')
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly agent: AgentService) {}

  /** One thing the user said (or typed). Returns what Aura says back and anything to open. */
  @Post('turn')
  @HttpCode(200)
  turn(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(turnRequestSchema)) body: TurnRequest,
  ): Promise<TurnResponse> {
    return this.agent.turn(auth.userId, body);
  }

  /** The Send / Cancel buttons on a confirmation card. */
  @Post('actions/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(confirmRequestSchema)) body: ConfirmRequest,
  ): Promise<TurnResponse> {
    return this.agent.confirm(auth.userId, id, body.approve);
  }

  @Post('actions/:id/undo')
  @HttpCode(200)
  undo(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string): Promise<UndoResponse> {
    return this.agent.undo(auth.userId, id);
  }

  /** Everything Aura changed in the user's account, newest first. */
  @Get('actions')
  activity(@CurrentAuth() auth: AuthContext): Promise<ActivityResponse> {
    return this.agent.activity(auth.userId);
  }
}
