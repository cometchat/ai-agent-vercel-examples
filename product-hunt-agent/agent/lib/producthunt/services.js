var { DateTime } = require('luxon');

var PRODUCT_HUNT_ENDPOINT = 'https://api.producthunt.com/v2/api/graphql';
var DEFAULT_TIMEZONE = 'America/New_York';

function hasProductHuntToken() {
  return typeof process.env.PRODUCTHUNT_API_TOKEN === 'string' && process.env.PRODUCTHUNT_API_TOKEN.trim().length > 0;
}

function parseTimeframe(timeframe, tz, options) {
  var zone = typeof tz === 'string' && tz.trim().length > 0 ? tz.trim() : DEFAULT_TIMEZONE;
  var now = options && options.now instanceof Date ? options.now : new Date();
  var nowZ = DateTime.fromJSDate(now, { zone: zone });

  var normalized = typeof timeframe === 'string' ? timeframe.trim().toLowerCase() : '';

  var dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (dateMatch) {
    var y = dateMatch[1];
    var m = dateMatch[2];
    var d = dateMatch[3];
    var start = DateTime.fromISO(y + '-' + m + '-' + d + 'T00:00:00', { zone: zone });
    var end = start.plus({ days: 1 });
    return {
      postedAfter: start.toUTC().toISO(),
      postedBefore: end.toUTC().toISO(),
      label: 'day'
    };
  }

  var rangeMatch = /from[:=]\s*(\d{4}-\d{2}-\d{2}).*to[:=]\s*(\d{4}-\d{2}-\d{2})/.exec(normalized);
  if (rangeMatch) {
    var fromStr = rangeMatch[1];
    var toStr = rangeMatch[2];
    var rangeStart = DateTime.fromISO(fromStr + 'T00:00:00', { zone: zone });
    var rangeEnd = DateTime.fromISO(toStr + 'T00:00:00', { zone: zone }).plus({ days: 1 });
    return {
      postedAfter: rangeStart.toUTC().toISO(),
      postedBefore: rangeEnd.toUTC().toISO(),
      label: 'range'
    };
  }

  function includesAny(phrases) {
    for (var i = 0; i < phrases.length; i++) {
      if (normalized.includes(phrases[i])) {
        return true;
      }
    }
    return false;
  }

  if (!normalized || includesAny(['today'])) {
    var startOfDay = nowZ.startOf('day');
    var endOfDay = startOfDay.plus({ days: 1 });
    return {
      postedAfter: startOfDay.toUTC().toISO(),
      postedBefore: endOfDay.toUTC().toISO(),
      label: 'today'
    };
  }

  if (includesAny(['yesterday'])) {
    var yStart = nowZ.startOf('day').minus({ days: 1 });
    var yEnd = nowZ.startOf('day');
    return {
      postedAfter: yStart.toUTC().toISO(),
      postedBefore: yEnd.toUTC().toISO(),
      label: 'yesterday'
    };
  }

  if (includesAny(['this week', 'this-week', 'week'])) {
    var weekStart = nowZ.startOf('week');
    var weekEnd = nowZ;
    return {
      postedAfter: weekStart.toUTC().toISO(),
      postedBefore: weekEnd.toUTC().toISO(),
      label: 'this-week'
    };
  }

  if (includesAny(['last week', 'last-week'])) {
    var lastWeekStart = nowZ.startOf('week').minus({ weeks: 1 });
    var lastWeekEnd = nowZ.startOf('week');
    return {
      postedAfter: lastWeekStart.toUTC().toISO(),
      postedBefore: lastWeekEnd.toUTC().toISO(),
      label: 'last-week'
    };
  }

  if (includesAny(['this month', 'this-month', 'month'])) {
    var monthStart = nowZ.startOf('month');
    var monthEnd = nowZ;
    return {
      postedAfter: monthStart.toUTC().toISO(),
      postedBefore: monthEnd.toUTC().toISO(),
      label: 'this-month'
    };
  }

  if (includesAny(['last month', 'last-month'])) {
    var lastMonthStart = nowZ.startOf('month').minus({ months: 1 });
    var lastMonthEnd = nowZ.startOf('month');
    return {
      postedAfter: lastMonthStart.toUTC().toISO(),
      postedBefore: lastMonthEnd.toUTC().toISO(),
      label: 'last-month'
    };
  }

  var ndays = /(?:past|last)\s+(\d{1,2})\s+day/.exec(normalized);
  if (ndays) {
    var count = Math.min(31, Math.max(1, parseInt(ndays[1], 10)));
    var rollingStart = nowZ.minus({ days: count });
    var rollingEnd = nowZ;
    return {
      postedAfter: rollingStart.toUTC().toISO(),
      postedBefore: rollingEnd.toUTC().toISO(),
      label: 'last-' + count + '-days'
    };
  }

  var defaultStart = nowZ.startOf('day');
  var defaultEnd = defaultStart.plus({ days: 1 });
  return {
    postedAfter: defaultStart.toUTC().toISO(),
    postedBefore: defaultEnd.toUTC().toISO(),
    label: 'today'
  };
}

function mapEdgesToPosts(edges) {
  if (!Array.isArray(edges)) {
    return [];
  }
  return edges
    .map(function (edge) {
      var node = edge && edge.node;
      if (!node) {
        return null;
      }
      return {
        id: node.id,
        name: node.name,
        tagline: node.tagline,
        url: node.url,
        votesCount: node.votesCount
      };
    })
    .filter(Boolean);
}

