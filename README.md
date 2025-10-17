# Vercel AI SDK Agent Examples

The repository hosts two Express applications that showcase how to stand up tool-enabled agents and connect them to CometChat or any other SSE-capable client.

- `vercel-knowledge-agent` — Knowledge-base grounded assistant with ingestion, search, and an SSE `/agent` endpoint.
- `product-hunt-agent` — Product Hunt launch assistant that surfaces top posts, Algolia search results, and celebration actions.

Both services share the same Express + Jade skeleton, exposing REST APIs under `/api` and a CometChat-compatible agent stream under `/agent`.

## Prerequisites

- Node.js 18 or newer (Node 20 recommended)
- `OPENAI_API_KEY` with access to GPT-4o or compatible models
- Optional: `PRODUCTHUNT_API_TOKEN` (needed for Product Hunt GraphQL calls)

Clone the repository:

```bash
git clone https://github.com/cometchat/ai-agent-vercel-examples.git
```

## Directory Overview

| Folder | Description |
| --- | --- |
| `vercel-knowledge-agent/agent` | Knowledge agent API + SSE endpoint with ingestion and search workflows. |
| `vercel-knowledge-agent/web` | Static demo page that can be wired to CometChat. |
| `product-hunt-agent/agent` | Product Hunt agent API + SSE endpoint, ported from `product-hunt-agent`. |
| `product-hunt-agent/web` | Product Hunt mock landing page with CometChat embed and API helpers. |

## Quick Start

Each service is self-contained. From the repository root run the following for the agent you want to test.

### Knowledge Agent

```bash
cd vercel-knowledge-agent/agent
npm install
OPENAI_API_KEY=sk-... npm start
```

Key endpoints:
- `POST /api/tools/ingest` — Ingest markdown, text, URLs, or file uploads.
- `POST /api/tools/searchDocs` — Retrieve citations from the knowledge base.
- `POST /api/agents/knowledge/generate` — Non-streaming chat responses.
- `POST /agent` — Server-sent-event stream compatible with the CometChat adapter.

### Product Hunt Agent

```bash
cd product-hunt-agent/agent
npm install
OPENAI_API_KEY=sk-... PRODUCTHUNT_API_TOKEN=phc-... npm start
```

Key endpoints:
- `GET /api/top`, `/api/top-week`, `/api/top-range` — Product Hunt GraphQL lookups.
- `GET /api/search` — Product Hunt Algolia search.
- `POST /api/chat` — Non-streaming chat interface.
- `POST /agent` — SSE stream mirroring the Knowledge Agent contract.

## Testing the `/agent` Stream

Use `curl -N` (or any SSE client) to watch streaming output:

```bash
curl -N http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user", "content": "Show the top Product Hunt launches today." }
        ]
      }'
```

You should see incremental JSON events (text deltas, tool calls/results) identical to the Vercel knowledge agent demo.

## CometChat Integration

Both `/web` directories contain static pages with the CometChat Chat Embed widget. Set `COMETCHAT_USER_UID` (and optionally tweak agent IDs or variants) to test the end-to-end experience:

```html
<script defer src="https://cdn.jsdelivr.net/npm/@cometchat/chat-embed@1.x.x/dist/main.js"></script>
```

The widgets point to the SSE `/agent` routes provided by these services.
