import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testMode = Boolean(process.env.NODE_TEST_CONTEXT)
const dataDirectory = path.resolve(__dirname, '..', 'data')
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
