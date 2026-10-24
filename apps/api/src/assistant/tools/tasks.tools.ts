import type { tasks_v1 } from '@googleapis/tasks';
import { z } from 'zod';
import { calendarDaysBetween, plural, speakDay, speakList } from '../../common/time';
import { truncate } from '../../google/gmail-format';
import { dateInput, readDateTime } from './inputs';
import { defineTool, ToolContext, ToolError } from './tool';
import { isGone } from './calendar.tools';

const LIST = '@default';

export interface OpenTask {
  id: string;
  title: string;
  /** The due date as YYYY-MM-DD. Google Tasks keeps dates only, never times. */
  due: string | null;
  notes: string | null;
}

export async function listOpenTasks(ctx: ToolContext): Promise<OpenTask[]> {
  const { tasks } = await ctx.google();
  const res = await tasks.tasks.list({ tasklist: LIST, showCompleted: false, showHidden: false, maxResults: 100 });
  return (res.data.items ?? [])
    .filter((task) => task.id && task.title?.trim() && task.status !== 'completed')
    .map((task) => ({
      id: task.id as string,
      title: (task.title as string).trim(),
      due: task.due ? task.due.slice(0, 10) : null,
      notes: task.notes ? truncate(task.notes, 200) : null,
    }))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}

/** Days until a task is due: 0 today, 1 tomorrow, negative when overdue. */
export function daysUntilDue(task: OpenTask, ctx: ToolContext): number | null {
  if (!task.due) return null;
  return calendarDaysBetween(ctx.now, readDateTime(task.due, ctx.timezone).date, ctx.timezone);
}

function speakDue(due: string, ctx: ToolContext): string {
  return speakDay(readDateTime(due, ctx.timezone).date, ctx.now, ctx.timezone);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function findTaskByTitle(tasks: OpenTask[], title: string): OpenTask {
  const wanted = normalize(title);
  const exact = tasks.filter((task) => normalize(task.title) === wanted);
  const matches = exact.length > 0 ? exact : tasks.filter((task) => normalize(task.title).includes(wanted));
  if (matches.length === 0) {
    throw new ToolError(`I couldn't find an open task called "${title}".`);
  }
  if (matches.length > 1) {
    throw new ToolError(
      `More than one task matches "${title}": ${speakList(matches.slice(0, 5).map((task) => task.title))}. Which one do you mean?`,
    );
  }
  return matches[0];
}

export const tasksList = defineTool({
  name: 'tasks_list',
  description: "List the user's open Google Tasks, soonest due first.",
  schema: z.object({}),
  service: 'tasks',
  risk: 'read',
  summarize: () => 'check your tasks',
  async run(ctx) {
    const open = await listOpenTasks(ctx);
    if (open.length === 0) {
      return { data: { tasks: [] }, say: "You don't have any open tasks. Nice." };
    }
    const dueToday = open.filter((task) => daysUntilDue(task, ctx) === 0);
    const overdue = open.filter((task) => (daysUntilDue(task, ctx) ?? 0) < 0);
    const parts = [`You have ${plural(open.length, 'open task')}.`];
    if (overdue.length > 0) {
      const verb = overdue.length === 1 ? 'is' : 'are';
      parts.push(`${overdue.length} ${verb} overdue: ${speakList(overdue.slice(0, 3).map((task) => task.title))}.`);
    }
    if (dueToday.length > 0) parts.push(`Due today: ${speakList(dueToday.slice(0, 3).map((task) => task.title))}.`);
    if (overdue.length === 0 && dueToday.length === 0) {
      parts.push(`The first is ${open[0].title}${open[0].due ? `, due ${speakDue(open[0].due, ctx)}` : ''}.`);
    }
    return { data: { tasks: open.slice(0, 20) }, say: parts.join(' ') };
  },
});

export const tasksCreate = defineTool({
  name: 'tasks_create',
  description: 'Add a task to the user\'s Google Tasks. Use for reminders and to-dos ("remind me to call mom" means a task titled "Call mom").',
  schema: z.object({
    title: z.string().trim().min(1).max(200),
    due: dateInput.optional().describe('Due date like 2026-10-24. Google Tasks does not store times'),
    notes: z.string().trim().max(1000).optional(),
  }),
  service: 'tasks',
  risk: 'write',
  endsTurn: true,
  summarize: (input, ctx) => `add the task "${input.title}"${input.due ? `, due ${speakDue(input.due, ctx)}` : ''}`,
  async run(ctx, input) {
    const { tasks } = await ctx.google();
    const requestBody: tasks_v1.Schema$Task = { title: input.title, notes: input.notes };
    if (input.due) {
      // Google Tasks stores only the date and ignores the time part.
      requestBody.due = `${input.due}T00:00:00.000Z`;
    }
    const { data } = await tasks.tasks.insert({ tasklist: LIST, requestBody });
    return {
      data: { created: true, id: data.id, title: input.title, due: input.due ?? null },
      say: `Added ${input.title} to your tasks${input.due ? `, due ${speakDue(input.due, ctx)}` : ''}.`,
      undo: { taskId: data.id, title: input.title },
    };
  },
  async undo(ctx, data) {
    const { tasks } = await ctx.google();
    try {
      await tasks.tasks.delete({ tasklist: LIST, task: String(data.taskId) });
    } catch (err) {
      if (isGone(err)) return `${String(data.title)} was already deleted.`;
      throw err;
    }
    return `I removed ${String(data.title)} from your tasks.`;
  },
});

export const tasksComplete = defineTool({
  name: 'tasks_complete',
  description: 'Mark one of the user\'s open Google Tasks as done, by its id from tasks_list or by its title.',
  schema: z
    .object({
      taskId: z.string().trim().min(1).max(200).optional(),
      title: z.string().trim().min(1).max(200).optional().describe('The task title, or part of it'),
    })
    .refine((input) => input.taskId || input.title, { message: 'give taskId or title' }),
  service: 'tasks',
  risk: 'write',
  endsTurn: true,
  summarize: (input) => `mark "${input.title ?? 'that task'}" as done`,
  async run(ctx, input) {
    const { tasks } = await ctx.google();
    let task: { id: string; title: string };
    if (input.taskId) {
      const { data } = await tasks.tasks.get({ tasklist: LIST, task: input.taskId });
      task = { id: input.taskId, title: data.title?.trim() || 'that task' };
    } else {
      task = findTaskByTitle(await listOpenTasks(ctx), input.title as string);
    }
    await tasks.tasks.patch({ tasklist: LIST, task: task.id, requestBody: { status: 'completed' } });
    return {
      data: { completed: true, id: task.id, title: task.title },
      say: `Done. I checked off ${task.title}.`,
      logSummary: `mark "${task.title}" as done`,
      undo: { taskId: task.id, title: task.title },
    };
  },
  async undo(ctx, data) {
    const { tasks } = await ctx.google();
    await tasks.tasks.patch({
      tasklist: LIST,
      task: String(data.taskId),
      requestBody: { status: 'needsAction', completed: null },
    });
    return `${String(data.title)} is back on your list.`;
  },
});

export const tasksTools = [tasksList, tasksCreate, tasksComplete];
