import test from 'node:test'
import assert from 'node:assert/strict'
import { addChecklist, answerQuestion, applyChecklist, approveAction, decideDraft, draftMissingSection, getState, importDocument, prepareAction, recordMiraConversation, resetState, reviewDocument, reviewWorkspace, runAssuranceScenario } from '../server/state.mjs'
import { twiml, whatsappReply } from '../server/twilio.mjs'

const openAIResponse = (text) => ({ ok: true, json: async () => ({ id: 'resp_test', model: 'test-model', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }) })

test('initial workspace contains usable example documents', () => {
  const state = resetState()
  assert.equal(state.documents.length, 6)
  assert.equal(state.documents[0].title, 'Software Requirements Document')
  assert.ok(state.documents.every((document) => document.checks.length > 0))
})

test('document import creates a reviewable record', () => {
  resetState()
  const state = importDocument({ name: 'new-risk-assessment.txt', size: 4200, excerpt: 'draft for review' })
  assert.equal(state.documents[0].title, 'new-risk-assessment')
  assert.equal(state.documents[0].status, 'Review required')
  assert.match(state.events[0].detail, /ready to check/i)
})

test('custom checklists can be added and applied', () => {
  resetState()
  const original = getState().documents.find((item) => item.id === 'DOC-OAM-017')
  let state = addChecklist({ name: 'Supplier review', items: 'Supplier is approved\nAgreement is current\nAudit issues are closed' })
  const checklist = state.checklists.at(-1)
  assert.equal(checklist.items.length, 3)
  state = applyChecklist('DOC-OAM-017', checklist.id)
  const document = state.documents.find((item) => item.id === 'DOC-OAM-017')
  assert.equal(document.checklistId, checklist.id)
  assert.equal(document.checks[0].label, 'Supplier is approved')
  state = applyChecklist('DOC-OAM-017', original.checklistId)
  const restored = state.documents.find((item) => item.id === 'DOC-OAM-017')
  assert.deepEqual(restored.checks, original.checks)
  assert.equal(restored.score, original.score)
})

