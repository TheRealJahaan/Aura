import { randomUUID } from 'node:crypto';
import {
  ActivityResponse,
  ClientAction,
  GoogleService,
  isAllowedOpenUrl,
  PendingConfirmation,
  TurnRequest,
  TurnResponse,
  UndoResponse,
} from '@aura/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActionLog, MessageRole, Prisma, User } from '@prisma/client';
import { GoogleApisFactory } from '../google/google-apis';
import { describeGoogleError } from '../google/google-errors';
import { PrismaService } from '../prisma/prisma.service';
import { matchIntent, parseConfirmation } from './intents';
import { LlmError, LlmMessage, LlmProvider, ToolCall } from './llm/types';
import { contextLine, SYSTEM_PROMPT, toSpeech } from './system-prompt';
import { ToolRegistry } from './tools/registry';
import { requiresConfirmation, Tool, ToolContext, ToolError, ToolOutput } from './tools/tool';

/** How many times the AI may call tools before it must answer. */
const MAX_STEPS = 5;
/** After this long without a message, "Aura listen" starts a fresh conversation. */
const CONVERSATION_IDLE_MS = 15 * 60_000;
/**
 * Long conversations start over instead of dropping old messages. Dropping
 * messages would change what the AI has already seen, which breaks its cache
 * (and Claude rejects replayed thinking after the history changes).
 */
const MAX_CONVERSATION_MESSAGES = 60;
const MAX_TOOL_RESULT_CHARS = 8_000;

type ToolStepResult =
  | {
      kind: 'done';
      message: Extract<LlmMessage, { role: 'tool' }>;
      ok: boolean;
      say: string;
      actions: ClientAction[];
      services: GoogleService[];
      endsTurn: boolean;
    }
  | { kind: 'pending'; confirmation: PendingConfirmation; prompt: string };

/** The action log row to update (a confirmed action), or where a new row belongs. */
interface LogTarget {
  id: string | null;
  conversationId: string;
}

