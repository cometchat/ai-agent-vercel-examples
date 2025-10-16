var fs = require('fs/promises');
var path = require('path');
var crypto = require('crypto');
var pdfParse = require('pdf-parse');
var { ensureNamespaceDir, slugify, DEFAULT_NAMESPACE } = require('./storage');

var URL_PATTERN = /^https?:\/\//i;
var MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
var MAX_TEXT_CHARS = 200000;
var MAX_UNIQUE_ATTEMPTS = 200;

function normalizeNamespace(namespace) {
  if (typeof namespace !== 'string') {
    return DEFAULT_NAMESPACE;
  }

  var trimmed = namespace.trim();
  if (trimmed.length === 0) {
    return DEFAULT_NAMESPACE;
  }

  return trimmed;
}

function isUrl(value) {
  return typeof value === 'string' && URL_PATTERN.test(value.trim());
}

function ensureTrailingNewline(text) {
  if (text.length === 0 || text.endsWith('\n')) {
    return text;
  }

  return text + '\n';
}

function limitTextLength(text, label) {
  if (text.length > MAX_TEXT_CHARS) {
    throw new Error('Text source "' + label + '" exceeds the maximum length of ' + MAX_TEXT_CHARS + ' characters.');
  }
  return text;
}

function isPdfMime(contentType, urlOrName) {
  var ct = (contentType || '').toLowerCase();
  var target = (urlOrName || '').toLowerCase();
  return ct.includes('application/pdf') || /\.pdf($|\?)/.test(target);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function ensureUniqueFilePath(dir, slugBase) {
  var base = slugBase || 'doc';

  for (var attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt++) {
    var candidate = attempt === 0 ? base : base + '-' + attempt;
    var filePath = path.join(dir, candidate + '.md');
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { slug: candidate, path: filePath };
      }
    }
  }

  throw new Error('Unable to allocate a unique filename after ' + MAX_UNIQUE_ATTEMPTS + ' attempts.');
}

async function loadExistingHashes(namespaceDir) {
  var map = new Map();

  try {
    var entries = await fs.readdir(namespaceDir);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!/\.mdx?$/i.test(entry) && !/\.txt$/i.test(entry)) {
        continue;
      }

      var fullPath = path.join(namespaceDir, entry);
      try {
        var existingContent = await fs.readFile(fullPath, 'utf8');
        map.set(hashContent(existingContent), fullPath);
      } catch (error) {
        // ignore unreadable files
      }
    }
  } catch (error) {
    // ignore missing dir; ensureNamespaceDir will create it later
  }

  return map;
}

async function convertPdfBuffer(buffer, label, sourceLabel) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  if (buffer.length === 0) {
    throw new Error('PDF "' + label + '" is empty.');
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('PDF "' + label + '" exceeds the maximum upload size of ' + MAX_UPLOAD_BYTES + ' bytes.');
  }

  var parsed;
  try {
    parsed = await pdfParse(buffer);
  } catch (error) {
    throw new Error('Failed to parse PDF "' + label + '": ' + (error && error.message ? error.message : 'unknown error'));
  }

  var text = (parsed && parsed.text ? parsed.text : '').trim();
  if (text.length === 0) {
    text = '(No extractable text)';
  }

  var safeLabel = label || 'PDF Document';
  var markdown =
    '# ' + safeLabel + '\n\n' +
    'Source: ' + sourceLabel + '\n' +
    'Pages: ' + (parsed && parsed.numpages ? parsed.numpages : 'unknown') + '\n\n' +
    text;

  return {
    title: safeLabel,
    slug: slugify(safeLabel),
    markdown: ensureTrailingNewline(markdown),
    sourceLabel: sourceLabel
  };
}

function plainTextToMarkdown(title, text, sourceLabel) {
  var safeTitle = title || 'Document';
  var trimmed = limitTextLength(text.trim(), safeTitle);
  var markdown =
    '# ' + safeTitle + '\n\n' +
    'Source: ' + sourceLabel + '\n\n' +
    trimmed;

  return {
    title: safeTitle,
    slug: slugify(safeTitle),
    markdown: ensureTrailingNewline(markdown),
    sourceLabel: sourceLabel
  };
}

