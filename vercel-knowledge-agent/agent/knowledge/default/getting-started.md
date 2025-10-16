# Knowledge Agent Quickstart

The knowledge agent stores markdown documents inside the `knowledge/<namespace>` directory.

1. Use the `/api/tools/ingest` endpoint to add URLs, markdown, or plain text into the knowledge base.
2. Query existing content with `/api/tools/searchDocs`.
3. Send your chat payload to `/api/agents/knowledge/generate` to receive grounded answers with citations.

This sample file ensures the default namespace is present when the server boots. Feel free to delete it after ingesting your own content.
