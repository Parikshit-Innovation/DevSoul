# Requirement Intelligence

**Owner**: Member C  
**Purpose**: Parse raw developer intent (natural language, tickets, specs) into structured `Requirement` objects that the rest of the system can act on.

---

## Responsibilities

- Accept free-form requirement text (from Extension or API)
- Use an LLM + parsing pipeline to extract structured data
- Emit `Requirement` objects conforming to `shared/schemas/requirements.schema.yaml`
- Link requirements to existing code files (file-mapping)
- Expose a REST API consumed by the Gateway

---

## Getting Started

```bash
# Install dependencies
# (add your command here)

# Run in dev mode
# (add your command here)
```

---

## API Contract

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/analyse` | Parse raw text into a structured Requirement |
| `GET` | `/requirements/:id` | Retrieve a requirement by ID |
| `GET` | `/requirements` | List requirements for a project |
| `PUT` | `/requirements/:id` | Update requirement status/fields |

---

## Directory Structure (suggested)

```
requirement-intelligence/
├── README.md       ← you are here
├── src/
│   ├── parser.py
│   ├── linker.py      # maps requirements → code files
│   ├── api.py
│   └── prompts/       # LLM prompt templates
├── tests/
└── requirements.txt (or package.json)
```
