import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppConfig } from '../config/app-config';
import { GoogleApisFactory } from '../google/google-apis';
import { AgentService } from './agent.service';
import { AssistantController } from './assistant.controller';
import { AnthropicProvider } from './llm/anthropic.provider';
import { OllamaProvider } from './llm/ollama.provider';
import { LlmProvider } from './llm/types';
import { ToolRegistry } from './tools/registry';

export function createLlmProvider(config: AppConfig): LlmProvider {
  const llm = config.llm;
  return llm.provider === 'anthropic'
    ? new AnthropicProvider({ apiKey: llm.apiKey, model: llm.model })
    : new OllamaProvider({ url: llm.url, model: llm.model, numCtx: llm.numCtx });
}

@Module({
  imports: [AuthModule],
  controllers: [AssistantController],
  providers: [
    AgentService,
    GoogleApisFactory,
    { provide: ToolRegistry, useValue: new ToolRegistry() },
    { provide: LlmProvider, useFactory: createLlmProvider, inject: [AppConfig] },
  ],
  exports: [LlmProvider],
})
export class AssistantModule {}
