import { z } from 'zod';
import { dailyBriefing } from '../features/briefing';
import { meetingTools } from '../features/meetings';
import { calendarTools } from './calendar.tools';
import { contactsTools } from './contacts.tools';
import { driveTools } from './drive.tools';
import { gmailTools } from './gmail.tools';
import { openTools } from './open.tools';
import { tasksTools } from './tasks.tools';
import type { Tool } from './tool';

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input, the format both Ollama and Claude expect. */
  inputSchema: Record<string, unknown>;
}

export const ALL_TOOLS: Tool<unknown>[] = [
  dailyBriefing,
  ...meetingTools,
  ...openTools,
  ...gmailTools,
  ...calendarTools,
  ...tasksTools,
  ...driveTools,
  ...contactsTools,
];

export function toolDefinition(tool: Tool<unknown>): ToolDefinition {
  const { $schema, ...inputSchema } = z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' });
  return { name: tool.name, description: tool.description, inputSchema };
}

export class ToolRegistry {
  private readonly byName: Map<string, Tool<unknown>>;
  readonly definitions: ToolDefinition[];

  constructor(tools: Tool<unknown>[] = ALL_TOOLS) {
    this.byName = new Map(tools.map((tool) => [tool.name, tool]));
    if (this.byName.size !== tools.length) {
      throw new Error('Two tools have the same name');
    }
    this.definitions = tools.map(toolDefinition);
  }

  get(name: string): Tool<unknown> | undefined {
    return this.byName.get(name);
  }
}
