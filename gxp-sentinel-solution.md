# Document Checker — Solution Brief

## The product

Document Checker is an AI-assisted workspace that helps a user review a document before an audit.

The user uploads a file, runs a checklist, sees missing information in plain language, asks questions about the document, generates suggested text for missing sections and downloads a report. Every important action is recorded.

## Main workflow

1. Upload a PDF, Word file, spreadsheet, image or text document.
2. Read its text, tables and basic details.
3. Compare it with the selected checklist or template.
4. Show passed checks and missing information.
5. Calculate a simple completion score.
6. Answer questions using the selected document.
7. Suggest text for a missing section.
8. Require a person to review generated text.
9. Record uploads, checks, questions, approvals and drafts in persistent local history.
10. Review all documents together using seven specialist roles and independently verify every retained issue.

## What came from the mentor HTML

The mentor concept is retained without making the interface technical:

- Several specialist checks can work behind one **Check document** button.
- Answers show the document used and answer confidence.
- The AI refuses to guess when the selected document does not contain an answer.
- AI-generated text remains a draft until a person reviews it.
- Safety tests demonstrate hidden instructions, outdated documents, conflicting approvals and attempted self-approval.
- Mira is a live female voice host powered by OpenAI Realtime. Each tap opens the microphone for one question, then releases it as soon as the speaker stops. Her mouth moves during the short answer, and the transcript appears in the typed Mira sidebar.
- Mira turns guidance into action. Her bubble shows screen specific shortcuts, and questions about status or next steps make the recommended real control pulse on the page.
- The Twilio webhook remains available for WhatsApp queries and alerts.

The agent architecture, control plane and advanced audit terminology belong in the technical explanation, not in the everyday interface.

## Current screens

| Screen | Purpose |
| --- | --- |
| Home | Upload a file and understand the three-step workflow. |
| Documents | Select a document, run checks, inspect missing items and draft fixes. |
| Mira | Ask natural questions using one document or the full workspace. |
| Issues | Inspect verified problems, supporting documents, owners and approval decisions. |
| Safety tests | Demonstrate how the AI handles unsafe or conflicting input. |

## Prototype boundary

The current build includes selectable and custom checklists, image-aware AI input, workspace-wide review, independent issue verification, persistent SQLite storage, Word drafts, PDF reports and explicit human decisions. Production work would still require enterprise identity and permissions, validated connectors, formal electronic signatures, retention controls and deployment qualification.
