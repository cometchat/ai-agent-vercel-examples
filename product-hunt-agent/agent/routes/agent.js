var express = require('express');
var { streamText, stepCountIs } = require('ai');
var { openai } = require('@ai-sdk/openai');
var {
  convertCometChatMessagesToVercelMessages,
  convertCometChatToolsToVercelAISDKTools,
  mapVercelStreamChunkToCometChatEvent
} = require('@cometchat/vercel-adapter');
var {
  buildSystemPrompt,
  createTopProductsTool,
  createTopProductsByTimeframeTool,
  createSearchProductsTool,
  createConfettiTool
} = require('../lib/producthunt/agent');
var { DEFAULT_TIMEZONE } = require('../lib/producthunt/services');

var router = express.Router();

function parseThreadId(rawThreadId) {
  if (typeof rawThreadId === 'string' && rawThreadId.trim().length > 0) {
    return rawThreadId.trim();
  }
  return 'thread_1';
}

function parseToolParams(body) {
  var params = (body && body.toolParams) || {};
  var timezone =
    typeof params.timezone === 'string' && params.timezone.trim().length > 0
      ? params.timezone.trim()
      : typeof params.tz === 'string' && params.tz.trim().length > 0
      ? params.tz.trim()
      : DEFAULT_TIMEZONE;

  var timeframe =
    typeof params.timeframe === 'string' && params.timeframe.trim().length > 0
      ? params.timeframe.trim()
      : 'today';

  var limit =
    typeof params.limit === 'number' && Number.isFinite(params.limit) ? params.limit : undefined;

  return {
    timeframe: timeframe,
    timezone: timezone,
    limit: limit
  };
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
      detail: 'Set the OPENAI_API_KEY environment variable before using the agent.'
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

  var threadId = parseThreadId(req.body && req.body.threadId);
  var runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
  var toolPrefs = parseToolParams(req.body);

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

  var baseTools = {
    getTopProducts: createTopProductsTool(),
    getTopProductsByTimeframe: createTopProductsByTimeframeTool(),
    searchProducts: createSearchProductsTool(),
    triggerConfetti: createConfettiTool()
  };

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

  var tools = Object.assign({}, baseTools, extraTools);
  var temperature = ensureTemperature(process.env.TEMPERATURE, 0.7);

  var systemPrompt = buildSystemPrompt({
    defaultTimezone: toolPrefs.timezone
  });

  if (toolPrefs.timeframe || toolPrefs.limit) {
    systemPrompt +=
      '\nDefault preferences for this conversation:\n' +
      '- Timeframe: ' +
      (toolPrefs.timeframe || 'today') +
      '\n' +
      (toolPrefs.limit ? '- Post limit: ' + toolPrefs.limit + '\n' : '');
  }

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
      error:
        process.env.NODE_ENV === 'development'
          ? error && error.message
            ? error.message
            : String(error)
          : 'Internal server error',
      threadId: threadId,
      runId: runId,
      timestamp: Date.now()
    });
    res.end();
  }
});

module.exports = router;
