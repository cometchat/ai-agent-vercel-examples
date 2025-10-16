var express = require('express');
var router = express.Router();
var multer = require('multer');
var { ingestSources, MAX_UPLOAD_BYTES } = require('../lib/knowledge/ingest');
var { searchKnowledge } = require('../lib/knowledge/retrieve');
var { createKnowledgeAgent } = require('../lib/knowledge/agent');

var upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 12
  }
});

function isMultipart(req) {
  var header = req.headers['content-type'] || '';
  return header.toLowerCase().indexOf('multipart/form-data') !== -1;
}

function maybeHandleUploads(req, res, next) {
  if (isMultipart(req)) {
    upload.array('files')(req, res, next);
    return;
  }
  next();
}

function tryParseJson(value) {
  if (typeof value !== 'string') {
    return null;
  }

  var trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
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

      var role = typeof message.role === 'string' ? message.role.toLowerCase() : 'user';
      var content = typeof message.content === 'string' ? message.content : '';
      if (content.trim().length === 0) {
        return null;
      }

      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        role = 'user';
      }

      return { role: role, content: content };
    })
    .filter(Boolean);
}

function formatPrompt(messages) {
  return messages
    .map(function (message) {
      return message.role.toUpperCase() + ': ' + message.content;
    })
    .join('\n');
}

function parseSourcesPayload(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map(function (entry) {
        if (typeof entry === 'string') {
          var parsed = tryParseJson(entry);
          return parsed === null ? entry : parsed;
        }
        if (entry && typeof entry === 'object') {
          return entry;
        }
        return null;
      })
      .filter(Boolean);
  }

  if (typeof rawValue === 'string') {
    var parsed = tryParseJson(rawValue);
    if (parsed === null) {
      return rawValue.trim().length > 0 ? [rawValue] : [];
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  if (typeof rawValue === 'object') {
    return [rawValue];
  }

  return [];
}

router.post('/tools/ingest', maybeHandleUploads, async function (req, res, next) {
  try {
    var namespace = req.body && req.body.namespace;
    var rawSources = req.body && req.body.sources;
    var sources = parseSourcesPayload(rawSources);
    var uploadedFiles = Array.isArray(req.files)
      ? req.files.map(function (file) {
          return {
            originalname: file.originalname,
            buffer: file.buffer,
            mimetype: file.mimetype,
            size: file.size,
            fieldname: file.fieldname
          };
        })
      : [];
    var result = await ingestSources({
      namespace: namespace,
      sources: sources,
      files: uploadedFiles
    });

    var statusCode = 200;
    if (result.errors.length > 0 && result.saved.length === 0 && result.skipped.length === 0) {
      statusCode = 400;
    } else if (result.errors.length > 0) {
      statusCode = 207;
    }

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/tools/searchDocs', async function (req, res, next) {
  try {
    var query = req.body && typeof req.body.query === 'string' ? req.body.query : '';
    var namespace = req.body && typeof req.body.namespace === 'string' ? req.body.namespace : undefined;
    var maxResults = req.body && typeof req.body.maxResults === 'number' ? req.body.maxResults : undefined;

    var result = await searchKnowledge({
      query: query,
      namespace: namespace,
      maxResults: maxResults
    });

    if (result.error) {
      res.status(404).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/agents/knowledge/generate', async function (req, res, next) {
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: 'Server configuration error',
      detail: 'Set the OPENAI_API_KEY environment variable before using the knowledge agent.'
    });
    return;
  }

  var messages = coerceMessages(req.body && req.body.messages);
  if (messages.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty array of messages with textual content.' });
    return;
  }

  var namespace =
    req.body &&
    req.body.toolParams &&
    typeof req.body.toolParams.namespace === 'string' &&
    req.body.toolParams.namespace.trim().length > 0
      ? req.body.toolParams.namespace.trim()
      : undefined;

  var agent;
  try {
    agent = createKnowledgeAgent({ defaultNamespace: namespace });
  } catch (error) {
    next(error);
    return;
  }

  var prompt = formatPrompt(messages);

  try {
    var result = await agent.generate({
      prompt: prompt
    });

    res.json({
      answer: result.text,
      toolResults: result.toolResults,
      usage: result.totalUsage
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
