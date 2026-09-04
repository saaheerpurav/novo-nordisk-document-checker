import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testMode = Boolean(process.env.NODE_TEST_CONTEXT)
const dataDirectory = process.env.VERCEL
  ? path.join(os.tmpdir(), 'document-checker-data')
  : path.resolve(__dirname, '..', 'data')
if (!testMode) fs.mkdirSync(dataDirectory, { recursive: true })

const database = new DatabaseSync(testMode ? ':memory:' : path.join(dataDirectory, 'document-checker.db'))
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS workspace (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    document_id TEXT,
    document_version TEXT,
    prompt TEXT,
    response TEXT,
    model TEXT,
    response_id TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS uploaded_files (
    document_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime_type TEXT,
    data_url TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

export function loadWorkspace(schemaVersion) {
  const row = database.prepare('SELECT schema_version, state_json FROM workspace WHERE id = 1').get()
  if (!row || row.schema_version !== schemaVersion) return null
  try { return JSON.parse(row.state_json) } catch { return null }
}

export function saveWorkspace(schemaVersion, state) {
  database.prepare(`
    INSERT INTO workspace (id, schema_version, state_json, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version, state_json = excluded.state_json, updated_at = excluded.updated_at
  `).run(schemaVersion, JSON.stringify(state), new Date().toISOString())
}

export function loadUploadedFiles() {
  return database.prepare('SELECT document_id, name, mime_type, data_url FROM uploaded_files').all()
}

export function saveUploadedFile(documentId, file) {
  database.prepare(`
    INSERT INTO uploaded_files (document_id, name, mime_type, data_url, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET name = excluded.name, mime_type = excluded.mime_type, data_url = excluded.data_url
  `).run(documentId, file.name, file.type || '', file.dataUrl, new Date().toISOString())
}

export function clearUploadedFiles() {
  database.exec('DELETE FROM uploaded_files')
}

// --- Append-only audit trail -------------------------------------------------
// INSERT only. Never UPDATE, never DELETE — including on reset. The hash is
// computed here from the row being written, never from mutable in-memory state,
// and this is the only writer.
const auditColumns = ['at', 'actor', 'action', 'title', 'detail', 'document_id', 'document_version', 'prompt', 'response', 'model', 'response_id']

export function appendAuditEvent(record = {}) {
  const row = Object.fromEntries(auditColumns.map((key) => [key, record[key] == null ? null : String(record[key])]))
  const previous = database.prepare('SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1').get()
  const prevHash = previous?.hash || 'genesis'
  const hash = crypto.createHash('sha256').update(prevHash + JSON.stringify(row)).digest('hex')
  database.prepare(`
    INSERT INTO audit_events (at, actor, action, title, detail, document_id, document_version, prompt, response, model, response_id, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...auditColumns.map((key) => row[key]), prevHash, hash)
  return hash
}

export function readAuditEvents(limit = 500) {
  return database.prepare('SELECT * FROM audit_events ORDER BY seq DESC LIMIT ?').all(limit)
}

export function verifyAuditChain() {
  const rows = database.prepare('SELECT * FROM audit_events ORDER BY seq ASC').all()
  let prevHash = 'genesis'
  for (const row of rows) {
    const body = Object.fromEntries(auditColumns.map((key) => [key, row[key]]))
    const expected = crypto.createHash('sha256').update(prevHash + JSON.stringify(body)).digest('hex')
    if (row.prev_hash !== prevHash || row.hash !== expected) return { verified: false, brokenAt: row.seq, count: rows.length }
    prevHash = row.hash
  }
  return { verified: true, brokenAt: null, count: rows.length }
}

// Test-only: the tamper scenario needs a way to corrupt and restore one row.
// The only UPDATE against an append-only table, and it exists so the tamper
// test corrupts a real row instead of a mock. Gated on the test runner rather
// than an env flag: testMode also selects the ':memory:' database above, so
// this cannot reach a durable trail even if someone sets the variable by hand.
export function _tamperAuditRow(seq, title) {
  if (!testMode) throw new Error('_tamperAuditRow is available only under the test runner.')
  const before = database.prepare('SELECT title FROM audit_events WHERE seq = ?').get(seq)
  database.prepare('UPDATE audit_events SET title = ? WHERE seq = ?').run(title, seq)
  return before?.title
}
