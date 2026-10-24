import { buildRawEmail, displayName, encodeHeaderText, extractPlainText, htmlToText, parseMailboxes, truncate } from './gmail-format';

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const b64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

describe('buildRawEmail', () => {
  it('builds a valid plain-text email', () => {
    const message = decode(
      buildRawEmail({ to: ['priya@example.com'], cc: ['sam@example.com'], subject: 'Running late', body: 'Hi Priya,\nSee you at 3.' }),
    );
    const [head, body] = message.split('\r\n\r\n');
    expect(head).toBe(
      [
        'To: priya@example.com',
        'Cc: sam@example.com',
        'Subject: Running late',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
      ].join('\r\n'),
    );
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Hi Priya,\r\nSee you at 3.');
  });

  it('wraps long bodies at 76 characters', () => {
    const message = decode(buildRawEmail({ to: ['a@example.com'], subject: 's', body: 'x'.repeat(500) }));
    const lines = message.split('\r\n\r\n')[1].split('\r\n');
    expect(lines.every((line) => line.length <= 76)).toBe(true);
  });

  it('refuses header injection', () => {
    expect(() => buildRawEmail({ to: ['a@example.com'], subject: 'Hi\r\nBcc: spy@evil.com', body: 'x' })).toThrow(
      "The email subject can't contain line breaks",
    );
    expect(() => buildRawEmail({ to: ['a@example.com\nBcc: spy@evil.com'], subject: 'Hi', body: 'x' })).toThrow();
  });

  it('encodes non-ASCII subjects', () => {
    const message = decode(buildRawEmail({ to: ['a@example.com'], subject: 'Café ☕ plans', body: 'x' }));
    expect(message).toContain(`Subject: =?UTF-8?B?${Buffer.from('Café ☕ plans').toString('base64')}?=`);
  });
});

describe('encodeHeaderText', () => {
  it('keeps ASCII as it is', () => {
    expect(encodeHeaderText('Hello there')).toBe('Hello there');
  });

  it('splits long text into encoded words without breaking characters', () => {
    const text = 'नमस्ते '.repeat(12);
    const encoded = encodeHeaderText(text);
    const words = encoded.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    expect(words.every((word) => word.length <= 75)).toBe(true);
    const decoded = words.map((word) => Buffer.from(word.slice(10, -2), 'base64').toString('utf8')).join('');
    expect(decoded).toBe(text);
  });
});

describe('mailboxes', () => {
  it('parses names, quotes and bare addresses', () => {
    expect(parseMailboxes('"Sharma, Priya" <priya@example.com>, sam@example.com, Lee <lee@example.com>')).toEqual([
      { name: 'Sharma, Priya', email: 'priya@example.com' },
      { name: null, email: 'sam@example.com' },
      { name: 'Lee', email: 'lee@example.com' },
    ]);
    expect(displayName('Priya Sharma <priya@example.com>')).toBe('Priya Sharma');
    expect(displayName('noreply@github.com')).toBe('noreply@github.com');
  });
});

describe('extractPlainText', () => {
  it('prefers the text/plain part of a multipart email', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', filename: '', body: { data: b64url('Hello\r\n\r\n\r\n\r\nWorld') } },
        { mimeType: 'text/html', filename: '', body: { data: b64url('<p>Hello</p>') } },
      ],
    };
    expect(extractPlainText(payload)).toBe('Hello\n\nWorld');
  });

  it('falls back to HTML without tags, scripts or styles', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/html',
              filename: '',
              body: { data: b64url('<style>p{}</style><p>Q4 deck &amp; notes</p><script>x()</script><div>Thanks&nbsp;&#33;</div>') },
            },
          ],
        },
      ],
    };
    expect(extractPlainText(payload)).toBe('Q4 deck & notes\nThanks !');
  });

  it('ignores attachments', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64url('attachment') } }],
    };
    expect(extractPlainText(payload)).toBe('');
  });

  it('decodes hex entities and truncates', () => {
    expect(htmlToText('&#x1F600;')).toBe('😀');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
