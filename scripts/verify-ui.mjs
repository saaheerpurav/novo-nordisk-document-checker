import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const candidates = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium']
async function findChrome() { for (const candidate of candidates) { try { await fs.access(candidate); return candidate } catch { /* continue */ } } throw new Error('Chrome or Chromium was not found.') }

const output = path.join(os.tmpdir(), 'document-checker-verification')
const base = process.env.VERIFY_URL || 'http://127.0.0.1:4173'
await fs.mkdir(output, { recursive: true })
await fetch(`${base}/api/reset`, { method: 'POST' })
const aiConfigured = await fetch(`${base}/api/state`).then((response) => response.json()).then((state) => state.ai.configured)
const browser = await puppeteer.launch({ executablePath: await findChrome(), headless: true, args: ['--disable-gpu'] })

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.welcome')
  await page.screenshot({ path: path.join(output, 'home.png'), fullPage: true })
  if (aiConfigured) {
    await page.click('.welcome-actions .button:last-child')
    await page.waitForSelector('.review-progress')
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await page.screenshot({ path: path.join(output, 'workspace-review-running.png'), fullPage: true })
    await page.waitForSelector('.review-progress', { hidden: true, timeout: 90000 })
  }

  await page.goto(`${base}/?view=documents`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.review-panel')
  if (!await page.$('.checklist-picker select')) throw new Error('Checklist selector was not available.')
  const originalChecklist = await page.$eval('.checklist-picker select', (select) => select.value)
  const originalScore = await page.$eval('.score-block strong', (element) => element.textContent)
  const originalPassed = await page.$$eval('.check-pass', (items) => items.length)
  await page.select('.checklist-picker select', 'CHK-GENERAL')
  await page.waitForFunction((score) => document.querySelector('.score-block strong')?.textContent !== score, {}, originalScore)
  await page.select('.checklist-picker select', originalChecklist)
  await page.waitForFunction((score, passed) => document.querySelector('.score-block strong')?.textContent === score && document.querySelectorAll('.check-pass').length === passed, {}, originalScore, originalPassed)
  await page.click('.checklist-picker .text-button')
  await page.waitForSelector('.small-modal')
  await page.click('.small-modal header .icon-button')
  await page.waitForSelector('.small-modal', { hidden: true })
  const draftButton = await page.$('.check-fail .text-button')
  if (!draftButton) throw new Error('No draft action was available for a failed check.')
  await draftButton.click()
  if (aiConfigured) {
    await page.waitForSelector('.modal textarea', { timeout: 50000 })
    if (!await page.$('a[href="/api/document/draft.docx"]')) throw new Error('Word draft download was not available.')
    const wordResponse = await fetch(`${base}/api/document/draft.docx`)
    const wordBytes = new Uint8Array(await wordResponse.arrayBuffer())
    if (wordResponse.headers.get('content-type') !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || String.fromCharCode(...wordBytes.slice(0, 2)) !== 'PK') throw new Error('Draft download was not a DOCX file.')
    await page.screenshot({ path: path.join(output, 'document-draft.png'), fullPage: true })
    await page.click('.modal header .icon-button')
    await page.waitForSelector('.modal', { hidden: true })
  } else {
    await page.waitForSelector('.error')
    await page.screenshot({ path: path.join(output, 'ai-connection-required.png'), fullPage: true })
  }

  const pdfResponse = await fetch(`${base}/api/inspection-pack`)
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer())
  if (pdfResponse.headers.get('content-type') !== 'application/pdf' || String.fromCharCode(...pdfBytes.slice(0, 5)) !== '%PDF-') throw new Error('Report download was not a PDF file.')

  await page.goto(`${base}/?view=issues`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.issue-detail')
  const prepareButton = await page.$('.decision-box .button--primary')
  if (prepareButton) {
    await prepareButton.click()
    await page.waitForSelector('.decision-box textarea')
  }
  await page.screenshot({ path: path.join(output, 'issues.png'), fullPage: true })

  await page.goto(`${base}/?view=ask`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.ask-sidebar > button')
  await page.type('.ask-form textarea', 'Hi, what are you?')
  await page.click('.ask-form .button')
  if (aiConfigured) await page.waitForFunction(() => document.querySelectorAll('.message').length >= 3, { timeout: 50000 })
  else await page.waitForSelector('.error')
  if (aiConfigured) {
    const casualReply = await page.$$eval('.message--assistant', (messages) => messages.at(-1)?.textContent || '')
    if (!/Mira/i.test(casualReply) || /Based on:|Confidence:/i.test(casualReply)) throw new Error('Mira did not handle casual conversation correctly.')
  }
  await page.screenshot({ path: path.join(output, 'ask-ai.png'), fullPage: true })

  await page.goto(`${base}/?view=safety`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.safety-card .button')
  await page.click('.safety-card .button')
  if (aiConfigured) await page.waitForSelector('.test-result', { timeout: 50000 })
  else await page.waitForSelector('.error')
  await page.screenshot({ path: path.join(output, 'safety-tests.png'), fullPage: true })

  const mobile = await browser.newPage()
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await mobile.goto(base, { waitUntil: 'domcontentloaded' })
  await mobile.waitForSelector('.welcome')
  await mobile.screenshot({ path: path.join(output, 'mobile-home.png'), fullPage: true })
  await mobile.close()
  console.log(`UI verification passed. Screenshots: ${output}`)
} finally { await browser.close() }
