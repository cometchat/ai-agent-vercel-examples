var express = require('express');
var { Experimental_Agent, tool } = require('ai');
var { openai } = require('@ai-sdk/openai');
var { z } = require('zod');

var router = express.Router();

var weatherCodeDescriptions = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Light snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with light hail',
  99: 'Thunderstorm with heavy hail'
};

async function fetchJson(url, signal) {
  var response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error('Request failed with status ' + response.status + ' (' + response.statusText + ')');
  }

  return response.json();
}

async function resolveLocation(locationName, signal) {
  var geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodeUrl.searchParams.set('name', locationName);
  geocodeUrl.searchParams.set('count', '1');
  geocodeUrl.searchParams.set('language', 'en');
  geocodeUrl.searchParams.set('format', 'json');

  var geocodeResponse = await fetchJson(geocodeUrl, signal);

  if (!geocodeResponse.results || geocodeResponse.results.length === 0) {
    return null;
  }

  return geocodeResponse.results[0];
}

async function fetchCurrentWeather(location, signal) {
  var forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', String(location.latitude));
  forecastUrl.searchParams.set('longitude', String(location.longitude));
  forecastUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code');
  forecastUrl.searchParams.set('timezone', 'auto');

  var forecastResponse = await fetchJson(forecastUrl, signal);

  if (!forecastResponse.current) {
    throw new Error('Current weather data is missing from provider response');
  }

  var current = forecastResponse.current;
  var description = weatherCodeDescriptions[current.weather_code] || 'Unknown conditions';

  return {
    source: 'open-meteo.com',
    location: {
      name: location.name,
      countryCode: location.country_code,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: forecastResponse.timezone
    },
    current: {
      observationTime: current.time,
      temperatureC: current.temperature_2m,
      humidityPercent: current.relative_humidity_2m,
      windSpeedKmh: current.wind_speed_10m,
      weatherCode: current.weather_code,
      description: description
    },
    units: forecastResponse.current_units
  };
}

var getCurrentWeatherTool = tool({
  name: 'getCurrentWeather',
  description: 'Look up the current weather for a given city or location name using Open-Meteo.',
  inputSchema: z.object({
    location: z
      .string()
      .min(1, 'Location is required')
      .describe('City, town, or general location to check the weather for.')
  }),
  execute: async function execute(args, options) {
    var locationName = args.location.trim();

    if (locationName.length === 0) {
      return {
        ok: false,
        reason: 'A location name is required to look up the weather.'
      };
    }

    var location = await resolveLocation(locationName, options.abortSignal);

    if (!location) {
      return {
        ok: false,
        reason: 'No matching location found for "' + locationName + '".'
      };
    }

    var weather = await fetchCurrentWeather(location, options.abortSignal);

    return {
      ok: true,
      query: locationName,
      report: weather
    };
  }
});

function createAgent() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not configured.');
  }

  return new Experimental_Agent({
    model: openai('gpt-4o'),
    system:
      'You are a weather specialist. Always call the getCurrentWeather tool to retrieve the latest conditions before answering. ' +
      'Summarize the weather in plain language, cite the observation time, temperature, humidity, wind speed, and mention the data source. ' +
      'If the tool indicates the location was not found, apologize and suggest refining the location.',
    tools: {
      getCurrentWeather: getCurrentWeatherTool
    },
    stopWhen: undefined
  });
}

router.post('/', async function (req, res, next) {
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: 'Server configuration error',
      detail: 'Set the OPENAI_API_KEY environment variable before using the weather agent.'
    });
    return;
  }

  var query = typeof req.body === 'object' ? req.body.query : undefined;

  if (typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({ error: 'Missing query', detail: 'Provide a non-empty string in the "query" field.' });
    return;
  }

  var agent;

  try {
    agent = createAgent();
  } catch (error) {
    next(error);
    return;
  }

  try {
    var result = await agent.generate({
      prompt: query
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
