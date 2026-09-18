# Architecture Intelligence

Interactive CLI that interviews you about your tech stack and writes the result to `architecture.yaml` inside your `.devos` folder.

## Flow

```
requirements.yaml  (written by teammate)
        ↓
  npm run demo      ← you answer questions interactively
        ↓
  architecture.yaml (written back to .devos)
        ↓
   Project Brain    (reads and stores it)
```

## Setup

```bash
cd architecture-intelligence
npm install
cp .env.example .env
# add your GEMINI_API_KEY to .env
```

## Run

```bash
npm run demo
```

The CLI will ask 8 questions (Frontend, Backend, Database, Auth, DevOps, Caching, Messaging, Storage).

### Answering options

| Input | What happens |
|---|---|
| `React` | Used as-is |
| `you choose` | Gemini picks the best tech for your requirements |
| `React, Vue, Next.js` | Gemini analyses all three and recommends the best one |

## Output — `architecture.yaml`

```yaml
project: MyApp
generatedAt: '2024-01-01T00:00:00.000Z'
components:
  - name: Frontend
    technology: React
  - name: Backend
    technology: FastAPI
  - name: Database
    technology: PostgreSQL
diagram: |
  graph TD
    frontend["Frontend<br/>React"] --> backend["Backend<br/>FastAPI"]
    backend --> database["Database<br/>PostgreSQL"]
```

## LLM Providers

Set `LLM_PROVIDER` in `.env`:

| Value | Description |
|---|---|
| `gemini` | Google Gemini API (default) |
| `ollama` | Local Ollama instance |
| `ide` | Stub — future VS Code / Antigravity integration |

## Tests

```bash
npm test
```