async function fetchUrlContent(url) {
  var response = await fetch(url);
  if (!response.ok) {
    throw new Error('Request failed with status ' + response.status + ' (' + response.statusText + ').');
  }

  var finalUrl = response.url || url;
  var contentType = response.headers.get('content-type') || '';
  var contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_UPLOAD_BYTES) {
    throw new Error('Remote resource exceeds maximum size of ' + MAX_UPLOAD_BYTES + ' bytes.');
  }

  if (isPdfMime(contentType, finalUrl)) {
    var pdfBuffer = Buffer.from(await response.arrayBuffer());
    return convertPdfBuffer(pdfBuffer, finalUrl, 'url:' + finalUrl);
  }

  if (contentType.includes('text/html')) {
    var html = await response.text();
    var titleMatch = html.match(/<title>([^<]{2,})<\/title>/i);
    var title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : finalUrl;
    var plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return plainTextToMarkdown(title, plain, 'url:' + finalUrl);
  }

  if (contentType.startsWith('text/')) {
    var text = await response.text();
    return plainTextToMarkdown(finalUrl, text, 'url:' + finalUrl);
  }

  throw new Error('Unsupported content type "' + contentType + '". Only HTML, text, and PDF resources are accepted.');
}

async function normaliseSource(source) {
  if (typeof source === 'string') {
    if (isUrl(source)) {
      return fetchUrlContent(source.trim());
    }

    var textDoc = source.trim();
    limitTextLength(textDoc, 'Text snippet');
    return plainTextToMarkdown('Note', textDoc, 'text:Note');
  }

  if (!source || typeof source !== 'object') {
    throw new Error('Unsupported source format. Provide a URL string or an object with type "url", "text", or "markdown".');
  }

  if (source.type === 'url') {
    if (!source.url || typeof source.url !== 'string') {
      throw new Error('Missing "url" field for url source.');
    }
    return fetchUrlContent(source.url.trim());
  }

  if (source.type === 'text') {
    if (!source.text || typeof source.text !== 'string') {
      throw new Error('Missing "text" field for text source.');
    }
    var title = typeof source.title === 'string' && source.title.trim().length > 0 ? source.title.trim() : 'Note';
    limitTextLength(source.text, title);
    return plainTextToMarkdown(title, source.text, 'text:' + title);
  }

  if (source.type === 'markdown') {
    if (!source.markdown || typeof source.markdown !== 'string') {
      throw new Error('Missing "markdown" field for markdown source.');
    }
    var mdTitle = typeof source.title === 'string' && source.title.trim().length > 0 ? source.title.trim() : 'Document';
    limitTextLength(source.markdown, mdTitle);
    return {
      title: mdTitle,
      slug: slugify(mdTitle),
      markdown: ensureTrailingNewline(source.markdown),
      sourceLabel: 'markdown:' + mdTitle
    };
  }

  throw new Error('Unsupported source type "' + source.type + '". Expected "url", "text", or "markdown".');
}

function inferTitleFromFilename(filename) {
  var base = filename.replace(/\.[^.]+$/, '');
  return base || filename || 'upload';
}

async function prepareUploadedFile(file) {
  if (!file || !file.buffer) {
    throw new Error('Uploaded file is missing its data buffer.');
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File "' + (file.originalname || file.fieldname) + '" exceeds the maximum upload size of ' + MAX_UPLOAD_BYTES + ' bytes.');
  }

  var label = file.originalname || file.fieldname || 'upload';
  var mimetype = (file.mimetype || '').toLowerCase();

  if (isPdfMime(mimetype, label)) {
    return convertPdfBuffer(file.buffer, label, 'file:' + label);
  }

  if (mimetype.startsWith('text/') || /\.(md|markdown|txt)$/i.test(label)) {
    var text = file.buffer.toString('utf8');
    limitTextLength(text, label);
    var title = inferTitleFromFilename(label);
    return plainTextToMarkdown(title, text, 'file:' + label);
  }

  throw new Error('Unsupported file type "' + mimetype + '" for "' + label + '". Provide PDF, Markdown, or plain text files.');
}

