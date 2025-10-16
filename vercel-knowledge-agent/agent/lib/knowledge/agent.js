var { Experimental_Agent, tool } = require('ai');
var { openai } = require('@ai-sdk/openai');
var { z } = require('zod');
var { searchKnowledge } = require('./retrieve');
var { DEFAULT_NAMESPACE } = require('./storage');

function createDocsRetrieverTool(defaultNamespace) {
  return tool({
    name: 'docsRetriever',
    description: 'Search knowledge/<namespace> for markdown snippets relevant to the user question.',
    inputSchema: z.object({
      query: z.string().min(2, 'Query is required.'),
      namespace: z.string().optional(),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
    }),
    execute: async function execute(args) {

      console.log('docsRetriever called with args:', args);

      var namespace = typeof args.namespace === 'string' && args.namespace.trim().length > 0 ? args.namespace.trim() : defaultNamespace;
      var maxResults = typeof args.maxResults === 'number' ? args.maxResults : 6;
      var result = await searchKnowledge({
        namespace: namespace,
        query: args.query,
        maxResults: maxResults
      });

      return result;
    }
  });
}

function buildSystemPrompt(options) {
  var defaultNamespace = options.defaultNamespace || DEFAULT_NAMESPACE;
  return (
    'You are a precise documentation assistant named Knowledge Agent.\n' +
    'Answer every user query and keep responses tightly grounded in the retrieved documentation.\n' +
    'Always call the docsRetriever tool before drafting an answer. Use namespace "' + defaultNamespace + '" unless the user clearly requests a different namespace.\n' +
    'Provide concise answers grounded in retrieved snippets and cite sources at the end in the format "Sources: filename1.md, filename2.mdx".\n' +
    'If the tool returns no matches, say so and suggest what content should be ingested. Do not fabricate information.\n'
  );
}

function createKnowledgeAgent(options) {
  options = options || {};
  var defaultNamespace = typeof options.defaultNamespace === 'string' && options.defaultNamespace.trim().length > 0 ? options.defaultNamespace.trim() : DEFAULT_NAMESPACE;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not configured.');
  }

  return new Experimental_Agent({
    model: openai(options.model || 'gpt-4o'),
    system: buildSystemPrompt({ defaultNamespace: defaultNamespace }),
    tools: {
      docsRetriever: createDocsRetrieverTool(defaultNamespace)
    }
  });
}

module.exports = {
  createKnowledgeAgent: createKnowledgeAgent,
  createDocsRetrieverTool: createDocsRetrieverTool,
  buildSystemPrompt: buildSystemPrompt
};
