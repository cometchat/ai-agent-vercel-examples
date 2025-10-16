var express = require('express');
var { streamText, stepCountIs } = require('ai');
var { openai } = require('@ai-sdk/openai');
var {
  convertCometChatMessagesToVercelMessages,
  convertCometChatToolsToVercelAISDKTools,
  mapVercelStreamChunkToCometChatEvent
} = require('@cometchat/vercel-adapter');
var { createDocsRetrieverTool, buildSystemPrompt } = require('../lib/knowledge/agent');
var { DEFAULT_NAMESPACE } = require('../lib/knowledge/storage');

var router = express.Router();

function parseNamespace(body) {
  if (
    body &&
    body.toolParams &&
    typeof body.toolParams.namespace === 'string' &&
    body.toolParams.namespace.trim().length > 0
  ) {
    return body.toolParams.namespace.trim();
  }
  return DEFAULT_NAMESPACE;
}

function ensureTemperature(value, fallback) {
  var parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function sendSseEvent(res, event) {
  res.write('data: ' + JSON.stringify(event) + '\n\n');
}

router.post('/', async function (req, res) {
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: 'Server configuration error',
      detail: 'Set the OPENAI_API_KEY environment variable before using the knowledge agent.'
    });
    return;
  }

  var rawMessages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  if (rawMessages.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty array of messages.' });
    return;
  }

  try {
    console.log('Received /agent request:', JSON.stringify(req.body, null, 2));
  } catch (error) {
    console.log('Received /agent request (unable to stringify payload).');
  }

  var threadId =
    typeof req.body.threadId === 'string' && req.body.threadId.trim().length > 0
      ? req.body.threadId.trim()
      : 'thread_1';
  var runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  var namespace = parseNamespace(req.body);

  var convertedMessages;
  try {
    convertedMessages = convertCometChatMessagesToVercelMessages(rawMessages);
  } catch (error) {
    res.status(400).json({
      error: 'Invalid messages payload',
      detail: error && error.message ? error.message : String(error)
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  var docsRetrieverTool = createDocsRetrieverTool(namespace);
  var systemPrompt = buildSystemPrompt({ defaultNamespace: namespace });

  var extraTools = {};
  if (Array.isArray(req.body && req.body.tools) && req.body.tools.length > 0) {
    try {
      extraTools = convertCometChatToolsToVercelAISDKTools(req.body.tools);
    } catch (error) {
      sendSseEvent(res, {
        type: 'error',
        message: 'Failed to import external tools',
        error: error && error.message ? error.message : String(error),
        threadId: threadId,
        runId: runId,
        timestamp: Date.now()
      });
      res.end();
      return;
    }
  }

  var tools = Object.assign({ docsRetriever: docsRetrieverTool }, extraTools);
  var temperature = ensureTemperature(process.env.TEMPERATURE, 0.7);

  try {
    var stream = await streamText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      system: systemPrompt,
      messages: convertedMessages,
      tools: tools,
      temperature: temperature,
      stopWhen: stepCountIs(100)
    });

    var eventCount = 0;

    for await (const chunk of stream.fullStream) {
      var events = mapVercelStreamChunkToCometChatEvent(chunk) || [];
      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        event.threadId = threadId;
        event.runId = runId;
        if (typeof event.timestamp !== 'number') {
          event.timestamp = Date.now();
        }
        sendSseEvent(res, event);
        eventCount += 1;
      }
    }

    console.log('Stream completed for run: ' + runId + ', sent ' + eventCount + ' events');

    res.end();
  } catch (error) {
    sendSseEvent(res, {
      type: 'error',
      message: 'Agent processing failed',
      error: process.env.NODE_ENV === 'development' ? error && error.message ? error.message : String(error) : 'Internal server error',
      threadId: threadId,
      runId: runId,
      timestamp: Date.now()
    });
    res.end();
  }
});

module.exports = router;
