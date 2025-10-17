# Knowledge Agent (AG2)

Express service that combines the Vercel AI SDK “AG2” stack with a local knowledge base so you can ingest documentation, search it, and chat with a grounded assistant. The project mirrors `mastra-knowledge-agent`, retains the weather demo for parity, and adds a CometChat-compatible streaming endpoint.

## Prerequisites

- Node.js 18+
- `OPENAI_API_KEY`
- Optional: `PORT` (defaults to `3000`)

## Setup

```bash
cd vercel-knowledge-agent/agent
npm install
```

Create `.env` (or export the variables):

```
OPENAI_API_KEY=sk-...
PORT=3000
```

Start the server:

```bash
npm start
```

## Knowledge Base Layout

Markdown/MDX/TXT files are stored under `knowledge/<namespace>`. A starter file lives in `knowledge/default/`. Use the `namespace` field in requests to target specific collections; omitting it falls back to `default`.

## REST APIs (`/api`)

- `POST /tools/ingest` — Ingest URLs, text snippets, or uploaded files (PDF, Markdown, TXT). Response reports `saved`, `skipped`, and `errors`.
- `POST /tools/searchDocs` — Semantic search across the knowledge base.
- `POST /agents/knowledge/generate` — Non-streaming chat that returns `answer`, `toolResults`, and `usage`.

Example ingestion request:

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

## Streaming Agent (`POST /agent`)

The `/agent` route streams Server-Sent Events compatible with the CometChat adapter used in the original Mastra demo. Provide CometChat-formatted messages and optional tools; you’ll receive incremental events (text deltas, tool calls/results, finish markers).

Quick curl to observe the stream:

```bash
curl -N http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user", "content": "Summarize the ingestion workflow." }
        ],
        "toolParams": { "namespace": "docs" }
      }'
```

## Weather Demo (Legacy)

`POST /weather` accepts `{ "query": "Weather in Tokyo" }` and uses an `Experimental_Agent` tool that calls the Open-Meteo API. It remains for parity with the starter Express scaffold.
