Claude Code Viewer - Local Webapp

Quick start

1. cd webapp
2. npm install
3. npm start

Then open http://localhost:6173 in your browser.

What this provides

- Simple Express server exposing APIs to list projects, sessions, and read session `.jsonl` files from `~/.claude/projects`.
- Static SPA to browse projects, sessions, and view message contents.

Progressive enhancement plan

1) Minimal local webapp (this commit)
  - Read-only access to sessions via local HTTP server.
  - No authentication (assumes local machine access only).

2) UX improvements
  - Better UI, pagination, search, date filtering, and nicer message renderer with code blocks.
  - Support for opening session in new tab (link to raw `.jsonl`).

3) Optional features
  - Add indexing for faster search across sessions.
  - Add export / share (zip) endpoints.
  - Add optional basic auth or OS-level checks for multi-user machines.

4) Progressive migration
  - Replace parts of the Electron app with the webapp UI served from local file or embedded server.
  - Keep Electron for desktop specific integrations if needed.

Security notes

- This server reads files under the user's home directory and should not be exposed publicly.
- Recommend binding to localhost and using firewall rules if necessary.
