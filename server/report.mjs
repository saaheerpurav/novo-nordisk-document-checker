import PDFDocument from 'pdfkit'

const colors = {
  ink: '#18313F',
  muted: '#5D707A',
  line: '#DDE6EA',
  pale: '#F3F7F8',
  teal: '#087E73',
  red: '#B83A4B',
  redPale: '#FFF1F3',
  greenPale: '#EAF8F4',
}

const formatDate = (value) => new Date(value).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function sendInspectionReport(response, report) {
  const { document, findings = [], actions = [], events, generatedAt } = report
  const pdf = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Document Check Report - ${document.title}`, Author: 'Document Checker' } })

  response.setHeader('Content-Type', 'application/pdf')
  response.setHeader('Content-Disposition', 'attachment; filename="document-check-report.pdf"')
  pdf.pipe(response)

  const pageWidth = pdf.page.width
  const contentWidth = pageWidth - 96
  const ensureSpace = (height) => { if (pdf.y + height > pdf.page.height - 60) pdf.addPage() }
  const sectionTitle = (title) => {
    ensureSpace(42)
    pdf.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(colors.ink).text(title)
    pdf.moveDown(0.35).strokeColor(colors.line).lineWidth(1).moveTo(48, pdf.y).lineTo(pageWidth - 48, pdf.y).stroke().moveDown(0.6)
  }

  pdf.rect(0, 0, pageWidth, 122).fill(colors.ink)
  pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text('DOCUMENT CHECKER', 48, 34)
  pdf.fontSize(24).text('Document Check Report', 48, 58)
  pdf.font('Helvetica').fontSize(9).fillColor('#C7D8DE').text(`Generated ${formatDate(generatedAt)}`, 48, 94)

  pdf.y = 148
  pdf.fillColor(colors.ink).font('Helvetica-Bold').fontSize(19).text(document.title, 48, pdf.y, { width: contentWidth - 110 })
  const scoreY = 140
  pdf.roundedRect(pageWidth - 130, scoreY, 82, 70, 10).fill(document.score >= 80 ? colors.greenPale : colors.redPale)
  pdf.fillColor(document.score >= 80 ? colors.teal : colors.red).font('Helvetica-Bold').fontSize(24).text(`${document.score}%`, pageWidth - 130, scoreY + 14, { width: 82, align: 'center' })
  pdf.font('Helvetica').fontSize(9).text('Complete', pageWidth - 130, scoreY + 44, { width: 82, align: 'center' })
  pdf.moveDown(1.4)

  const metadata = [
    ['Type', document.type],
    ['Version', document.version],
    ['Owner', document.owner],
    ['Status', document.status],
  ]
  const columnWidth = contentWidth / metadata.length
  const metadataY = pdf.y
  metadata.forEach(([label, value], index) => {
    const x = 48 + (index * columnWidth)
    pdf.font('Helvetica').fontSize(8).fillColor(colors.muted).text(label.toUpperCase(), x, metadataY, { width: columnWidth - 8 })
    pdf.font('Helvetica-Bold').fontSize(10).fillColor(colors.ink).text(String(value || 'Not provided'), x, metadataY + 15, { width: columnWidth - 8 })
  })
  pdf.y = metadataY + 48

  sectionTitle('Check results')
  document.checks.forEach((check) => {
    ensureSpace(58)
    const y = pdf.y
    const passed = check.result === 'pass'
    const note = check.note ? String(check.note) : (passed ? 'Requirement found in the document.' : 'Evidence was not found in the document.')
    const noteHeight = pdf.heightOfString(note, { width: contentWidth - 66 })
    const height = Math.max(48, noteHeight + 31)
    pdf.roundedRect(48, y, contentWidth, height, 7).fill(passed ? colors.greenPale : colors.redPale)
    pdf.circle(67, y + 19, 9).fill(passed ? colors.teal : colors.red)
    pdf.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text(passed ? 'OK' : '!', 58, y + 13, { width: 18, align: 'center' })
    pdf.fillColor(colors.ink).font('Helvetica-Bold').fontSize(10.5).text(check.label, 86, y + 10, { width: contentWidth - 50 })
    pdf.fillColor(colors.muted).font('Helvetica').fontSize(9).text(note, 86, y + 27, { width: contentWidth - 55 })
    pdf.y = y + height + 8
  })

  sectionTitle('Summary')
  pdf.font('Helvetica').fontSize(10.5).fillColor(colors.ink).text(document.summary, { lineGap: 3 })

  if (findings.length) {
    sectionTitle('Open issues')
    findings.forEach((finding) => {
      ensureSpace(58)
      const y = pdf.y
      pdf.font('Helvetica-Bold').fontSize(10).fillColor(finding.severity === 'Critical' || finding.severity === 'High' ? colors.red : colors.ink).text(`${finding.severity}: ${finding.title}`, 48, y, { width: contentWidth })
      pdf.font('Helvetica').fontSize(9).fillColor(colors.muted).text(`${finding.detail}\nOwner: ${finding.owner}  |  Status: ${finding.status}`, 48, y + 17, { width: contentWidth, lineGap: 2 })
      pdf.y = y + 57
    })
  }

  if (actions.length) {
    sectionTitle('Decisions and tasks')
    actions.forEach((action) => {
      ensureSpace(42)
      pdf.font('Helvetica-Bold').fontSize(9.5).fillColor(colors.ink).text(action.title)
      pdf.font('Helvetica').fontSize(8.5).fillColor(colors.muted).text(`${action.status}  |  ${action.owner}${action.decisionNote ? `  |  ${action.decisionNote}` : ''}`)
      pdf.moveDown(0.7)
    })
  }

  sectionTitle('History')
  events.slice(0, 8).forEach((event) => {
    ensureSpace(38)
    const y = pdf.y
    pdf.font('Helvetica').fontSize(8).fillColor(colors.muted).text(formatDate(event.at), 48, y, { width: 110 })
    pdf.font('Helvetica-Bold').fontSize(9.5).fillColor(colors.ink).text(event.title, 164, y, { width: contentWidth - 116 })
    pdf.font('Helvetica').fontSize(8.5).fillColor(colors.muted).text(event.actor, 164, y + 15, { width: contentWidth - 116 })
    pdf.y = y + 36
  })

  pdf.moveDown(0.5).font('Helvetica').fontSize(8).fillColor(colors.muted).text('Hackathon prototype. A person should review AI-generated results before making a final decision.')

  const pages = pdf.bufferedPageRange()
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    pdf.switchToPage(index)
    pdf.font('Helvetica').fontSize(8).fillColor(colors.muted).text(`Document Checker  |  Page ${index + 1} of ${pages.count}`, 48, pdf.page.height - 35, { width: contentWidth, align: 'center' })
  }
  pdf.end()
}
