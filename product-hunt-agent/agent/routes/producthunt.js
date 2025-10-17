var express = require('express');
var { createProductHuntAgent } = require('../lib/producthunt/agent');
var {
  DEFAULT_TIMEZONE,
  getTopProductsByVotes,
  getTopProductsThisWeek,
  getTopProductsByTimeframe,
  parseTimeframe,
  searchProducts
} = require('../lib/producthunt/services');

var router = express.Router();

router.use(function (req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function clampNumber(value, min, max, fallback) {
  var num = Number(value);
  if (Number.isNaN(num)) {
    return fallback;
  }
  if (num < min) {
    return min;
  }
  if (num > max) {
    return max;
  }
  return num;
}

function coerceMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return [];
  }
  return rawMessages
    .map(function (message) {
      if (!message || typeof message !== 'object') {
        return null;
      }
      var role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : 'user';
      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        role = 'user';
      }
      var content = typeof message.content === 'string' ? message.content : '';
      if (content.trim().length === 0) {
        return null;
      }
      return { role: role, content: content };
    })
    .filter(Boolean);
}

function formatPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  return messages
    .map(function (message) {
      return message.role.toUpperCase() + ': ' + message.content;
    })
    .join('\n');
}

router.get('/health', function (_req, res) {
  res.json({ ok: true });
});

router.get('/top', async function (req, res, next) {
  try {
    var limitRaw = req.query.limit || req.query.first || '3';
    var first = clampNumber(limitRaw, 1, 10, 3);
    var posts = await getTopProductsByVotes(first);
    res.json({
      posts: posts,
      first: first,
      order: 'VOTES'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/top-week', async function (req, res, next) {
  try {
    var limitRaw = req.query.limit || req.query.first || '3';
    var first = clampNumber(limitRaw, 1, 10, 3);
    var daysRaw = req.query.days || '7';
    var days = clampNumber(daysRaw, 1, 31, 7);
    var posts = await getTopProductsThisWeek(first, days);
    res.json({
      posts: posts,
      first: first,
      days: days,
      order: 'RANKING',
      window: 'rolling-week'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/top-range', async function (req, res, next) {
  try {
    var limitRaw = req.query.limit || req.query.first || '3';
    var first = clampNumber(limitRaw, 1, 10, 3);
    var timeframe =
      typeof req.query.timeframe === 'string'
        ? req.query.timeframe
        : typeof req.query.tf === 'string'
        ? req.query.tf
        : 'today';
    var tz = typeof req.query.tz === 'string' && req.query.tz.trim().length > 0 ? req.query.tz.trim() : DEFAULT_TIMEZONE;

    var posts = await getTopProductsByTimeframe({
      first: first,
      timeframe: timeframe,
      tz: tz
    });
    var window = parseTimeframe(timeframe, tz);

    res.json({
      posts: posts,
      first: first,
      timeframe: timeframe,
      tz: tz,
      order: 'RANKING',
      window: window
    });
  } catch (error) {
    next(error);
  }
});

router.get('/search', async function (req, res, next) {
  try {
    var query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length === 0) {
      res.status(400).json({ error: 'Provide a search query via ?q=' });
      return;
    }

    var limitRaw = req.query.limit || req.query.first || '10';
    var limit = clampNumber(limitRaw, 1, 50, 10);
    var hits = await searchProducts(query, { limit: limit });
    res.json({
      hits: hits,
      q: query,
      limit: limit
    });
  } catch (error) {
    next(error);
  }
});

router.post('/chat', async function (req, res, next) {
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: 'Server configuration error',
      detail: 'Set the OPENAI_API_KEY environment variable to enable chat.'
    });
    return;
  }

  var body = req.body || {};
  var message = typeof body.message === 'string' ? body.message.trim() : '';
  var messages = coerceMessages(body.messages);

  if (message.length === 0 && messages.length === 0) {
    res.status(400).json({ error: 'Provide message or messages with textual content.' });
    return;
  }

  var prompt = message.length > 0 ? message : formatPrompt(messages);
  if (prompt.trim().length === 0) {
    res.status(400).json({ error: 'Prompt cannot be empty.' });
    return;
  }

  var agent;
  try {
    agent = createProductHuntAgent({});
  } catch (error) {
    next(error);
    return;
  }

  try {
    var result = await agent.generate({
      prompt: prompt
    });

    res.json({
      reply: result.text,
      toolResults: result.toolResults,
      usage: result.totalUsage
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
