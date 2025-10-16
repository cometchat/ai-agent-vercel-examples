var path = require('path');
var { DEFAULT_NAMESPACE, listNamespaceFiles, readDocument } = require('./storage');

var STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'by',
  'with',
  'at',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'being',
  'been',
  'from',
  'that',
  'this',
  'these',
  'those',
  'it',
  'its',
  'into',
  'about',
  'over',
  'under',
  'up',
  'down'
]);

function sanitizeNamespace(namespace) {
  if (typeof namespace !== 'string') {
    return DEFAULT_NAMESPACE;
  }

  var trimmed = namespace.trim();
  if (trimmed.length === 0) {
    return DEFAULT_NAMESPACE;
  }

  return trimmed;
}

function extractTokens(query) {
  var text = (query || '').toString();
  var phrases = [];
  var quotePattern = /"([^"]{2,})"/g;
  var match;
  while ((match = quotePattern.exec(text)) !== null) {
    phrases.push(match[1].toLowerCase().trim());
  }

  var stripped = text.replace(quotePattern, ' ');
  var words = stripped
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(function (word) {
      return word.length >= 2 && !STOPWORDS.has(word);
    });

  var tokens = phrases.concat(words);
  return {
    phrases: phrases,
    words: words,
    tokens: tokens
  };
}

function countOccurrences(haystack, needle) {
  var count = 0;
  var first = -1;
  var pos = 0;

  while (true) {
    var index = haystack.indexOf(needle, pos);
    if (index === -1) {
      break;
    }

    if (first === -1) {
      first = index;
    }

    count += 1;
    pos = index + Math.max(needle.length, 1);
  }

  return { count: count, first: first };
}

function buildExcerpt(content, startIndex) {
  var windowSize = 220;
  var start = Math.max(0, startIndex - windowSize);
  var end = Math.min(content.length, startIndex + windowSize);
  var slice = content.slice(start, end);
  return slice.replace(/\s+/g, ' ').trim();
}

async function searchKnowledge(options) {
  var query = (options && typeof options.query === 'string') ? options.query.trim() : '';
  if (query.length === 0) {
    return { results: [], error: 'Query is required.' };
  }

  var namespace = sanitizeNamespace(options && options.namespace);
  var maxResults = options && Number.isInteger(options.maxResults) ? options.maxResults : 6;
  if (maxResults < 1) {
    maxResults = 1;
  }
  if (maxResults > 20) {
    maxResults = 20;
  }

  var tokens = extractTokens(query);
  if (tokens.tokens.length === 0) {
    return {
      results: [],
      sources: [],
      info: 'No searchable tokens in query.',
      query: query,
      namespace: namespace
    };
  }

  var files = await listNamespaceFiles(namespace);
  if (files.length === 0) {
    return {
      results: [],
      sources: [],
      error: "Namespace '" + namespace + "' is empty or missing.",
      query: query,
      namespace: namespace
    };
  }

  var hits = [];
  var warnings = [];

  for (var i = 0; i < files.length; i++) {
    var filePath = files[i];
    var filename = path.basename(filePath);
    var doc;

    try {
      doc = await readDocument(filePath);
    } catch (error) {
      warnings.push('Failed to read ' + filename + ': ' + (error && error.message ? error.message : 'unknown error'));
      continue;
    }

    if (!doc) {
      continue;
    }

    var content = doc.content;
    var lower = content.toLowerCase();
    var tokenMatches = 0;
    var totalOccurrences = 0;
    var earliestIndex = Number.POSITIVE_INFINITY;

    for (var j = 0; j < tokens.tokens.length; j++) {
      var token = tokens.tokens[j];
      var stats = countOccurrences(lower, token);
      if (stats.count > 0) {
        tokenMatches += 1;
        totalOccurrences += stats.count;
        if (stats.first !== -1 && stats.first < earliestIndex) {
          earliestIndex = stats.first;
        }
      }
    }

    var filenameLower = filename.toLowerCase();
    var filenameBonus = 0;
    for (var k = 0; k < tokens.tokens.length; k++) {
      var tokenInName = tokens.tokens[k];
      if (filenameLower.indexOf(tokenInName) !== -1) {
        filenameBonus += 5;
      }
    }

    if (tokenMatches === 0 && filenameBonus === 0) {
      continue;
    }

    var matchIndex = Number.isFinite(earliestIndex) ? earliestIndex : -1;
    var excerptIndex = Number.isFinite(earliestIndex) ? earliestIndex : 0;
    var excerpt = buildExcerpt(content, excerptIndex);

    var coverageScore = tokenMatches / tokens.tokens.length;
    var earlyScore = Number.isFinite(earliestIndex) ? 1 - earliestIndex / Math.max(content.length, 1) : 0.2;
    var score = coverageScore * 60 + totalOccurrences * 6 + earlyScore * 10 + filenameBonus;

    hits.push({
      file: filename,
      path: filePath,
      excerpt: excerpt,
      matchIndex: matchIndex,
      occurrences: totalOccurrences,
      tokenMatches: tokenMatches,
      score: Number(score.toFixed(3))
    });
  }

  if (hits.length === 0) {
    return {
      results: [],
      sources: [],
      info: 'No matches found.',
      query: query,
      namespace: namespace,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  hits.sort(function (a, b) {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (a.matchIndex !== b.matchIndex) {
      return a.matchIndex - b.matchIndex;
    }
    return a.file.localeCompare(b.file);
  });

  var limited = hits.slice(0, maxResults);
  var sources = limited.map(function (hit) {
    return hit.file;
  });

  var response = {
    results: limited,
    sources: sources,
    query: query,
    namespace: namespace
  };

  if (warnings.length > 0) {
    response.warnings = warnings;
  }

  return response;
}

module.exports = {
  searchKnowledge: searchKnowledge
};
