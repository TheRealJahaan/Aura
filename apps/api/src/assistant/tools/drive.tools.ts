import type { drive_v3 } from '@googleapis/drive';
import { z } from 'zod';
import { plural, speakDay } from '../../common/time';
import { withAccount } from '../../google/links';
import { defineTool, ToolContext } from './tool';

const FILE_KINDS: Record<string, string> = {
  'application/vnd.google-apps.document': 'Doc',
  'application/vnd.google-apps.spreadsheet': 'Sheet',
  'application/vnd.google-apps.presentation': 'Slides deck',
  'application/vnd.google-apps.folder': 'folder',
  'application/vnd.google-apps.form': 'Form',
  'application/pdf': 'PDF',
};

/** Drive's query language puts values in single quotes, so quotes and backslashes must be escaped. */
export function escapeDriveValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Every word must appear in the file name. */
export function driveNameQuery(words: string[]): string {
  const terms = words.map((word) => `name contains '${escapeDriveValue(word)}'`);
  return [...terms, 'trashed = false'].join(' and ');
}

export interface DriveFile {
  id: string;
  name: string;
  kind: string;
  modified: string | null;
  link: string | null;
  modifiedAt: Date | null;
}

export async function searchDrive(
  drive: drive_v3.Drive,
  ctx: ToolContext,
  q: string,
  pageSize: number,
): Promise<DriveFile[]> {
  const res = await drive.files.list({
    q,
    pageSize,
    orderBy: 'modifiedTime desc',
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    spaces: 'drive',
  });
  return (res.data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? '(untitled)',
    kind: FILE_KINDS[file.mimeType ?? ''] ?? 'file',
    modified: file.modifiedTime ?? null,
    link: file.webViewLink ? withAccount(file.webViewLink, ctx.email) : null,
    modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
  }));
}

export function driveFileForAi(file: DriveFile): Omit<DriveFile, 'modifiedAt'> {
  const { modifiedAt, ...rest } = file;
  return rest;
}

export const driveSearch = defineTool({
  name: 'drive_search',
  description: "Find files in the user's Google Drive by words in the file name. Aura can see names, not file contents.",
  schema: z.object({
    query: z.string().trim().min(1).max(100).describe('Words from the file name'),
  }),
  service: 'drive',
  risk: 'read',
  summarize: (input) => `search Drive for "${input.query}"`,
  async run(ctx, input) {
    const { drive } = await ctx.google();
    const words = input.query.split(/\s+/).filter(Boolean).slice(0, 5);
    const files = await searchDrive(drive, ctx, driveNameQuery(words), 5);
    const data = { files: files.map(driveFileForAi) };
    if (files.length === 0) {
      return { data, say: `I couldn't find any files named like "${input.query}".` };
    }
    const [first] = files;
    const edited = first.modifiedAt ? `, last edited ${speakDay(first.modifiedAt, ctx.now, ctx.timezone)}` : '';
    const say =
      files.length === 1
        ? `I found the ${first.kind} ${first.name}${edited}.`
        : `I found ${plural(files.length, 'file')}. The most recent is the ${first.kind} ${first.name}${edited}.`;
    return { data, say };
  },
});

export const driveTools = [driveSearch];
