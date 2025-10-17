var { Experimental_Agent, tool } = require('ai');
var { openai } = require('@ai-sdk/openai');
var { z } = require('zod');
var {
  DEFAULT_TIMEZONE,
  getTopProductsByVotes,
  getTopProductsByTimeframe,
  searchProducts,
  parseTimeframe
} = require('./services');

function toSafeLimit(value, fallback, max) {
  var num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) {
    return fallback;
  }
  var clamped = Math.max(1, Math.min(max, Math.round(num)));
  return clamped;
}

function formatPostsTable(posts) {
  var rows = Array.isArray(posts)
    ? posts.map(function (post, index) {
        var name = post && post.name ? String(post.name).replace(/\|/g, '\\|') : '-';
        var tagline = post && post.tagline ? String(post.tagline).replace(/\|/g, '\\|') : '-';
        var votes = post && post.votesCount != null ? String(post.votesCount) : '-';
        var link = post && post.url ? '[link](' + post.url + ')' : '-';
        return '| ' + (index + 1) + ' | ' + name + ' | ' + tagline + ' | ' + votes + ' | ' + link + ' |';
      })
    : [];
  return ['| Rank | Name | Tagline | Votes | Link |', '| ---: | --- | --- | ---: | --- |'].concat(rows).join('\n');
}

function createTopProductsTool() {
  return tool({
    name: 'getTopProducts',
    description: 'Get the top Product Hunt posts by total votes (all-time).',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Number of posts to return (1-10). Defaults to 3.')
    }),
    execute: async function execute(input) {
      var limit = toSafeLimit(input && input.limit, 3, 10);
      var posts = await getTopProductsByVotes(limit);
      return {
        posts: posts,
        limit: limit,
        table: formatPostsTable(posts)
      };
    }
  });
}

function createSearchProductsTool() {
  return tool({
    name: 'searchProducts',
    description: 'Search Product Hunt posts by keyword using the public Algolia index.',
    inputSchema: z.object({
      query: z.string().min(1, 'Provide search keywords.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results to return (1-50). Defaults to 10.')
    }),
    execute: async function execute(input) {
      var limit = toSafeLimit(input.limit, 10, 50);
      var hits = await searchProducts(input.query, { limit: limit });
      return {
        hits: hits,
        limit: limit,
        query: input.query
      };
    }
  });
}

function createTopProductsByTimeframeTool() {
  return tool({
    name: 'getTopProductsByTimeframe',
    description:
      'Get top Product Hunt posts for a timeframe (default: today in America/New_York). Supported timeframes: today, yesterday, this-week, last-week, this-month, last-month, YYYY-MM-DD, or ranges like "from:2024-08-01 to:2024-08-15".',
    inputSchema: z.object({
      timeframe: z
        .string()
        .optional()
        .describe('Natural timeframe such as "today", "this-week", "2024-09-01". Defaults to today.'),
      tz: z
        .string()
        .optional()
        .describe('IANA timezone, e.g. "America/New_York". Defaults to America/New_York.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Number of posts to return (1-10). Defaults to 3.')
    }),
    execute: async function execute(input) {
      var timeframe = input && typeof input.timeframe === 'string' && input.timeframe.trim().length > 0 ? input.timeframe.trim() : 'today';
      var tz = input && typeof input.tz === 'string' && input.tz.trim().length > 0 ? input.tz.trim() : DEFAULT_TIMEZONE;
      var limit = toSafeLimit(input && input.limit, 3, 10);

      var posts = await getTopProductsByTimeframe({
        first: limit,
        timeframe: timeframe,
        tz: tz
      });

      var window = parseTimeframe(timeframe, tz);

      return {
        posts: posts,
        timeframe: timeframe,
        tz: tz,
        limit: limit,
        window: window,
        table: formatPostsTable(posts)
      };
    }
  });
}

