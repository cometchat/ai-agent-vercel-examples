# Knowledge Agent (Vercel AI SDK)

Express service that combines the Vercel AI SDK with a local knowledge base so you can ingest documentation, search it, and chat with a grounded assistant. The project also keeps the original weather demo endpoint for reference.

## Prerequisites

- Node.js 18 or newer
- `OPENAI_API_KEY` available in your environment or a local `.env`

Install dependencies once:

```bash
npm install
```

## Run the Server

Create `.env` in the project root:

```
OPENAI_API_KEY=sk-...
# Optional
PORT=4000
```

Start the app:

```bash
npm start
```

The server listens on `http://localhost:3000` by default.

## Knowledge Base Layout

Documents live under `knowledge/<namespace>`. Markdown, MDX, and TXT files are indexed. A sample file ships in `knowledge/default/` to keep the default namespace warm.

- Provide `namespace` in requests to route content
- Omit it to fall back to `default`

## APIs

Base path: `http://localhost:3000/api`

### `POST /tools/ingest`

Add URLs, plain text, or markdown into a namespace.

```bash
curl -s -X POST http://localhost:3000/api/tools/ingest \
  -H "Content-Type: application/json" \
  -d '{
        "namespace": "docs",
        "sources": [
          "https://vercel.com/docs",
          {
            "type": "text",
            "title": "Roadmap",
            "text": "Q4 focuses on knowledge tooling."
          }
        ]
      }'
```

Response lists saved files plus any per-source errors. HTML pages are converted to markdown; other text types are stored as-is.

Upload files (PDF, Markdown, or TXT) with multipart form data:

```bash
curl -s -X POST http://localhost:3000/api/tools/ingest \
  -F namespace=docs \
  -F files=@/path/to/guide.pdf \
  -F files=@/path/to/readme.md
```

The ingester extracts text from PDFs, enforces a 6 MB upload limit (and 200 kB per text source), deduplicates identical content, and reports `saved`, `skipped`, and `errors` with counts.

### `POST /tools/searchDocs`

Retrieve relevant snippets.

```bash
curl -s -X POST http://localhost:3000/api/tools/searchDocs \
  -H "Content-Type: application/json" \
  -d '{"query":"Explain the ingestion flow","namespace":"docs","maxResults":3}'
```

Returns scored hits with short excerpts and the file names used as citations.

### `POST /agents/knowledge/generate`

Chat with the assistant.

```bash
curl -s -X POST http://localhost:3000/api/agents/knowledge/generate \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user", "content": "Summarize the docs ingestion flow" }
        ],
        "toolParams": { "namespace": "docs" }
      }'
```

Response includes the grounded answer, tool call traces, and token usage.

## Weather Demo (legacy)

The original weather example is still available:

- `POST /weather` with `{ "query": "Weather in Tokyo" }`

It uses `Experimental_Agent` with a single tool that calls the Open-Meteo API.
