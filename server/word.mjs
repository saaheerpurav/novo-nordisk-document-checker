import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

export async function draftWordDocument(draft, sourceDocument) {
  const lines = String(draft.text || '').split(/\r?\n/)
  const document = new Document({
    creator: 'Document Checker',
    title: `Suggested text for ${sourceDocument.title}`,
    description: 'AI-generated draft requiring human review',
    sections: [{
      children: [
        new Paragraph({ text: 'Suggested Document Content', heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun({ text: sourceDocument.title, bold: true }), new TextRun(`  |  ${draft.section}`)] }),
        new Paragraph({ text: `Review status: ${draft.status || 'Awaiting review'}` }),
        ...lines.map((line) => {
          if (line.startsWith('## ')) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_1 })
          if (line.startsWith('- ')) return new Paragraph({ text: line.slice(2), bullet: { level: 0 } })
          return new Paragraph({ text: line })
        }),
      ],
    }],
  })
  return Packer.toBuffer(document)
}