async function fetchGraphQL(query, variables) {
  var token = process.env.PRODUCTHUNT_API_TOKEN;
  if (!token) {
    return null;
  }

  try {
    var response = await fetch(PRODUCT_HUNT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ query: query, variables: variables })
    });

    if (!response.ok) {
      return null;
    }

    var json = await response.json();
    return json && json.data ? json.data : null;
  } catch (error) {
    return null;
  }
}

async function fetchGraphQLInline(query) {
  return fetchGraphQL(query, undefined);
}

async function getTopProductsByVotes(first) {
  var safeFirst = Math.max(1, Math.min(50, Number(first) || 3));

  if (!hasProductHuntToken()) {
    return [];
  }

  var query = [
    'query TopByVotes($first: Int!) {',
    '  posts(order: VOTES, first: $first) {',
    '    edges {',
    '      node { id name tagline url votesCount }',
    '    }',
    '  }',
    '}'
  ].join('\n');

  var data = await fetchGraphQL(query, { first: safeFirst });
  var edges = data && data.posts && data.posts.edges ? data.posts.edges : [];
  return mapEdgesToPosts(edges);
}

async function getTopProductsThisWeek(first, days) {
  var safeFirst = Math.max(1, Math.min(50, Number(first) || 3));
  var _days = Math.max(1, Math.min(31, Number(days) || 7));

  if (!hasProductHuntToken()) {
    return [];
  }

  var now = new Date();
  var afterDate = new Date(now.getTime() - _days * 24 * 60 * 60 * 1000);
  var postedAfter = afterDate.toISOString();
  var postedBefore = now.toISOString();

  var withVars = [
    'query TopWeek($first: Int!, $postedAfter: DateTime!, $postedBefore: DateTime!) {',
    '  posts(first: $first, order: RANKING, postedAfter: $postedAfter, postedBefore: $postedBefore) {',
    '    edges { node { id name tagline url votesCount } }',
    '  }',
    '}'
  ].join('\n');

  var data = await fetchGraphQL(withVars, {
    first: safeFirst,
    postedAfter: postedAfter,
    postedBefore: postedBefore
  });

  var edges = data && data.posts && data.posts.edges ? data.posts.edges : [];

  if (!edges || edges.length === 0) {
    var inline = [
      'query {',
      '  posts(first: ' + safeFirst + ', order: RANKING, postedAfter: "' + postedAfter + '", postedBefore: "' + postedBefore + '") {',
      '    edges { node { id name tagline url votesCount } }',
      '  }',
      '}'
    ].join('\n');
    var inlineData = await fetchGraphQLInline(inline);
    edges = inlineData && inlineData.posts && inlineData.posts.edges ? inlineData.posts.edges : [];
  }

  return mapEdgesToPosts(edges);
}

async function getTopProductsByTimeframe(params) {
  params = params || {};
  var safeFirst = Math.max(1, Math.min(50, Number(params.first) || 3));

  if (!hasProductHuntToken()) {
    return [];
  }

  var timeframe = params.timeframe;
  var tz = params.tz || DEFAULT_TIMEZONE;
  var parsedWindow = parseTimeframe(timeframe, tz, { now: params.now });

  var data = await fetchGraphQL(
    [
      'query TopByTimeframe($first: Int!, $postedAfter: DateTime!, $postedBefore: DateTime!) {',
      '  posts(first: $first, order: RANKING, postedAfter: $postedAfter, postedBefore: $postedBefore) {',
      '    edges { node { id name tagline url votesCount } }',
      '  }',
      '}'
    ].join('\n'),
    {
      first: safeFirst,
      postedAfter: parsedWindow.postedAfter,
      postedBefore: parsedWindow.postedBefore
    }
  );

  var edges = data && data.posts && data.posts.edges ? data.posts.edges : [];

  if (!edges || edges.length === 0) {
    var inline = [
      'query {',
      '  posts(first: ' + safeFirst + ', order: RANKING, postedAfter: "' + parsedWindow.postedAfter + '", postedBefore: "' + parsedWindow.postedBefore + '") {',
      '    edges { node { id name tagline url votesCount } }',
      '  }',
      '}'
    ].join('\n');
    var inlineData = await fetchGraphQLInline(inline);
    edges = inlineData && inlineData.posts && inlineData.posts.edges ? inlineData.posts.edges : [];
  }

  return mapEdgesToPosts(edges);
}

async function searchProducts(query, options) {
  var opts = options || {};
  var hitsPerPage = Math.max(1, Math.min(50, Number(opts.limit) || 10));

  var url =
    'https://0h4smabbsg-dsn.algolia.net/1/indexes/' +
    encodeURIComponent('Post_production') +
    '?query=' +
    encodeURIComponent(query) +
    '&hitsPerPage=' +
    encodeURIComponent(String(hitsPerPage));

  try {
    var response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Algolia-API-Key': '9670d2d619b9d07859448d7628eea5f3',
        'X-Algolia-Application-Id': '0H4SMABBSG'
      }
    });
    if (!response.ok) {
      return [];
    }

    var json = await response.json();
    var hits = Array.isArray(json && json.hits) ? json.hits : [];
    return hits.map(function (hit) {
      return {
        objectID: hit.objectID || hit.id || String(hit.id || ''),
        name: hit.name,
        tagline: hit.tagline || hit.tag_line || hit.tagLine,
        url: hit.url || hit.post_url,
        votesCount: hit.votesCount || hit.votes_count
      };
    });
  } catch (error) {
    return [];
  }
}

module.exports = {
  DEFAULT_TIMEZONE: DEFAULT_TIMEZONE,
  parseTimeframe: parseTimeframe,
  getTopProductsByVotes: getTopProductsByVotes,
  getTopProductsThisWeek: getTopProductsThisWeek,
  getTopProductsByTimeframe: getTopProductsByTimeframe,
  searchProducts: searchProducts
};
