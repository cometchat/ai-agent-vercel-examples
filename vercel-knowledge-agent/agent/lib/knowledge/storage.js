var fs = require('fs/promises');
var path = require('path');

var DEFAULT_NAMESPACE = 'default';
var NAMESPACE_PATTERN = /^[a-zA-Z0-9._-]+$/;
var MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function unique(items) {
  return Array.from(new Set(items));
}

function knowledgeRootCandidates() {
  var candidates = [];
  if (process.env.KNOWLEDGE_DIR) {
    candidates.push(path.resolve(process.env.KNOWLEDGE_DIR));
  }
  candidates.push(path.resolve(process.cwd(), 'knowledge'));
  candidates.push(path.resolve(__dirname, '../../knowledge'));
  candidates.push(path.resolve(__dirname, '../../../knowledge'));
  return unique(candidates);
}

async function dirExists(dirPath) {
  try {
    var stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

async function fileExists(filePath) {
  try {
    var stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (error) {
    return false;
  }
}

async function resolveKnowledgeRoot() {
  var candidates = knowledgeRootCandidates();
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (await dirExists(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

async function ensureNamespaceDir(namespace) {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('Namespace is required.');
  }

  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error("Namespace '" + namespace + "' is invalid. Allowed characters: letters, numbers, dot, dash, underscore.");
  }

  var root = await resolveKnowledgeRoot();
  var namespaceDir = path.join(root, namespace);
  await fs.mkdir(namespaceDir, { recursive: true });
  return namespaceDir;
}

async function getNamespaceDir(namespace) {
  if (!namespace || typeof namespace !== 'string') {
    throw new Error('Namespace is required.');
  }

  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error("Namespace '" + namespace + "' is invalid. Allowed characters: letters, numbers, dot, dash, underscore.");
  }

  var root = await resolveKnowledgeRoot();
  return path.join(root, namespace);
}

async function listNamespaceFiles(namespace) {
  var dir = await getNamespaceDir(namespace);
  if (!(await dirExists(dir))) {
    return [];
  }

  var entries = await fs.readdir(dir);
  return entries
    .filter(function (entry) {
      return /\.(md|mdx|txt)$/i.test(entry);
    })
    .map(function (entry) {
      return path.join(dir, entry);
    });
}

async function readDocument(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  var stats = await fs.stat(filePath);
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File ' + filePath + ' exceeds the maximum supported size of ' + MAX_FILE_SIZE_BYTES + ' bytes.');
  }

  var content = await fs.readFile(filePath, 'utf8');
  return { path: filePath, content: content, size: stats.size, mtimeMs: stats.mtimeMs };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 180) || 'doc';
}

module.exports = {
  DEFAULT_NAMESPACE: DEFAULT_NAMESPACE,
  MAX_FILE_SIZE_BYTES: MAX_FILE_SIZE_BYTES,
  NAMESPACE_PATTERN: NAMESPACE_PATTERN,
  ensureNamespaceDir: ensureNamespaceDir,
  getNamespaceDir: getNamespaceDir,
  listNamespaceFiles: listNamespaceFiles,
  readDocument: readDocument,
  slugify: slugify
};