test('copilot answer uses the configured AI response', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  global.fetch = async () => openAIResponse(JSON.stringify({ answer: 'The approval date is missing.', confidence: 97, found: true, limitation: '' }))
  resetState()
  const state = await answerQuestion('What is the approval date?')
  const answer = state.copilot.at(-1)
  assert.equal(answer.confidence, 97)
  assert.equal(answer.model, 'test-model')
  assert.match(answer.text, /approval date is missing/i)
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('Mira voice transcript appears in the typed conversation', () => {
  resetState()
  recordMiraConversation('user', 'What needs attention?')
  const state = recordMiraConversation('assistant', 'Two documents need attention.')
  assert.deepEqual(state.copilot.slice(-2).map(({ role, text }) => ({ role, text })), [
    { role: 'user', text: 'What needs attention?' },
    { role: 'assistant', text: 'Two documents need attention.' },
  ])
  assert.equal(state.guide.text, 'Two documents need attention.')
})

test('Mira handles casual conversation without fake document confidence', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  global.fetch = async () => openAIResponse(JSON.stringify({ answer: 'I am Mira, your document review assistant.', confidence: 99, found: false, limitation: '', sourceIds: [] }))
  resetState()
  const state = await answerQuestion('Hi, what are you?')
  const answer = state.copilot.at(-1)
  assert.match(answer.text, /Mira/i)
  assert.equal(answer.confidence, null)
  assert.deepEqual(answer.sources, [])
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('document check and draft use live AI response data', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  const responses = [
    JSON.stringify({ checks: [{ label: 'Document owner is named', result: 'pass', note: 'Owner found.' }, { label: 'Approval and date are present', result: 'fail', note: 'Approval missing.' }, { label: 'Recovery steps are included', result: 'fail', note: 'Steps missing.' }, { label: 'Who to contact when something fails', result: 'pass', note: 'Contact found.' }], score: 50, summary: 'Two items need attention.' }),
    'DRAFT — FOR HUMAN REVIEW\n\nAdd recovery verification steps.\n\nConfirm the responsible person.',
  ]
  global.fetch = async () => openAIResponse(responses.shift())
  resetState()
  let state = await reviewDocument('DOC-OAM-017')
  assert.equal(state.documents.find((document) => document.id === 'DOC-OAM-017').score, 50)
  state = await draftMissingSection('DOC-OAM-017', 'Recovery steps are included')
  assert.equal(state.draft.model, 'test-model')
  assert.match(state.draft.text, /DRAFT/)
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('human approval retains actor, note and moves the issue into progress', () => {
  resetState()
  const state = approveAction('ACT-009', 'QA Test User', 'Evidence and task scope reviewed.')
  const action = state.actions.find((item) => item.id === 'ACT-009')
  assert.equal(action.status, 'Approved')
  assert.equal(action.approvedBy, 'QA Test User')
  assert.equal(action.decisionNote, 'Evidence and task scope reviewed.')
  assert.equal(state.findings.find((item) => item.id === 'FND-005').status, 'In progress')
})

test('a generated draft requires and records a human decision', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  global.fetch = async () => openAIResponse('DRAFT — FOR HUMAN REVIEW\n\nAdd the missing approval section.')
  resetState()
  await draftMissingSection('DOC-OAM-017', 'Approval and date are present')
  const state = decideDraft('approve', 'QA Reviewer')
  assert.equal(state.draft.status, 'Approved')
  assert.equal(state.draft.decidedBy, 'QA Reviewer')
  assert.equal(state.documents.find((item) => item.id === 'DOC-OAM-017').generatedSections.length, 1)
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('workspace review keeps only independently supported issues', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  const analysis = {
    summary: 'One supported issue was found.',
    analyses: ['Document reader', 'Compliance reviewer', 'Risk reviewer', 'Change reviewer', 'Incident reviewer', 'Access reviewer', 'Fix planner'].map((role) => ({ role, observation: 'Reviewed.' })),
    issues: [{ severity: 'High', title: 'Approval is missing', detail: 'The procedure has no approval date.', owner: 'Operations Team', sourceIds: ['DOC-OAM-017'], recommendation: 'Complete and approve the procedure.' }],
  }
  const verification = { results: [{ title: 'Approval is missing', supported: true, note: 'The source shows no approval date.' }] }
  const responses = [JSON.stringify(analysis), JSON.stringify(verification)]
  global.fetch = async () => openAIResponse(responses.shift())
  resetState()
  const state = await reviewWorkspace()
  assert.equal(state.workspaceReview.issueCount, 1)
  assert.equal(state.workspaceReview.analyses.length, 7)
  assert.ok(state.findings.some((finding) => finding.title === 'Approval is missing'))
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('an issue can be turned into a task awaiting approval', () => {
  resetState()
  const state = prepareAction('FND-001')
  assert.equal(state.actions.find((action) => action.findingId === 'FND-001').status, 'Awaiting approval')
})

test('Safety test records the live model response', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  global.fetch = async () => openAIResponse('The document does not provide an approval date. Embedded instructions were ignored.')
  resetState()
  const state = await runAssuranceScenario('S1')
  assert.equal(state.assuranceScenarios[0].result.outcome, 'Passed')
  assert.equal(state.assuranceScenarios[0].result.model, 'test-model')
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('WhatsApp returns evidence but never accepts approval', () => {
  resetState()
  const evidence = whatsappReply('EVIDENCE', getState(), 'https://sentinel.example')
  assert.match(evidence, /approval and date/i)
  const approval = whatsappReply('APPROVE', getState(), 'https://sentinel.example')
  assert.match(approval, /not accepted through WhatsApp/i)
})

test('TwiML escapes untrusted text', () => {
  assert.match(twiml('<unsafe & value>'), /&lt;unsafe &amp; value&gt;/)
})
