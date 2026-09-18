# Project Brain

**Owner**: Member C  
**Purpose**: Long-term contextual memory for a project — vector store, knowledge graph, and retrieval layer that gives agents rich, relevant context.

---

## Responsibilities

- Index and store code, docs, requirements, and conversation history
- Retrieve the most relevant context chunks for a given query
- Maintain a knowledge graph linking concepts, files, and requirements
- Provide a REST API consumed by the Gateway and Agent Factory

---

## Getting Started

```bash
# Install dependencies
# (add your command here)

# You may need a local vector DB (e.g. Qdrant):
# docker run -p 6333:6333 qdrant/qdrant

# Run in dev mode
# (add your command here)
```

---

## API Contract

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/index` | Index a document or code snippet |
| `POST` | `/query` | Retrieve relevant context for a query |
| `DELETE` | `/index/:id` | Remove an indexed document |
| `GET` | `/graph` | Query the knowledge graph |

---

## Directory Structure (suggested)

```
project-brain/
├── README.md       ← you are here
├── src/
│   ├── indexer.py
│   ├── retriever.py
│   ├── graph.py
│   └── api.py
├── tests/
└── requirements.txt (or package.json)
```
