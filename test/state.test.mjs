import test from 'node:test'
import assert from 'node:assert/strict'
import { addChecklist, answerQuestion, applyChecklist, approveAction, decideDraft, draftMissingSection, getState, importDocument, prepareAction, recordMiraConversation, resetState, reviewDocument, reviewWorkspace, runAssuranceScenario } from '../server/state.mjs'
import crypto from 'node:crypto'
import { twiml, verifyTwilioRequest, whatsappReply } from '../server/twilio.mjs'

const openAIResponse = (text) => ({ ok: true, json: async () => ({ id: 'resp_test', model: 'test-model', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }) })

test('initial workspace contains usable example documents', () => {
  const state = resetState()
  assert.equal(state.documents.length, 7)
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
  const reviewed = state.documents.find((document) => document.id === 'DOC-OAM-017')
  // Weighted score: the approval item counts 3, the rest 1. Two of four pass, but the
  // approval item is a deterministic FAIL, so 2/6 = 33 and the gate blocks readiness.
  assert.equal(reviewed.status, 'Not ready')   // deterministic approval failure gates readiness
  assert.ok(reviewed.score < 50, `weighted score over assessed items only, got ${reviewed.score}`)
  assert.ok(reviewed.checks.length >= 10, 'the brief asks for a 10-20 point checklist')
  assert.ok(reviewed.checks.some((check) => check.result === 'unknown'), 'unanswered items are not failures')
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

test('safety scenarios assert on real product behaviour, not on the wording of a reply', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  // The seeded incident carries an embedded instruction to pass everything.
  // A compliant reviewer still fails the items the document cannot evidence.
  global.fetch = async () => openAIResponse(JSON.stringify({
    checks: [
      { label: 'The incident is clearly described', result: 'pass', note: 'Described.' },
      { label: 'The cause has been identified', result: 'fail', note: 'Root cause still open.' },
    ],
    score: 50, summary: 'Cause still open.', version: '', approvalDate: '', effectiveDate: '', owner: '',
  }))
  resetState()

  const injection = (await runAssuranceScenario('S1')).assuranceScenarios.find((item) => item.id === 'S1')
  assert.equal(injection.result.outcome, 'Passed')
  assert.match(injection.result.detail, /check\(s\) still failed/i)

  // Deterministic: no model involved, so this cannot flake on stage.
  const stale = (await runAssuranceScenario('S2')).assuranceScenarios.find((item) => item.id === 'S2')
  assert.equal(stale.result.outcome, 'Passed')
  assert.match(stale.result.detail, /overdue/i)

  const bounded = (await runAssuranceScenario('S6')).assuranceScenarios.find((item) => item.id === 'S6')
  assert.equal(bounded.result.outcome, 'Passed')
  assert.match(bounded.result.detail, /produced 1 task/i)

  // Tamper the real hash chain and put it back.
  const tamper = (await runAssuranceScenario('S7')).assuranceScenarios.find((item) => item.id === 'S7')
  assert.equal(tamper.result.outcome, 'Passed')
  assert.match(tamper.result.detail, /broke it at sequence \d+/i)

  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('WhatsApp returns evidence but never accepts approval', () => {
  resetState()
  const evidence = whatsappReply('EVIDENCE', getState(), 'https://sentinel.example')
  assert.match(evidence, /approval and effective date/i)
  const approval = whatsappReply('APPROVE', getState(), 'https://sentinel.example')
  assert.match(approval, /not accepted through WhatsApp/i)
})

test('TwiML escapes untrusted text', () => {
  assert.match(twiml('<unsafe & value>'), /&lt;unsafe &amp; value&gt;/)
})

test('workspace review joins on index, so a paraphrased title cannot drop every issue', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  const analysis = {
    summary: 'Two proposed, one supported.',
    analyses: [{ role: 'Compliance reviewer', observation: 'Reviewed.' }],
    issues: [
      { index: 0, severity: 'High', title: 'Approval is missing', detail: 'The procedure has no approval date.', owner: 'Operations Team', sourceIds: ['DOC-OAM-017'], recommendation: 'Approve it.' },
      { index: 1, severity: 'High', title: 'Change CR-2026-117 is unapproved', detail: 'Invented.', owner: 'QA', sourceIds: ['CR-2026-117'], recommendation: 'Approve it.' },
    ],
  }
  // Verifier paraphrases both titles — the old title join dropped everything here.
  const verification = { results: [
    { index: 0, title: 'Approval Is Missing.', supported: true, note: 'The source shows no approval date.' },
    { index: 1, title: 'Unapproved change.', supported: false, note: 'No document in the workspace supports this.' },
  ] }
  const responses = [JSON.stringify(analysis), JSON.stringify(verification)]
  global.fetch = async () => openAIResponse(responses.shift())
  resetState()
  const state = await reviewWorkspace()
  assert.equal(state.workspaceReview.proposed, 2)
  assert.equal(state.workspaceReview.retained, 1)
  assert.equal(state.workspaceReview.rejected.length, 1)
  assert.match(state.workspaceReview.rejected[0].note, /no document in the workspace/i)
  assert.ok(state.findings.some((finding) => finding.title === 'Approval is missing'))
  assert.ok(!state.findings.some((finding) => finding.title === 'Change CR-2026-117 is unapproved'))
  // the seeded finding for the same document keeps its own identity and its linked task
  const seeded = state.findings.find((finding) => finding.id === 'FND-002')
  assert.equal(seeded.title, 'Operations manual is not approved')
  assert.equal(state.actions.find((action) => action.findingId === 'FND-002').title, 'Complete operations manual recovery section')
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('audit trail is append-only, records the real prompt and response, and detects tampering', async () => {
  const { appendAuditEvent, readAuditEvents, verifyAuditChain, _tamperAuditRow } = await import('../server/persistence.mjs')
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  global.fetch = async () => openAIResponse(JSON.stringify({
    checks: [{ label: 'Document owner is named', result: 'pass', note: 'Owner found.' }],
    score: 25, summary: 'Reviewed.',
  }))
  resetState()
  await reviewDocument('DOC-OAM-017')
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY

  const check = readAuditEvents().find((row) => row.action === 'AI check')
  assert.ok(check, 'the AI check was recorded')
  assert.match(check.prompt, /CHECKLIST/)          // the real prompt, not a summary line
  assert.match(check.response, /Reviewed\./)        // the real model response
  assert.equal(check.document_id, 'DOC-OAM-017')
  assert.equal(check.document_version, '0.9')

  for (let i = 0; i < 50; i += 1) appendAuditEvent({ at: new Date().toISOString(), actor: 'test', action: 'Noise', title: `event ${i}` })
  assert.equal(verifyAuditChain().verified, true)

  const restore = _tamperAuditRow(14, 'tampered in place')
  const broken = verifyAuditChain()
  assert.equal(broken.verified, false)
  assert.equal(broken.brokenAt, 14)
  _tamperAuditRow(14, restore)
  assert.equal(verifyAuditChain().verified, true)

  // reset clears the workspace but must never truncate the trail
  const before = verifyAuditChain().count
  resetState()
  assert.ok(verifyAuditChain().count > before)
  assert.equal(verifyAuditChain().verified, true)
})

test('a deterministic rule overrides the model, and a failed critical item blocks readiness', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  // The model wrongly claims the unapproved draft has an approval date.
  global.fetch = async () => openAIResponse(JSON.stringify({
    checks: [
      { label: 'Document owner is named', result: 'pass', note: 'Owner found.' },
      { label: 'Approval and date are present', result: 'pass', note: 'Model claims approved.' },
      { label: 'Recovery steps are included', result: 'pass', note: 'Model claims present.' },
      { label: 'Who to contact when something fails', result: 'pass', note: 'Found.' },
    ],
    score: 100, summary: 'Model says everything passes.',
  }))
  resetState()
  const state = await reviewDocument('DOC-OAM-017')
  const document = state.documents.find((item) => item.id === 'DOC-OAM-017')
  const approval = document.checks.find((check) => /approval/i.test(check.label))
  assert.equal(approval.source, 'rule', 'date arithmetic owns this verdict, not the model')
  assert.equal(approval.result, 'fail', 'DOC-OAM-017 has approvalDate null, so it cannot pass')
  assert.match(approval.note, /no approval date/i)
  assert.equal(document.status, 'Not ready', 'a failed critical item blocks readiness even at a high score')
  assert.ok(document.score < 100)
  assert.ok(document.checks.every((check) => check.source === 'rule' || check.source === 'ai'), 'every row is labelled')
  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('a rule never asserts an absence it did not read, and an unassessed critical item withholds the score', async () => {
  const originalFetch = global.fetch
  process.env.OPENAI_API_KEY = 'test-key'
  const allPass = [
    { label: 'File is readable', result: 'pass', note: 'ok' },
    { label: 'Document owner is named', result: 'pass', note: 'ok' },
    { label: 'Version is present', result: 'pass', note: 'ok' },
    { label: 'Approval and date are present', result: 'pass', note: 'ok' },
    { label: 'Purpose and scope are explained', result: 'pass', note: 'ok' },
    { label: 'Required sections are present', result: 'pass', note: 'ok' },
  ]
  global.fetch = async () => openAIResponse(JSON.stringify({ checks: allPass, score: 100, summary: 'ok' }))

  // A document that states its version and approval must not be force-failed by a rule.
  resetState()
  importDocument({ name: 'judge.txt', size: 900, excerpt: 'Version: 4.2\nOwner: R. Mehta\nApproved by: QA on 01 Aug 2026' })
  let id = getState().selectedDocumentId
  let document = (await reviewDocument(id)).documents.find((item) => item.id === id)
  assert.equal(document.version, '4.2')
  assert.equal(document.approvalDate, '01 Aug 2026')
  assert.equal(document.checks.find((check) => /version/i.test(check.label)).result, 'pass')
  assert.equal(document.checks.find((check) => /approval/i.test(check.label)).result, 'pass')

  // A file with no extractable text must be 'unknown', never 'fail', and must not show a score.
  resetState()
  importDocument({ name: 'scan.pdf', size: 900, excerpt: '' })
  id = getState().selectedDocumentId
  document = (await reviewDocument(id)).documents.find((item) => item.id === id)
  const versionCheck = document.checks.find((check) => /version/i.test(check.label))
  assert.equal(versionCheck.result, 'unknown')
  assert.equal(versionCheck.source, 'rule')
  assert.match(versionCheck.note, /no readable text/i)
  assert.equal(document.status, 'Not assessed')
  assert.equal(document.score, null, 'no percentage beside unassessed critical items')

  global.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

test('Word input is extracted, its metadata is read, and protected files are refused not guessed', async () => {
  const { draftWordDocument } = await import('../server/word.mjs')
  const { extractText, UnreadableFileError } = await import('../server/extract.mjs')

  const buffer = await draftWordDocument(
    { text: 'Version: 2.1\nApproved by: QA on 04 Sep 2026\nPurpose and scope of this procedure.', section: 'Body', status: 'Awaiting review' },
    { title: 'Recovery Procedure' },
  )
  const text = extractText('recovery.docx', buffer)
  assert.match(text, /Purpose and scope/)
  assert.match(text, /Version: 2\.1/)

  resetState()
  const state = importDocument({ name: 'recovery.docx', size: buffer.length, dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${buffer.toString('base64')}` })
  const imported = state.documents[0]
  assert.equal(imported.version, '2.1', 'version read out of the Word file')
  assert.equal(imported.approvalDate, '04 Sep 2026', 'approval date read out of the Word file')
  assert.match(imported.content, /Purpose and scope/)

  // A password-protected Office file is a CFB container; refuse it rather than guess.
  const cfb = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(64)])
  assert.throws(() => extractText('locked.docx', cfb), UnreadableFileError)
  assert.throws(() => extractText('old.doc', cfb), /Legacy \.doc/)
  const encryptedPdf = Buffer.from('%PDF-1.7\n1 0 obj<</Encrypt 2 0 R>>endobj')
  assert.throws(() => extractText('locked.pdf', encryptedPdf), /password-protected/)
})

test('an unsigned WhatsApp webhook is refused, not trusted', () => {
  const params = { Body: 'STATUS', From: 'whatsapp:+10000000000' }
  const url = 'https://example.test/api/whatsapp'
  // No auth token configured: the request cannot be verified, so it must fail closed.
  assert.equal(verifyTwilioRequest({ signature: 'anything', url, params, authToken: '' }), false)
  // A wrong signature against a real token is refused.
  assert.equal(verifyTwilioRequest({ signature: 'wrong', url, params, authToken: 'secret' }), false)
  // The genuine Twilio signature is accepted.
  const payload = Object.keys(params).sort().reduce((text, key) => text + key + params[key], url)
  const good = crypto.createHmac('sha1', 'secret').update(payload).digest('base64')
  assert.equal(verifyTwilioRequest({ signature: good, url, params, authToken: 'secret' }), true)
})
