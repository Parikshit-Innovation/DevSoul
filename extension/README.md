# Extension — VS Code UI

**Owner**: Member D  
**Purpose**: VS Code extension that surfaces DevSoul capabilities directly inside the editor — side panel, commands, inline suggestions, auth, and streaming agent output.

---

## Responsibilities

- Register VS Code commands (`devosoul.analyse`, `devosoul.run`, etc.)
- Side-panel WebView for requirement input and agent status
- Auth flow (API key or OAuth)
- Stream agent output in real-time (via Gateway WebSocket)
- Highlight code linked to requirements

---

## Getting Started

```bash
cd extension
npm install

# Open VS Code extension host
npm run dev        # or press F5 in VS Code to launch Extension Development Host
```

---

## Key Files (suggested structure)

```
extension/
├── README.md           ← you are here
├── package.json        # VS Code extension manifest
├── tsconfig.json
├── src/
│   ├── extension.ts    # Entry point — activate()
│   ├── commands/       # Command handlers
│   ├── panels/         # WebView panel(s)
│   ├── api/            # Gateway client
│   └── auth/
└── media/              # CSS / JS for WebView panels
```

---

## VS Code Extension Manifest

The `package.json` `contributes` field registers:
- `commands` — palette commands
- `views` — side panel
- `configuration` — user settings (gateway URL, API key)
