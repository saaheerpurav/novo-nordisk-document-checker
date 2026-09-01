const endpoint = 'https://api.openai.com/v1/responses'

export class OpenAIConfigurationError extends Error {
  constructor() {
    super('OpenAI is not connected. Add OPENAI_API_KEY to the .env file and restart the server.')
    this.name = 'OpenAIConfigurationError'
    this.status = 503
  }
}

function outputText(response) {
  return (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

async function createResponse({ instructions, input, schema }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new OpenAIConfigurationError()

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    store: false,
    instructions,
    input,
    reasoning: { effort: 'low' },
    text: schema
      ? { verbosity: 'low', format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.value } }
      : { verbosity: 'low' },
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const message = error?.error?.message || `OpenAI request failed with status ${response.status}.`
    const failure = new Error(message)
    failure.status = response.status >= 500 ? 502 : response.status
    throw failure
  }

  const data = await response.json()
  const text = outputText(data)
  if (!text) throw new Error('OpenAI returned no text.')
  return { text, model: data.model || body.model, responseId: data.id, usage: data.usage || null }
}

export async function openAIText(options) {
  return createResponse(options)
}

export async function openAIJSON(options) {
  const response = await createResponse(options)
  try { return { ...response, data: JSON.parse(response.text) } }
  catch { throw new Error('OpenAI returned an invalid structured response.') }
}

export function openAIStatus() {
  return { configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.4-mini' }
}