function createConfettiTool() {
  return tool({
    name: 'triggerConfetti',
    description: "Trigger a celebratory confetti animation in the user's browser.",
    inputSchema: z.object({
      reason: z
        .string()
        .optional()
        .describe('Optional short reason or message to display with the confetti.'),
      colors: z
        .array(z.string())
        .optional()
        .describe('Array of hex color strings for the confetti pieces.'),
      particleCount: z
        .number()
        .int()
        .min(20)
        .max(1000)
        .optional()
        .describe('Number of particles to launch (default 200).'),
      spread: z
        .number()
        .min(1)
        .max(360)
        .optional()
        .describe('Spread angle in degrees (default 90).'),
      startVelocity: z
        .number()
        .min(1)
        .max(200)
        .optional()
        .describe('Initial velocity of confetti (default 45).'),
      origin: z
        .object({
          x: z.number().min(0).max(1).optional(),
          y: z.number().min(0).max(1).optional()
        })
        .optional()
        .describe('Origin (normalized) of the confetti burst.'),
      shapes: z
        .array(z.enum(['square', 'circle', 'star', 'triangle']))
        .optional()
        .describe('Preferred shapes (frontend may map to available shapes).'),
      ticks: z
        .number()
        .int()
        .min(10)
        .max(5000)
        .optional()
        .describe('How long the confetti should last in frames (default 200).'),
      disableSound: z
        .boolean()
        .optional()
        .describe('If true, frontend should not play any celebration sounds.')
    }),
    execute: async function execute(input) {
      var defaults = {
        colors: ['#ff577f', '#ff884b', '#ffd384', '#fff9b0', '#00c2ff', '#7b5cff'],
        particleCount: 200,
        spread: 90,
        startVelocity: 45,
        origin: { x: 0.5, y: 0.5 },
        shapes: ['square', 'circle'],
        ticks: 200,
        disableSound: true
      };

      var payload = Object.assign({}, defaults, input || {});
      var origin = Object.assign({}, defaults.origin, payload.origin || {});

      return {
        action: 'CONFETTI',
        reason: payload.reason,
        colors: payload.colors,
        particleCount: payload.particleCount,
        spread: payload.spread,
        startVelocity: payload.startVelocity,
        origin: { x: origin.x, y: origin.y },
        shapes: payload.shapes,
        ticks: payload.ticks,
        disableSound: payload.disableSound,
        timestamp: new Date().toISOString()
      };
    }
  });
}

function buildSystemPrompt(options) {
  var tz = options && typeof options.defaultTimezone === 'string' && options.defaultTimezone.trim().length > 0 ? options.defaultTimezone.trim() : DEFAULT_TIMEZONE;
  return (
    'You are a helpful Product Hunt assistant.\n' +
    '\n' +
    'Primary capabilities:\n' +
    '- Fetch the top Product Hunt posts by timeframe using the getTopProductsByTimeframe tool (defaults: today, ' +
    tz +
    ').\n' +
    '- Fetch the top Product Hunt posts by total votes using the getTopProducts tool.\n' +
    '- Search Product Hunt posts via Algolia using the searchProducts tool.\n' +
    '- Answer practical questions about launching on Product Hunt with concise, actionable guidance.\n' +
    '\n' +
    'Guidelines:\n' +
    '- Always consider whether a tool call will improve your answer. Use getTopProductsByTimeframe when the user mentions a date or timeframe.\n' +
    '- Use getTopProducts for general top product requests without time context.\n' +
    '- Use searchProducts when the user wants to look up or find a product.\n' +
    '- When tools return posts, share a concise Markdown table with rank, name, tagline, votes, and link.\n' +
    '- Explain gracefully if external APIs are unavailable or return no results.\n' +
    '- Use triggerConfetti when the user wants to celebrate a launch or success.\n'
  );
}

function createProductHuntAgent(options) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not configured.');
  }

  var opts = options || {};

  return new Experimental_Agent({
    model: openai(opts.model || 'gpt-4o'),
    system: buildSystemPrompt({
      defaultTimezone: opts.defaultTimezone || DEFAULT_TIMEZONE
    }),
    tools: {
      getTopProducts: createTopProductsTool(),
      searchProducts: createSearchProductsTool(),
      getTopProductsByTimeframe: createTopProductsByTimeframeTool(),
      triggerConfetti: createConfettiTool()
    }
  });
}

module.exports = {
  createProductHuntAgent: createProductHuntAgent,
  buildSystemPrompt: buildSystemPrompt,
  createTopProductsTool: createTopProductsTool,
  createSearchProductsTool: createSearchProductsTool,
  createTopProductsByTimeframeTool: createTopProductsByTimeframeTool,
  createConfettiTool: createConfettiTool
};
