import crypto from 'node:crypto'

const xmlEscape = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

export function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
}

export function verifyTwilioRequest({ signature, url, params, authToken }) {
  if (!authToken || process.env.TWILIO_VALIDATE_SIGNATURE === 'false') return true
  const payload = Object.keys(params).sort().reduce((text, key) => text + key + params[key], url)
  const expected = crypto.createHmac('sha1', authToken).update(payload).digest('base64')
  const left = Buffer.from(signature || '')
  const right = Buffer.from(expected)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function whatsappReply(body, state, baseUrl) {
  const command = String(body || '').trim().toUpperCase()
  const document = state.documents.find((item) => item.id === state.selectedDocumentId) || state.documents[0]
  const missing = document.checks.filter((check) => check.result === 'fail')

  if (command.includes('EVIDENCE')) {
    return missing.length
      ? `${document.title}: ${missing.map((check) => check.label).join('; ')}.`
      : `${document.title} passed every check in this demo.`
  }
  if (command.includes('OWNER')) {
    return `${document.owner} owns ${document.title}. Status: ${document.status}.`
  }
  if (command.includes('URGENT') || command.includes('ISSUES')) {
    const issues = state.findings.filter((finding) => finding.status !== 'Resolved').slice(0, 3)
    return issues.length
      ? `Top issues: ${issues.map((issue) => `${issue.severity}: ${issue.title} (${issue.owner})`).join('; ')}.`
      : 'There are no open issues in the current workspace.'
  }
  if (command.includes('REPORT')) return `Download the selected document report: ${baseUrl}/api/inspection-pack`
  if (command.includes('OPEN')) return `Open the document review: ${baseUrl}/?view=documents`
  if (command.includes('STATUS') || command.includes('READY')) {
    return `${document.title} is ${document.score}% complete. ${missing.length} check(s) need attention.`
  }
  if (command.includes('APPROVE')) return `Approval is not accepted through WhatsApp. Review the document in the web app: ${baseUrl}/?view=documents`
  return 'Reply STATUS, EVIDENCE, OWNER, ISSUES, REPORT, or OPEN. Approval must happen in the web app.'
}

export async function sendWhatsAppAlert(message) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM
  const to = process.env.TWILIO_WHATSAPP_TO
  if (!sid || !token || !from || !to) return { sent: false, reason: 'not_configured' }

  const body = new URLSearchParams({ From: from, To: to, Body: message })
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Twilio returned ${response.status}: ${detail.slice(0, 240)}`)
  }
  return { sent: true, data: await response.json() }
}