interface Turn {
  conversationId: string;
  actions: ClientAction[];
  services: Set<GoogleService>;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleApis: GoogleApisFactory,
    private readonly llm: LlmProvider,
    private readonly registry: ToolRegistry,
  ) {}

  // ---------------------------------------------------------------- turns

  async turn(userId: string, request: TurnRequest): Promise<TurnResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ctx = this.context(user);
    const conversationId = await this.openConversation(userId, request.conversationId);
    const turn: Turn = { conversationId, actions: [], services: new Set() };
    const text = request.text;

    const pending = await this.prisma.actionLog.findFirst({
      where: { conversationId, userId, status: 'PENDING_CONFIRMATION' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      const answer = parseConfirmation(text);
      if (answer !== null) {
        // The yes/no is kept for the record, but the AI sees the tool result instead.
        await this.saveMessage(conversationId, 'USER', text, null);
        return this.resolvePending(ctx, pending, answer, turn);
      }
      // Saying something else means "not that": the waiting action is cancelled.
      await this.cancelPending(pending, 'The user moved on without confirming, so this was not done.');
    }

    const intent = matchIntent(text, ctx);
    if (intent?.type === 'dismiss') {
      await this.saveMessage(conversationId, 'USER', text, null);
      const reply = pending ? `Okay, I won't ${pending.summary}.` : 'Okay.';
      await this.saveMessage(conversationId, 'ASSISTANT', reply, null);
      return this.respond(turn, reply, null);
    }

    const userMessage: LlmMessage = { role: 'user', text: `${contextLine(ctx)}\n\n${text}` };
    await this.saveMessage(conversationId, 'USER', text, userMessage);

    if (intent?.type === 'tool' && this.registry.get(intent.tool)) {
      return this.runFastPath(ctx, turn, intent.tool, intent.input);
    }
    return this.runAgent(ctx, turn);
  }

  /** A command Aura recognized on its own. It is saved as if the AI had called the tool, so follow-ups make sense. */
  private async runFastPath(ctx: ToolContext, turn: Turn, toolName: string, input: Record<string, unknown>) {
    const call: ToolCall = { id: `fast_${randomUUID()}`, name: toolName, input };
    await this.saveMessage(turn.conversationId, 'ASSISTANT', '', { role: 'assistant', text: '', toolCalls: [call] });
    const result = await this.executeCall(ctx, turn, call);
    if (result.kind === 'pending') {
      return this.respond(turn, result.prompt, result.confirmation);
    }
    await this.saveMessage(turn.conversationId, 'TOOL', call.name, result.message);
    this.collect(turn, result);
    await this.saveAssistantText(turn.conversationId, result.say);
    return this.respond(turn, result.say, null);
  }

  private async runAgent(ctx: ToolContext, turn: Turn): Promise<TurnResponse> {
    const messages = await this.history(turn.conversationId);
    let lastSay: string | null = null;

    for (let step = 0; step < MAX_STEPS; step++) {
      let reply;
      try {
        reply = await this.llm.chat({ system: SYSTEM_PROMPT, messages, tools: this.registry.definitions });
      } catch (err) {
        const message = err instanceof LlmError ? err.message : 'Something went wrong with the AI. Try again.';
        if (!(err instanceof LlmError)) this.logger.error(`AI request failed: ${(err as Error).message}`);
        return this.respond(turn, lastSay ? `${lastSay} ${message}` : message, null);
      }
      const assistant: LlmMessage = { role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw };
      await this.saveMessage(turn.conversationId, 'ASSISTANT', reply.text, assistant);
      messages.push(assistant);

      if (reply.toolCalls.length === 0) {
        const spoken = toSpeech(reply.text) || lastSay || "Sorry, I didn't get that. Could you say it another way?";
        return this.respond(turn, spoken, null);
      }

      let pending: Extract<ToolStepResult, { kind: 'pending' }> | null = null;
      const says: string[] = [];
      let allEndTurn = true;
      for (const call of reply.toolCalls) {
        if (pending) {
          // Only one action can wait for a yes at a time; the AI can ask again afterwards.
          const message = this.toolMessage(call, 'Not done: another action is waiting for the user to confirm.', true);
          await this.saveMessage(turn.conversationId, 'TOOL', call.name, message);
          messages.push(message);
          continue;
        }
        const result = await this.executeCall(ctx, turn, call);
        if (result.kind === 'pending') {
          pending = result;
          continue;
        }
        await this.saveMessage(turn.conversationId, 'TOOL', call.name, result.message);
        messages.push(result.message);
        this.collect(turn, result);
        says.push(result.say);
        lastSay = result.say;
        allEndTurn &&= result.ok && result.endsTurn;
      }
      if (pending) {
        return this.respond(turn, pending.prompt, pending.confirmation);
      }
      if (allEndTurn) {
        // Every tool already said what happened, so there is nothing for the AI to add.
        const spoken = says.join(' ');
        await this.saveAssistantText(turn.conversationId, spoken);
        return this.respond(turn, spoken, null);
      }
    }
    return this.respond(turn, lastSay ?? "Sorry, I couldn't finish that. Try asking in a simpler way.", null);
  }

  // ---------------------------------------------------------------- tools

  private async executeCall(ctx: ToolContext, turn: Turn, call: ToolCall): Promise<ToolStepResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return this.failure(call, `There is no tool called ${call.name}.`, null);
    }
    const parsed = tool.schema.safeParse(call.input ?? {});
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`);
      return this.failure(call, `Invalid input for ${tool.name}. ${problems.join('; ')}`, tool);
    }
    const input = parsed.data;
    try {
      tool.validate?.(input, ctx);
    } catch (err) {
      if (err instanceof ToolError) return this.failure(call, err.message, tool);
      throw err;
    }
    const summary = tool.summarize(input, ctx);

    if (requiresConfirmation(tool, input)) {
      const log = await this.prisma.actionLog.create({
        data: {
          userId: ctx.userId,
          conversationId: turn.conversationId,
          toolCallId: call.id,
          tool: tool.name,
          summary,
          input: input as Prisma.InputJsonValue,
          status: 'PENDING_CONFIRMATION',
        },
      });
      return {
        kind: 'pending',
        confirmation: { actionId: log.id, summary: capitalize(summary), details: tool.details?.(input, ctx) ?? [] },
        prompt: `I'm about to ${summary}. Should I go ahead?`,
      };
    }
    return this.runTool(ctx, tool, input, call, summary, { id: null, conversationId: turn.conversationId });
  }

  private async runTool(
    ctx: ToolContext,
    tool: Tool<unknown>,
    input: unknown,
    call: ToolCall,
    summary: string,
    log: LogTarget,
  ): Promise<Extract<ToolStepResult, { kind: 'done' }>> {
    const logged = tool.risk !== 'read';
    let output: ToolOutput;
    try {
      output = await tool.run(ctx, input);
    } catch (err) {
      const expected = err instanceof ToolError;
      const message = expected ? err.message : describeGoogleError(err, tool.service);
      if (!expected) this.logger.warn(`${tool.name} failed: ${(err as Error).message}`);
      // A ToolError on a new action means the request didn't make sense, not that
      // something went wrong, so only real failures (and confirmed actions) are logged.
      if (log.id || (logged && !expected)) {
        await this.saveLog(ctx, log, tool, input, call, summary, { status: 'FAILED', error: message });
      }
      return this.failure(call, message, tool);
    }
    if (logged) {
      await this.saveLog(ctx, log, tool, input, call, output.logSummary ?? summary, {
        status: 'SUCCEEDED',
        result: { data: output.data, undo: output.undo ?? null } as Prisma.InputJsonValue,
      });
    }
    const service = tool.serviceFor ? tool.serviceFor(input) : tool.service;
    return {
      kind: 'done',
      message: this.toolMessage(call, JSON.stringify(output.data ?? null), false),
      ok: true,
      say: output.say,
      // Defense in depth: even if a tool returns some other link, only Google pages are opened.
      actions: (output.actions ?? []).filter((action) => isAllowedOpenUrl(action.url)),
      services: output.services ?? (service ? [service] : []),
      endsTurn: tool.endsTurn === true,
    };
  }

  private failure(call: ToolCall, message: string, tool: Tool<unknown> | null): Extract<ToolStepResult, { kind: 'done' }> {
    return {
      kind: 'done',
      message: this.toolMessage(call, message, true),
      ok: false,
      say: message,
      actions: [],
      services: tool?.service ? [tool.service] : [],
      endsTurn: false,
    };
  }

  private async saveLog(
    ctx: ToolContext,
    log: LogTarget,
    tool: Tool<unknown>,
    input: unknown,
    call: ToolCall,
    summary: string,
    outcome: { status: 'SUCCEEDED' | 'FAILED'; result?: Prisma.InputJsonValue; error?: string },
  ): Promise<void> {
    if (log.id) {
      await this.prisma.actionLog.update({ where: { id: log.id }, data: { ...outcome, summary } });
      return;
    }
    await this.prisma.actionLog.create({
      data: {
        userId: ctx.userId,
        conversationId: log.conversationId,
        toolCallId: call.id,
        tool: tool.name,
        summary,
        input: (input ?? {}) as Prisma.InputJsonValue,
        ...outcome,
      },
    });
  }

  // ---------------------------------------------------------------- confirmations

  async confirm(userId: string, actionId: string, approve: boolean): Promise<TurnResponse> {
    const log = await this.prisma.actionLog.findFirst({ where: { id: actionId, userId } });
    if (!log || !log.conversationId) {
      throw new NotFoundException('That action no longer exists.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const turn: Turn = { conversationId: log.conversationId, actions: [], services: new Set() };
    return this.resolvePending(this.context(user), log, approve, turn);
  }

  private async resolvePending(ctx: ToolContext, log: ActionLog, approve: boolean, turn: Turn): Promise<TurnResponse> {
    const tool = this.registry.get(log.tool);
    const call: ToolCall = { id: log.toolCallId ?? log.id, name: log.tool, input: log.input };
    // Claim the action first, so a double tap (or a yes typed twice) can't run it twice.
    const claimed = await this.prisma.actionLog.updateMany({
      where: { id: log.id, status: 'PENDING_CONFIRMATION' },
      data: approve ? { status: 'SUCCEEDED' } : { status: 'CANCELLED' },
    });
    if (claimed.count === 0) {
      return this.respond(turn, 'That was already taken care of.', null);
    }
    if (approve && !tool) {
      await this.prisma.actionLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: 'Unknown tool' } });
      return this.respond(turn, "Sorry, I can't do that any more. Please ask again.", null);
    }
    if (!approve || !tool) {
      const reply = `Okay, I won't ${log.summary}.`;
      await this.saveMessage(turn.conversationId, 'TOOL', log.tool, this.toolMessage(call, 'The user said no, so this was not done.', false));
      await this.saveAssistantText(turn.conversationId, reply);
      return this.respond(turn, reply, null);
    }
    const parsed = tool.schema.safeParse(log.input);
    if (!parsed.success) {
      await this.prisma.actionLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: 'Saved input was invalid' } });
      return this.respond(turn, "Sorry, I couldn't do that. Please ask again.", null);
    }
    const result = await this.runTool(ctx, tool, parsed.data, call, log.summary, {
      id: log.id,
      conversationId: turn.conversationId,
    });
    await this.saveMessage(turn.conversationId, 'TOOL', log.tool, result.message);
    this.collect(turn, result);
    await this.saveAssistantText(turn.conversationId, result.say);
    return this.respond(turn, result.say, null);
  }

  private async cancelPending(log: ActionLog, reason: string): Promise<void> {
    const claimed = await this.prisma.actionLog.updateMany({
      where: { id: log.id, status: 'PENDING_CONFIRMATION' },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count > 0 && log.conversationId) {
      const call: ToolCall = { id: log.toolCallId ?? log.id, name: log.tool, input: log.input };
      await this.saveMessage(log.conversationId, 'TOOL', log.tool, this.toolMessage(call, reason, true));
    }
  }

  // ---------------------------------------------------------------- undo

  async undo(userId: string, actionId: string): Promise<UndoResponse> {
    const log = await this.prisma.actionLog.findFirst({ where: { id: actionId, userId } });
    if (!log) {
      throw new NotFoundException('That action no longer exists.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    try {
      return { reply: await this.performUndo(this.context(user), log) };
    } catch (err) {
      return { reply: (err as Error).message };
    }
  }

  /** Undoes the newest action, or explains why it can't be undone. Throws ToolError with a spoken reason. */
  private async undoLast(ctx: ToolContext): Promise<ToolOutput> {
    const last = await this.prisma.actionLog.findFirst({
      where: { userId: ctx.userId, status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) {
      throw new ToolError("There's nothing for me to undo.");
    }
    const say = await this.performUndo(ctx, last);
    return { data: { undone: last.summary }, say };
  }

  private async performUndo(ctx: ToolContext, log: ActionLog): Promise<string> {
    const tool = this.registry.get(log.tool);
    const undoData = undoDataOf(log);
    if (log.status === 'UNDONE') {
      throw new ToolError('That was already undone.');
    }
    if (log.status !== 'SUCCEEDED' || !tool?.undo || !undoData) {
      throw new ToolError(
        log.tool === 'gmail_send'
          ? "The last thing I did was send an email, and sent emails can't be unsent. That's why I always ask first."
          : `I can't undo "${log.summary}".`,
      );
    }
    const claimed = await this.prisma.actionLog.updateMany({
      where: { id: log.id, status: 'SUCCEEDED' },
      data: { status: 'UNDONE' },
    });
    if (claimed.count === 0) {
      throw new ToolError('That was already undone.');
    }
    try {
      return await tool.undo(ctx, undoData);
    } catch (err) {
      await this.prisma.actionLog.update({ where: { id: log.id }, data: { status: 'SUCCEEDED' } });
      throw new ToolError(err instanceof ToolError ? err.message : describeGoogleError(err, tool.service));
    }
  }

  async activity(userId: string): Promise<ActivityResponse> {
    const logs = await this.prisma.actionLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: logs.map((log) => ({
        id: log.id,
        tool: log.tool,
        summary: capitalize(log.summary),
        status: log.status,
        error: log.error,
        createdAt: log.createdAt.toISOString(),
        undoable: log.status === 'SUCCEEDED' && !!this.registry.get(log.tool)?.undo && !!undoDataOf(log),
      })),
    };
  }

  // ---------------------------------------------------------------- helpers

  private context(user: User): ToolContext {
    let account: ReturnType<GoogleApisFactory['forUser']> | null = null;
    const ctx: ToolContext = {
      userId: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      now: new Date(),
      google: async () => {
        account ??= this.googleApis.forUser(user.id);
        try {
          return (await account).apis;
        } catch (err) {
          account = null;
          throw err;
        }
      },
      undoLast: () => this.undoLast(ctx),
    };
    return ctx;
  }

  private async openConversation(userId: string, requestedId?: string): Promise<string> {
    if (requestedId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: requestedId, userId },
        include: { messages: { orderBy: { seq: 'desc' }, take: 1, select: { createdAt: true } } },
      });
      if (existing) {
        const lastAt = existing.messages[0]?.createdAt ?? existing.startedAt;
        const count = await this.prisma.message.count({ where: { conversationId: existing.id } });
        if (Date.now() - lastAt.getTime() < CONVERSATION_IDLE_MS && count < MAX_CONVERSATION_MESSAGES) {
          return existing.id;
        }
        // An old conversation can't have a pending action any more.
        await this.prisma.actionLog.updateMany({
          where: { conversationId: existing.id, status: 'PENDING_CONFIRMATION' },
          data: { status: 'CANCELLED' },
        });
      }
    }
    const created = await this.prisma.conversation.create({ data: { userId } });
    return created.id;
  }

  private async history(conversationId: string): Promise<LlmMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, content: { not: Prisma.DbNull } },
      orderBy: { seq: 'asc' },
      select: { content: true },
    });
    return rows.map((row) => row.content as unknown as LlmMessage);
  }

  private async saveMessage(conversationId: string, role: MessageRole, text: string, content: LlmMessage | null) {
    await this.prisma.message.create({
      data: {
        conversationId,
        role,
        text,
        content: content === null ? Prisma.DbNull : (content as unknown as Prisma.InputJsonValue),
      },
    });
  }

  private saveAssistantText(conversationId: string, text: string) {
    return this.saveMessage(conversationId, 'ASSISTANT', text, { role: 'assistant', text, toolCalls: [] });
  }

  private toolMessage(call: ToolCall, content: string, isError: boolean): Extract<LlmMessage, { role: 'tool' }> {
    const trimmed = content.length > MAX_TOOL_RESULT_CHARS ? `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…` : content;
    return { role: 'tool', toolCallId: call.id, name: call.name, content: trimmed, isError };
  }

  private collect(turn: Turn, result: Extract<ToolStepResult, { kind: 'done' }>): void {
    turn.actions.push(...result.actions);
    result.services.forEach((service) => turn.services.add(service));
  }

  private respond(turn: Turn, reply: string, pendingConfirmation: PendingConfirmation | null): TurnResponse {
    return {
      conversationId: turn.conversationId,
      reply,
      actions: turn.actions,
      pendingConfirmation,
      services: [...turn.services],
    };
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function undoDataOf(log: ActionLog): Record<string, unknown> | null {
  const result = log.result as { undo?: Record<string, unknown> | null } | null;
  return result?.undo ?? null;
}
