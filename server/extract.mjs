import zlib from 'node:zlib'

// Reads text out of the file types the brief's INPUT panel names. A .docx and an
// .xlsx are both ZIP containers of XML, and node:zlib already inflates raw deflate,
// so this needs no parsing dependency.
// ponytail: minimal ZIP local-header scan, not a full central-directory reader.
// Handles stored (0) and deflated (8) entries, which is every real Office file.

const SIGNATURE = 0x04034b50

function readZipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== SIGNATURE) {
      const next = buffer.indexOf('PK\x03\x04', offset + 1, 'latin1')
      if (next === -1) break
      offset = next
      continue
    }
    const method = buffer.readUInt16LE(offset + 8)
    const flags = buffer.readUInt16LE(offset + 6)
    let compressed = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength)
    const start = offset + 30 + nameLength + extraLength

    // Streaming writers set bit 3 and put the sizes in a trailing descriptor.
    if ((flags & 0x08) !== 0 && !compressed) {
      const next = buffer.indexOf('PK\x03\x04', start, 'latin1')
      compressed = (next === -1 ? buffer.length : next) - start
    }
    const body = buffer.subarray(start, start + compressed)
    if (!entries.has(name)) {
      try {
        entries.set(name, method === 8 ? zlib.inflateRawSync(body) : body)
      } catch {
        // A corrupt member should not abort the whole file.
      }
    }
    offset = start + compressed
  }
  return entries
}

const stripTags = (xml) => String(xml)
  .replace(/<\/w:tr>/g, '\n')
  .replace(/<w:p[ >][^>]*>|<w:p\/>|<\/w:p>/g, '\n')
  .replace(/<w:tab\/>/g, '\t')
  .replace(/<\/w:tc>/g, '\u0000')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/\s*\u0000\s*/g, '\t')   // restore cell breaks after whitespace collapse
  .replace(/\t+\n/g, '\n')
  .trim()

function docxText(buffer) {
  const entries = readZipEntries(buffer)
  const parts = ['word/document.xml', ...[...entries.keys()].filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name))]
  const text = parts.filter((name) => entries.has(name)).map((name) => stripTags(entries.get(name).toString('utf8'))).join('\n')
  return text.trim()
}

function xlsxText(buffer) {
  const entries = readZipEntries(buffer)
  const shared = entries.has('xl/sharedStrings.xml')
    ? [...entries.get('xl/sharedStrings.xml').toString('utf8').matchAll(/<si>(.*?)<\/si>/gs)].map((match) => stripTags(match[1]))
    : []
  const lines = []
  for (const [name, body] of entries) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue
    lines.push(`# ${name.replace(/^xl\/worksheets\//, '').replace(/\.xml$/, '')}`)
    for (const [, row] of body.toString('utf8').matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
      const cells = [...row.matchAll(/<c[^>]*?(?:\st="(\w+)")?[^>]*>(?:<v>(.*?)<\/v>|<is>(.*?)<\/is>)?<\/c>/gs)]
        .map(([, type, value, inline]) => {
          if (inline != null) return stripTags(inline)
          if (value == null) return ''
          return type === 's' ? (shared[Number(value)] ?? '') : value
        })
      if (cells.some((cell) => cell !== '')) lines.push(cells.join('\t'))
    }
  }
  return lines.join('\n').trim()
}

/** Thrown for files we can identify but deliberately refuse to guess at. */
export class UnreadableFileError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnreadableFileError'
    this.status = 400
  }
}

export function extractText(name = '', buffer) {
  if (!buffer?.length) return ''
  const head = buffer.subarray(0, 8)

  // Password-protected Office files are CFB containers, not ZIPs.
  if (head.subarray(0, 4).toString('hex') === 'd0cf11e0') {
    if (/\.(docx|xlsx|pptx)$/i.test(name)) {
      throw new UnreadableFileError('This Office file is password-protected. Remove the password and upload it again.')
    }
    throw new UnreadableFileError('Legacy .doc and .xls files are not supported. Save the file as .docx, .xlsx or PDF.')
  }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-' && /\/Encrypt[\s>\/]/.test(buffer.toString('latin1'))) {
    throw new UnreadableFileError('This PDF is password-protected and cannot be read. Upload an unprotected copy.')
  }

  if (/\.docx$/i.test(name)) return docxText(buffer)
  if (/\.xlsx$/i.test(name)) return xlsxText(buffer)
  return ''
}

export function bufferFromDataUrl(dataUrl = '') {
  const match = String(dataUrl).match(/^data:[^;,]*;base64,(.*)$/s)
  return match ? Buffer.from(match[1], 'base64') : null
}
