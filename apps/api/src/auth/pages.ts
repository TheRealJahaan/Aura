function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A small self-contained page for the browser tab used during Google sign-in. */
export function renderPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Aura</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5fb; --fg: #1d1b26; --muted: #5d5a6d; --card: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e0d14; --fg: #f1effa; --muted: #a8a4bd; --card: #18161f; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { background: var(--card); border-radius: 20px; padding: 32px; max-width: 420px; text-align: center;
         box-shadow: 0 10px 40px rgba(0,0,0,.12); }
  .orb { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%;
         background: radial-gradient(circle at 35% 30%, #fff 0, #c9b8ff 18%, #7b5cff 45%, #2d1b69 100%); }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0; color: var(--muted); }
</style>
</head>
<body><main><div class="orb"></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}
