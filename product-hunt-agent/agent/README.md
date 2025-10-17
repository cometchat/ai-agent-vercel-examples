# Product Hunt Agent (AG2)

Express service that wraps the AG2 `Experimental_Agent` to deliver a Product Hunt assistant backed by live tools. The project mirrors the Mastra demo but is implemented with the Vercel AI SDK stack used in this repo.

The agent can:

- Fetch the top Product Hunt posts by total votes or for specific timeframes.
- Search posts via the public Product Hunt Algolia index.
- Chat about Product Hunt launch strategy while grounding responses in tool results.
- Emit a `CONFETTI` action payload that front-ends can map to an animation.

## Prerequisites

- Node.js 18 or newer.
- Environment variables:
  - `OPENAI_API_KEY` — required for chat.
  - `PRODUCTHUNT_API_TOKEN` — optional GraphQL token (endpoints return empty arrays if omitted).
  - `PORT` (optional) — defaults to `3000`.

## Setup

```bash
cd product-hunt-agent/agent
npm install
```

Create `.env` (or export the variables):

```
OPENAI_API_KEY=sk-...
PRODUCTHUNT_API_TOKEN=phc_...
PORT=3000
```

Launch the server:

```bash
npm start
```

By default the app listens on `http://localhost:3000`.

## API

All responses include permissive CORS headers for local demos.

- `GET /api/health` → `{ ok: true }`
- `GET /api/top?limit=3` → top all-time posts by votes (`order: "VOTES"`)
- `GET /api/top-week?limit=3&days=7` → rolling-window ranking (default 7 days)
- `GET /api/top-range?timeframe=today&tz=America/New_York&limit=3` → timeframe-aware ranking
  - Timeframes: `today`, `yesterday`, `this-week`, `last-week`, `this-month`, `last-month`, `YYYY-MM-DD`, or ranges such as `from:2024-08-01 to:2024-08-15`
- `GET /api/search?q=arc&limit=10` → Algolia-backed search hits
- `POST /api/chat` with body `{ "message": "What should I prep for launch day?" }`
  - Returns `{ reply, toolResults, usage }`
- `POST /agent` streams Server-Sent Events (SSE) compatible with the Vercel AI SDK + CometChat adapter. Send `{ messages: [...] }` just like `vercel-knowledge-agent` and you will receive incremental agent events (text deltas, tool traces, completion).

If `PRODUCTHUNT_API_TOKEN` is unset the Product Hunt endpoints return empty arrays, but search and chat remain functional (the agent explains missing data).

Example stream:

```bash
curl -N http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user", "content": "Show me the top Product Hunt launches today." }
        ],
        "toolParams": {
          "timeframe": "today",
          "timezone": "America/New_York",
          "limit": 3
        }
      }'
```

## Agent Details

`lib/producthunt/agent.js` wires an AG2 `Experimental_Agent` with four tools:

- `getTopProducts` — top posts by total votes.
- `getTopProductsByTimeframe` — timeframe + timezone aware rankings.
- `searchProducts` — Product Hunt Algolia lookup.
- `triggerConfetti` — returns a structured payload for frontend celebrations.

Responses include Markdown tables so UIs can render rich summaries.

## Front-End

The `web/` directory hosts a static mock Product Hunt page. Point `window.PH_AGENT_API` inside `web/index.html` at your deployed agent server to wire the UI. Alternatively reuse the chat/embed flow demonstrated in `vercel-knowledge-agent`.
