# Document Checker

Document Checker is a working hackathon prototype for **AI-assisted document compliance and audit readiness**.

The main flow is intentionally simple:

**Upload documents → choose a checklist → review one file or the full workspace → fix verified issues → approve drafts and tasks → download reports.**

The mentor HTML influenced the supporting features: seven behind-the-scenes review roles, independently verified workspace issues, evidence-backed answers, human approval, persistent history, seven visible safety tests, WhatsApp support and optional voice guidance. These features support the document workflow instead of becoming the interface itself.

Document checks, document Q&A, missing-section drafts and safety tests call the OpenAI Responses API from the server. The API key never goes to the browser. The default model is `gpt-5.4-mini` and can be changed with `OPENAI_MODEL`.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
# Add OPENAI_API_KEY to .env
npm run dev
```

Open <http://127.0.0.1:4173>.

## Explore the product

1. Click **Review all documents** on Home to run the seven review roles and independent verification.
2. Open **Issues** to inspect evidence, assign an owner and approve a fix task.
3. Open **Documents**, select a checklist and run **Check with AI**.
4. Click **Draft fix**, review it, download Word and approve or reject it.
5. Open **Mira** and choose the selected document or all documents.
6. Download the selected document's PDF report.
7. Open **Safety tests** to run any of the seven live tests.
8. Click the floating **Mira** face and ask one question. The microphone switches off when you stop speaking. Click her again for another question, or open **Mira** in the sidebar to type and view the conversation.
9. Ask Mira what is left or what to do next. She names and highlights the relevant control, while her bubble offers working shortcuts for the current screen.

Use **Upload** to attach a PDF, Word document, spreadsheet, image, text, CSV or JSON file up to 8 MB. Documents and workspace state are stored locally in SQLite and sent to OpenAI only when you request AI analysis. Uploaded images are analyzed visually. Production deployment would still require organization identity, permissions, retention policy and validated connectors.

## Twilio WhatsApp

The existing Twilio webhook remains available at `/api/whatsapp`. Configure the values in `.env.example` and expose the local server through a public HTTPS URL.

## Verify

```powershell
npm test
npm run build
npm run verify:ui
```

The prototype uses sample data and simplified checks. It is not a compliance certification or a production document-management system.
