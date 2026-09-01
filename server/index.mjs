import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import express from 'express'
import {
  answerQuestion,
  addChecklist,
  applyChecklist,
  approveAction,
  decideDraft,
  dismissDraft,
  draftMissingSection,
  getState,
  importDocument,
  inspectionPack,
  markWhatsAppDelivery,
  prepareAction,
  recordMiraConversation,
  rejectAction,
  resetState,
  reviewDocument,
  reviewWorkspace,
  runAssuranceScenario,
  selectRecord,
  subscribe,
  updateFinding,
} from './state.mjs'
import { createRealtimeCall } from './realtime.mjs'
import { sendWhatsAppAlert, twiml, verifyTwilioRequest, whatsappReply } from './twilio.mjs'
import { sendInspectionReport } from './report.mjs'
import { draftWordDocument } from './word.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const production = process.argv.includes('--production')
const port = Number(process.env.GXP_SENTINEL_PORT || process.env.PORT || 4173)
const app = express()
const asyncRoute = (handler) => async (request, response, next) => {
  try { await handler(request, response) } catch (error) { next(error) }
}

app.disable('x-powered-by')
app.use(express.json({ limit: '12mb' }))
app.use(express.urlencoded({ extended: false }))

app.get('/api/state', (_request, response) => response.json(getState()))

app.get('/api/events', (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders()
  const send = (state) => response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
  send(getState())
  const unsubscribe = subscribe(send)
  const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 15000)
  request.on('close', () => {
    clearInterval(keepAlive)
    unsubscribe()
  })
})

app.post('/api/select', (request, response) => response.json(selectRecord(request.body)))
app.post('/api/document/import', (request, response) => response.json(importDocument(request.body)))
app.post('/api/checklist/apply', (request, response) => response.json(applyChecklist(request.body.documentId, request.body.checklistId)))
app.post('/api/checklist/add', (request, response) => response.json(addChecklist(request.body)))
app.post('/api/document/review', asyncRoute(async (request, response) =>
  response.json(await reviewDocument(request.body.documentId, request.body.actor)),
))
app.post('/api/document/draft', asyncRoute(async (request, response) =>
  response.json(await draftMissingSection(request.body.documentId, request.body.section)),
))
app.post('/api/document/draft/dismiss', (_request, response) => response.json(dismissDraft()))
app.post('/api/document/draft/decide', (request, response) => response.json(decideDraft(request.body.decision, request.body.actor)))
app.post('/api/copilot/ask', asyncRoute(async (request, response) => response.json(await answerQuestion(request.body.question, request.body.scope))))
app.post('/api/copilot/voice-message', (request, response) => response.json(recordMiraConversation(request.body.role, request.body.text)))
app.post('/api/realtime/session', express.text({ type: ['application/sdp', 'text/plain'], limit: '1mb' }), asyncRoute(async (request, response) => {
  const answer = await createRealtimeCall(request.body, getState(), String(request.query.view || 'home').slice(0, 30))
  response.type('application/sdp').send(answer)
}))
app.post('/api/workspace/review', asyncRoute(async (_request, response) => response.json(await reviewWorkspace())))
app.post('/api/assurance/run', asyncRoute(async (request, response) => response.json(await runAssuranceScenario(request.body.scenarioId))))

app.post('/api/scenario/release', async (_request, response) => {
  const state = getState()
  response.json(state)
  try {
    const result = await sendWhatsAppAlert(
      'Document Checker: The selected document has items that need attention. Reply EVIDENCE, OWNER, or OPEN.',
    )
    markWhatsAppDelivery(result.sent ? 'sent' : 'demo')
  } catch (error) {
    console.error(error.message)
    markWhatsAppDelivery('failed')
  }
})

app.post('/api/action/approve', (request, response) =>
  response.json(approveAction(request.body.actionId, request.body.actor || 'Demo Quality Approver', request.body.note)),
)
app.post('/api/action/reject', (request, response) =>
  response.json(rejectAction(request.body.actionId, request.body.actor || 'Demo Quality Approver', request.body.note)),
)
app.post('/api/action/prepare', (request, response) => response.json(prepareAction(request.body.findingId)))
app.post('/api/finding/update', (request, response) => response.json(updateFinding(request.body.findingId, request.body)))
app.post('/api/reset', (_request, response) => response.json(resetState()))

app.get('/api/inspection-pack', (_request, response) => {
  sendInspectionReport(response, inspectionPack())
})

app.get('/api/document/draft.docx', asyncRoute(async (_request, response) => {
  const state = getState()
  if (!state.draft) return response.status(404).json({ error: 'Create a draft before downloading it.' })
  const document = state.documents.find((item) => item.id === state.draft.documentId)
  const buffer = await draftWordDocument(state.draft, document)
  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  response.setHeader('Content-Disposition', 'attachment; filename="suggested-document-content.docx"')
  response.send(buffer)
}))

app.post('/api/whatsapp', (request, response) => {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${request.protocol}://${request.get('host')}`
  const webhookUrl = `${publicBaseUrl.replace(/\/$/, '')}/api/whatsapp`
  const valid = verifyTwilioRequest({
    signature: request.get('x-twilio-signature'),
    url: webhookUrl,
    params: request.body,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  })
  if (!valid) return response.status(403).send('Invalid Twilio signature')
  const reply = whatsappReply(request.body.Body, getState(), publicBaseUrl)
  response.type('text/xml').send(twiml(reply))
})

app.use((error, _request, response, _next) => {
  console.error(error.message)
  response.status(error.status || 500).json({ error: error.message })
})

if (production) {
  const dist = path.join(root, 'dist')
  if (!fs.existsSync(dist)) throw new Error('dist/ not found. Run npm run build first.')
  app.use(express.static(dist))
  app.use((_request, response) => response.sendFile(path.join(dist, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Document Checker running at http://127.0.0.1:${port}`)
  console.log(`Twilio webhook: ${(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '')}/api/whatsapp`)
})