async function persistDocument(namespaceDir, prepared, dedupe) {
  var markdown = prepared.markdown;
  var hash = hashContent(markdown);

  if (dedupe.hashes.has(hash)) {
    return {
      status: 'skipped',
      reason: 'duplicate-content',
      existingFile: path.basename(dedupe.hashes.get(hash)),
      slug: prepared.slug,
      hash: hash
    };
  }

  var slug = prepared.slug;
  var basePath = path.join(namespaceDir, slug + '.md');
  var finalPath = basePath;

  try {
    var existingContent = await fs.readFile(basePath, 'utf8');
    if (existingContent === markdown) {
      dedupe.hashes.set(hash, basePath);
      return {
        status: 'skipped',
        reason: 'duplicate-content',
        existingFile: path.basename(basePath),
        slug: slug,
        hash: hash
      };
    }

    var unique = await ensureUniqueFilePath(namespaceDir, slug);
    finalPath = unique.path;
    slug = unique.slug;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(finalPath, markdown, 'utf8');
  dedupe.hashes.set(hash, finalPath);

  return {
    status: 'saved',
    file: path.basename(finalPath),
    slug: slug,
    hash: hash,
    bytes: Buffer.byteLength(markdown, 'utf8')
  };
}

async function ingestSources(options) {
  var namespace = normalizeNamespace(options && options.namespace);
  var sources = Array.isArray(options && options.sources) ? options.sources : [];
  var files = Array.isArray(options && options.files) ? options.files : [];

  if (sources.length === 0 && files.length === 0) {
    return {
      namespace: namespace,
      saved: [],
      skipped: [],
      errors: [{ error: 'Provide at least one source or file.' }],
      counts: { saved: 0, skipped: 0, errors: 1 }
    };
  }

  var namespaceDir = await ensureNamespaceDir(namespace);
  var dedupe = { hashes: await loadExistingHashes(namespaceDir) };
  var saved = [];
  var skipped = [];
  var errors = [];

  async function processPrepared(label, prepared) {
    try {
      var persisted = await persistDocument(namespaceDir, prepared, dedupe);
      if (persisted.status === 'saved') {
        saved.push({
          source: label,
          file: persisted.file,
          slug: persisted.slug,
          hash: persisted.hash,
          bytes: persisted.bytes
        });
      } else {
        skipped.push({
          source: label,
          reason: persisted.reason,
          existingFile: persisted.existingFile,
          slug: persisted.slug,
          hash: persisted.hash
        });
      }
    } catch (error) {
      errors.push({
        source: label,
        error: error && error.message ? error.message : 'Unknown error'
      });
    }
  }

  for (var i = 0; i < sources.length; i++) {
    var rawSource = sources[i];
    var label = typeof rawSource === 'string' ? rawSource : rawSource && rawSource.type ? rawSource.type : 'source-' + i;

    try {
      var prepared = await normaliseSource(rawSource);
      await processPrepared(label, prepared);
    } catch (error) {
      errors.push({
        source: label,
        error: error && error.message ? error.message : 'Unknown error'
      });
    }
  }

  for (var j = 0; j < files.length; j++) {
    var file = files[j];
    var uploadLabel = 'file:' + (file.originalname || file.fieldname || 'upload-' + j);

    try {
      var preparedFile = await prepareUploadedFile(file);
      await processPrepared(uploadLabel, preparedFile);
    } catch (error) {
      errors.push({
        source: uploadLabel,
        error: error && error.message ? error.message : 'Unknown error'
      });
    }
  }

  return {
    namespace: namespace,
    saved: saved,
    skipped: skipped,
    errors: errors,
    counts: {
      saved: saved.length,
      skipped: skipped.length,
      errors: errors.length
    }
  };
}

module.exports = {
  ingestSources: ingestSources,
  MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
  MAX_TEXT_CHARS: MAX_TEXT_CHARS
};
