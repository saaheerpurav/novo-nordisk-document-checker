# Reconciliation — Document Checker / GxP Sentinel

Every line number below was read out of the working tree during this pass. Where the audit corpus carried a stale number, the corrected one is used.

---

## 1. BUILD THIS

Ordered by judge visibility, then effort. Nothing here removes a working capability.

### 1.1 Backfill document metadata from the model review — the one fix that unblocks five promises

**Demanded by:** brief image INPUT panel ("PDF, Word, Excel, Images…") + OUTPUT 1 ("Score: 82%"); `gxp-sentinel-solution.md:11-12,15`; `README.md:38`.

**The defect, verified:** `server/extract.mjs:110-112` handles only `.docx` and `.xlsx`, then `return ''`. `src/App.jsx:506` reads text client-side only for `/\.(txt|md|csv|json)$/i`. So a PDF or image reaches `server/state.mjs:539` with `metadataRead: Boolean(text.trim())` → `false`. `server/state.mjs:59` `const readable = document.metadataRead !== false` then makes four rules return `unknown` — version, approval+date, approval signatures, effective date — and `server/state.mjs:571` `if (rule) return {…source: 'rule'}` **discards the AI verdict unconditionally**. Because `CRITICAL` (`server/state.mjs:103`) matches `approval|sign(ed|ature)|effective date`, `readiness()` hits `criticalUnknown` at `server/state.mjs:113` and returns `{score: null, status: 'Not assessed'}`.

The model *did* read the file: `documentInput()` at `server/state.mjs:125-131` attaches it as `input_file` (or `input_image, detail:'high'`). So the screen shows **"File is readable — pass — AI"** directly above three RULE rows reading "No readable text was extracted from this file". That visible self-contradiction on the brief's first-named input type is worse than the missing percentage.

**The change:**
1. `server/state.mjs:145-156` — add `version`, `approvalDate`, `effectiveDate`, `owner` (nullable strings) to `documentReviewSchema`; instruct the reviewer to return metadata verbatim or null.
2. `server/state.mjs:569`, before `deterministicChecks(document)`:
   ```js
   document.version ??= response.data.version
   document.approvalDate ??= response.data.approvalDate
   document.effectiveDate ??= response.data.effectiveDate
   if (document.owner === 'Unassigned' && response.data.owner) document.owner = response.data.owner
   document.metadataRead = document.metadataRead || uploadedFiles.has(document.id)
   ```
3. Regression test in `test/state.test.mjs` beside `:313`: import a PDF with empty `excerpt` + a real `dataUrl`, stub the review with metadata, assert `score != null` and that no check note contains "No readable text".

The date arithmetic stays deterministic and the RULE badge stays truthful — the rules just finally get a date to work on. Do **not** add a PDF library.

**Files:** `server/state.mjs`, `test/state.test.mjs`. Effort M. Fixes PDF, image, `.pptx`, `.rtf`, `.html` in one edit.

### 1.2 Render the seven review roles

**Demanded by:** `gxp-sentinel-solution.md:20` ("seven specialist roles"), `README.md:9,28`, deck flow node at `:486`. This is the pitch's headline claim and it currently has **zero pixels**.

`server/state.mjs:776` stores `analyses: analysis.data.analyses`. `grep -n analyses src/App.jsx` → **nothing**. Home (`src/App.jsx:76`) renders only `summary` plus the proposed/retained/rejected ledger.

**Change:** in the workspace-review panel at `src/App.jsx:76`, after the summary `<p>`, behind a toggle reusing the existing `showRejected` pattern:
```jsx
{state.workspaceReview.analyses?.map(a => <div key={a.role} className="role-observation"><strong>{a.role}</strong><span>{a.observation}</span></div>)}
```
Add the same block as a section in `sendInspectionReport` (`server/report.mjs`) so the downloaded PDF carries it. Data already exists and is already on the wire. **Effort S. Display only.**

### 1.3 Render the evidence graph

**Demanded by:** deck architecture card 04 (`:533`), demo step 04 (`:555`), and the brief's "Identify Gaps" line.

`server/state.mjs:384` `evidenceGraph()` seeds 6 nodes / 6 edges (URS-042 → RISK-PSE-009 → DS-042 → TC-042 → EX-042 missing → QA-042 blocked) and `:439` ships it in state. `src/App.jsx` never mentions it — dead data streamed over SSE to a browser that ignores it.

**Change:** add a seventh entry to `views` in `src/App.jsx:12` and one component: lay `state.evidenceGraph.nodes` out in a row inside a single `<svg>`, edges as `<line>`, colour by `node.state`, `onClick` → `select({documentId})` when the id matches a document. ~40 lines, no library. Then fix the deck caption to say 6 nodes / 6 relationships (it currently claims "8 nodes · 7 relationships"). **Effort S.**

### 1.4 Fix the click-blocking Mira bubble — `npm run verify:ui` fails today

**Demanded by:** `README.md:44-50`, which lists three commands as if all three pass. Two do; the third does not.

`npm test` → 19/19. `npm run build` → 16 modules, ~136ms. `npm run verify:ui` → **exit 1**, `TimeoutError: Waiting for selector '.error' failed at scripts/verify-ui.mjs:57`, reproducible with a live server and Chrome present.

Root cause is a **product** bug, not a script artefact: `scripts/verify-ui.mjs:46` clicks `.check-fail .text-button` ("Draft fix"), and `document.elementFromPoint()` at that button's centre returns `div.assistant-suggestions` — Mira's panel (`src/App.jsx:457`, open by default, auto-closes at 6500ms) sits over it. `src/styles.css:140` fixes `.assistant` at `right:22px; bottom:20px; width:350px; z-index:45` while `.content` reserves only 70px bottom padding. A presenter clicking Draft fix in the first 6.5 seconds gets nothing.

**Change:** `src/styles.css` — `pointer-events: none` on `.assistant`, `pointer-events: auto` on its children (one line each, keeps the bubble). Add `npm run dev   # in another terminal` as the first line of the README Verify block. **Effort S. Highest demo-risk item in the repo.**

### 1.5 Give the WhatsApp channel a button

**Demanded by:** `gxp-sentinel-solution.md:33` ("queries **and alerts**"), `README.md:9,40-42`.

Inbound is real and verified: `server/index.mjs:136-146` verifies the Twilio signature (403 on failure) and `server/twilio.mjs:23-51` answers STATUS/EVIDENCE/OWNER/ISSUES/REPORT/OPEN and refuses APPROVE. Outbound is unreachable: `sendWhatsAppAlert` is called only from `POST /api/scenario/release` (`server/index.mjs:88-100`); `grep "whatsapp\|scenario/release" src/App.jsx` → nothing. `state.whatsapp.delivery` (`server/state.mjs:443`, set at `:858`) is never rendered.

**Change:** one button in `IssueEditor` (`src/App.jsx:102`) beside "Prepare fix task" posting `/api/scenario/release`, plus a status line showing `state.whatsapp.delivery` (`sent` / `demo` / `failed`). **Effort S.** The route and the Twilio client already work.

### 1.6 Fix the .xlsx cell-type regex — Excel currently extracts as integers

**Demanded by:** brief INPUT panel ("Excel"), `README.md:38`, `gxp-sentinel-solution.md:11`, deck card 03 (`:532`).

`server/extract.mjs:74`: `/<c[^>]*?(?:\st="(\w+)")?[^>]*>…/` — the lazy `[^>]*?` lets the optional group match empty and the trailing `[^>]*` swallow `t="s"`, so `type` is always `undefined` and `:78` returns the raw shared-string **index**. A hand-built sheet extracts as `0\t1\t2` instead of the text. The same regex requires `</c>`, so self-closing empty cells `<c r="D1"/>` vanish and columns shift.

**Change** (`server/extract.mjs:73-81`) — read the attributes explicitly:
```js
for (const [, attrs, body = ''] of row.matchAll(/<c\b([^>]*)(?:\/>|>(.*?)<\/c>)/gs)) { … }
const inline = body.match(/<is>(.*?)<\/is>/s); if (inline) return stripTags(inline[1])
const v = body.match(/<v>(.*?)<\/v>/s)?.[1]; if (v == null) return ''
return /\st="s"/.test(attrs) ? (shared[Number(v)] ?? '') : v
```
Add one assertion beside the Word test at `test/state.test.mjs:313`: a two-row sharedStrings sheet must extract `Risk ID\tSeverity`, not `0\t1`. **Effort S. No xlsx test exists today.**

### 1.7 Preserve table rows in .docx

**Demanded by:** brief PROCESS 1 ("Extract text, **tables**, images…"), KEY FEATURES ("Reads Text, Tables & Images"), `gxp-sentinel-solution.md:12`.

`server/extract.mjs:47-53`: the `<w:p>` rule fires inside every `<w:tc>` and inserts a newline, and the tab from `</w:tc>` is then eaten by `.replace(/[ \t]+\n/g, '\n')` at `:53`. A 3x2 risk table comes out one cell per line — rows and columns gone. "What is the mitigation for R-1?" gets a column-less word list.

**Change:** flatten table blocks before the paragraph rule, inside `docxText` (`:57`):
```js
const flattenTables = (xml) => xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (t) => t
  .replace(/<w:p[ >][^>]*>|<w:p\/>|<\/w:p>/g, ' ').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n'))
```
then `stripTags(flattenTables(entries.get(name).toString('utf8')))`. Verified output: `Risk ID \t Severity \t Mitigation\n R-1 \t High \t Add second check`. **Effort S.**

### 1.8 Only attach files the API can actually read

**Demanded by:** brief PROCESS 1 + INPUT panel (Word/Excel). Also a **security** item.

`documentInput()` (`server/state.mjs:125-131`) returns the extracted-text path **only when there is no stored file**; otherwise it sends the raw upload. So a `.docx` whose text was cleanly extracted is sent to the Responses API as an OOXML blob under `input_file` — best case the model gets binary instead of the clean text we already have, likely case an upstream 400 in the red banner (`server/index.mjs:150-153`).

**Change** at `server/state.mjs:125`, applied to the `includeFiles` loop at `:147-151` too:
```js
const attachable = /^image\//.test(uploaded?.type || '') || /pdf/i.test(`${uploaded?.type} ${uploaded?.name}`)
if (!uploaded?.dataUrl || !attachable) return `${prompt}\n\nDOCUMENT CONTENT\n${document.content || document.summary}`
```
**Plus one guard in `importDocument`** (`server/state.mjs:534`): reject a `dataUrl` that is not a data URI —
```js
if (file.dataUrl && !String(file.dataUrl).startsWith('data:')) throw new UnreadableFileError('Upload a file, not a link.')
```
Today a client-supplied `type:'image/png'` plus an `http://` URL makes OpenAI fetch an arbitrary URL on the team's key via `server/state.mjs:129 image_url: uploaded.dataUrl`. **Effort S. Do this one.**

### 1.9 Validate against governance documents, and pick the right checklist

**Demanded by:** brief PROCESS 2 — "Compare with **templates, SOPs, guides** and checklist (10-20 points)."

The checklist half is real (`server/state.mjs:200-284`, 12-14 items). The templates/SOPs/guides half does not exist: the review prompt at `server/state.mjs:556` contains only `DOCUMENT …` and `CHECKLIST …`. The governance text is already in the workspace unused — `server/seed-content.mjs:180` holds SOP-VAL-004 "DOCUMENT REVIEW CHECKLIST — STANDARD OPERATING PROCEDURE … 4. REQUIRED CHECKS", a real SOP the reviewer never sees.

Separately, `server/state.mjs:524` `const checklistId = file.checklistId || 'CHK-GENERAL'` and `src/App.jsx:509` never sends one — so a judge's `URS.docx` is typed `DOCX` and checked against the generic 12-item list, not CHK-REQUIREMENTS.

**Change:** (a) before the prompt, select up to 2 approved governance documents by `/procedure|checklist|template|guideline|sop/i` and append them as `GOVERNANCE REFERENCES`, record `document.checkedAgainst`, and print one line beside the checklist picker (`src/App.jsx:93`): *"Checked against: Document Review Checklist SOP v5.2 + 12-point checklist."* That single line is what makes PROCESS 2 visible. (b) At `:524`, sniff the extracted text for `risk assessment` / `user requirement` / `standard operating procedure` and route through the existing `checklistIdForType`. **Effort M.**

### 1.10 Make the brief's own example sentences one click away, and stop drafts vanishing

**Demanded by:** brief INPUT "User Questions (Examples)" — *"Create a new Risk Assessment."*; OUTPUT 3 "Missing Section, Full Document Draft, Export to Word".

The routing works — `server/state.mjs:681-687` `DRAFT_INTENT` sends free text to `createDocument()` or `draftMissingSection()`; verified: `Create a new Risk Assessment.` → `DOC-NEW-007 | CHK-RISK | 12 checks | draft Awaiting review`. But `src/App.jsx:116` offers `['Is this ready?', 'What is missing?', 'Are any documents contradictory?', 'What should we fix first?']` — neither sentence the brief prints. And `document.generatedSections` (`server/state.mjs:643`) has zero readers in `src/`, while `document.content` stays `''`, so a created Risk Assessment is a blank shell that scores 0 on its next check.

**Change:**
- `src/App.jsx:116` → `['What is the approval date?', 'What is missing?', 'Draft Section 5 for me.', 'Create a new Risk Assessment.']`
- `src/App.jsx:93` — change the Draft-fix guard from `check.result === 'fail'` to `check.result !== 'pass'`, and render `selected.generatedSections` under the check list.
- `server/state.mjs:643` — also `document.content = state.draft.text` when `state.draft.full`.
- `server/word.mjs:11` — `draft.full ? sourceDocument.title : 'Suggested Document Content'`.
**Effort M.**

### 1.11 Print recommendations in the report PDF

**Demanded by:** brief OUTPUT 1 — "Score: 82%, **Issues Found, Recommendations**".

`grep -ni recommend server/report.mjs` → **no match**. The open-issues loop at `server/report.mjs:101` prints `${finding.detail}\nOwner: … | Status: …` only. `finding.recommendation` is populated everywhere and never referenced. Decoded a live `/api/inspection-pack` PDF: score, checks, summary, open issues, decisions, history — no recommendation text.

**Change:** append `Recommendation: ${finding.recommendation}` to the `report.mjs:101` string, and replace the fixed advance `pdf.y = y + 57` at `:102` with the measured `heightOfString` pattern already used at `:89` (three lines will clip). Also make `server/state.mjs:596` say something — `check.note` is in scope and per-item — instead of the constant `Update ${document.title} and run the check again.` **Effort S.**

### 1.12 Make Home read as the brief's dashboard

**Demanded by:** brief OUTPUT 4 — a table with columns Document | Score | Status.

`src/App.jsx:77` renders `state.documents.slice(0, 5)` as an unheaded list; `state.portfolioScore` is written at `server/state.mjs:417` and `:774` and **read nowhere** (zero hits in `src/`, zero in `test/`). `:774` also averages `null` scores as 0.

**Change:** replace the list with a `<table>` using the existing `.table-wrap` styles (`src/styles.css:116`), all documents not `.slice(0,5)`; add a fourth tile showing `scoreLabel(state.portfolioScore)` / "Workspace readiness"; and at `server/state.mjs:774` filter to assessed documents only. **Effort S.**

### 1.13 Small honesty and provenance repairs

| Change | File / line | Why |
|---|---|---|
| Drop the source fallback: `sources: response.data.found ? validSources : []` | `server/state.mjs:700` | Today `(validSources.length ? validSources : [document.id])` attributes an answer to the *currently selected* document when the model cites nothing valid. An evidence claim must never name a document the model did not cite. |
| Render the abstention flag | `src/App.jsx:117` | `answerSchema` carries `limitation` (`server/state.mjs:174-175`) and it is stored at `:700`. `grep limitation src/App.jsx` → nothing. The machine-checked "I have no evidence" signal is invisible. |
| Label unverified findings honestly | `src/App.jsx:102` | `verification` is set only for `generatedBy: 'workspace-review'`, so most issues a judge clicks render *nothing* where the "Independently verified" line sits. Print "Raised by the checklist run on X" / "Example issue from the sample workspace" instead of silence. |
| Show the denominator beside the score | `src/App.jsx:52`, `:93` | `50%` gives no hint it is 50% of 4 assessed items out of 12, and `—`/"Not assessed" reads as breakage rather than the deliberate guard at `server/state.mjs:114-115`. Render `"3 critical items not yet checked — run Check with AI"`. |
| Match the highlighted button to what Mira said | `src/App.jsx:319-324` | `guidanceRequested` is set from the transcript at `:290`, then `:323` highlights `actionsRef.current[0]` — always the first action, regardless of which button she named. Substring-match the response transcript against `action.label`, fall back to `[0]`. ~3 lines. Turns the demo's headline moment from coincidence into cause and effect. |
| Audit the Mira voice turns and the inbound WhatsApp questions | `server/state.mjs:711-722`, `server/index.mjs:136-148` | `recordMiraConversation` never calls `addEvent` and caps `state.copilot` at 16; the WhatsApp route calls `addEvent` not at all. Both are "questions", which `gxp-sentinel-solution.md:19` promises to record. Two one-line `addEvent` calls. |
| Join Import events to their document | `server/state.mjs:551` | Passes no `extra`, so every Import row has `document_id NULL`. The pattern exists at `:669` — `{ documentId: id }`. |
| Delete `scoreChecks` | `server/state.mjs:119-123` | Dead code: an unweighted duplicate of `readiness()`, defined and never called. A second scoring function that can drift. |
| Rebrand the audit-trail PDF | `server/report.mjs:137, 156, 196` | `Author: 'GxP Sentinel'`, header `'GxP SENTINEL'`, footer `'GxP Sentinel | Audit Trail'` — the document report already says `DOCUMENT CHECKER`. A judge downloading the trail gets a differently-branded artefact. |

### 1.14 Re-shoot the eight deck screenshots

**Demanded by:** the deck's own data-note at `:545` — "Show that the product is already running."

The embedded screenshots show a nine-item sidebar (Command Centre, Ask GxP Copilot, Audit Readiness, Evidence Graph, Changes & Incidents, Access Review, Action/Approval Centre, Assurance Lab, Trust Centre), a "LOCAL / OFFLINE" chip, "Local AI ready / External APIs disabled", and IDs `INC-P1-0221 / DOC-OM-019 / ACC-REV-2026-017`. The build has six views (`src/App.jsx:12`), brands as "Document Checker" (`src/App.jsx:526`), and seeds `INC-PI-1021 / DOC-OAM-017 / ACC-REV-2026-Q2`. The window chrome reads `127.0.0.1 · GxP Sentinel Local Edition` (`:562`). The deck's own text panel at `:594-600` uses the *code's* IDs — the same page contradicts its own images.

**Change:** `scripts/verify-ui.mjs` already drives puppeteer over every screen. Point its output at a committed `docs/figures/`, add sweeps for `?view=trail` (the chain-verified banner is the best screenshot in the build) and `?view=safety`, re-embed. **Effort M. Highest-value hour in the project** — one judge asking "is that your build?" ends the run regardless of the code.

---

## 2. FIX THE WORDING

Exact replacement strings. These are not worth building.

**Deck `:383`, `:400`, `:418`, `:580`, `:683`, `:695`, and the `demoData` string at `:825` — "0 cloud APIs" / "Local inference + data + audit trail" / "0 cloud model APIs at runtime" / "local/offline operation" / "Local-first" / "Inference, database and documents remain local".**
`server/openai.mjs:1` posts to `https://api.openai.com/v1/responses`; `server/realtime.mjs` posts to the OpenAI Realtime API; `src/App.jsx:526` renders "OpenAI is not connected" with no key. No llama.cpp/gguf/ollama anywhere.
> **"Server-side API key, never in the browser. Documents stay in local SQLite until a user explicitly runs an AI action. `store:false` — the provider retains nothing (`server/openai.mjs:28`). Deployable against Azure OpenAI or any OpenAI-compatible endpoint."**

Do not build local inference: the brief image explicitly lists "Llama / Mistral / OpenAI" as acceptable, and going local kills Mira's realtime voice.

**Deck `:398`, `:540`, `:579`, `:683` — "9 / 9 local safety controls".**
There are seven: `server/state.mjs:403-412` defines S1–S7. `grep "9/9\|safety control" src/ server/` → nothing. The deck's own Assurance Lab slide lists seven cards and says "Seven reversible synthetic scenarios" — it contradicts itself two screens apart.
> **"7 of 7 live adversarial tests pass — each one is a real model call whose prompt, response, model id and verdict are written to the hash-chained audit trail."**

Stronger than a static badge: a judge can watch it run, then see the row appear in the trail.

**Deck `:552-558` — the seven demo-step names.** None of the seven strings exists in `src/` or `server/`. Roughly three map to shipped features (Assurance Lab → Safety tests, Human Approval → Issues decision box, Grounded Copilot → Mira), two map partially, one is backend-only (Evidence Graph), one is absent (Audit Readiness).
> **01 Home — upload and Review all documents · 02 Documents — checklist, RULE/AI per-check provenance, Draft fix, PDF · 03 Issues — verified issues, evidence, owner, human approval · 04 Mira — typed and live-voice Q&A with sources and confidence · 05 Audit trail — append-only SHA-256 chain, verbatim prompts, PDF · 06 Safety tests — seven live adversarial tests · 07 WhatsApp — evidence over Twilio, approvals refused.**

Update the `demoData` array to match. Cheap partial alternative: rename the nav labels at `src/App.jsx:12` to "Assurance Lab" and "Trust Centre" and the deck stops lying for free.

**Deck `:486` — "2 · A0 orchestrates — Selects only the agents needed" with an A1–A7+C1 strip.** There is no dispatcher. `server/state.mjs:682-693` builds one fixed list of seven roles and sends all of them, every time, in one call.
> **"One call runs seven bounded review roles over the whole workspace. A second, independent pass re-checks every proposed issue against the same evidence and deletes the ones its own first pass could not support (`server/state.mjs:740-762`). Rejected issues are kept and shown, not hidden."**

A self-retracting reviewer is a better slide than a routing diagram, and unlike the routing diagram it is true and tested.

**Deck `:535` — card 06 "Prompt-injection scanning, bounded budgets, audit events and a SHA-256 hash chain".** No input-side scanner exists; `documentInput`/`workspaceInput` pass text and data URLs straight through. No turn limit, no specialist cap, no circuit breaker — the only bound in the tree is `AbortSignal.timeout(45000)` at `server/openai.mjs:40`.
> **"Traceable assurance — every model call is bounded by a 45-second timeout and written to an append-only SHA-256 hash chain with its verbatim prompt and response. Document content is passed as untrusted data, and live test S1 proves an embedded 'ignore all rules' instruction is not followed."**

Drop the budgets panel when the Trust Centre screenshot goes.

**Deck `:534` — card 05 "Least privilege, server-trusted payloads and human approval".** Two of three clauses hold. "Server-trusted payloads" is real — `/api/action/prepare` accepts only a `findingId` and `prepareAction` builds the whole action server-side; `updateFinding` clamps to 80/40 chars and allowlists status. `grep "tools\|tool_choice\|function_call" server/*.mjs` → no matches, so the AI has zero action privileges. The gap is user identity: `server/index.mjs:107` takes `request.body.actor || 'Demo Quality Approver'` and `src/App.jsx:102` hardcodes `actor: 'Anita Nair'`.
> **"Action gateway — no AI output becomes a task without a human decision. Proposals sit at 'Awaiting approval'; approval records the actor, timestamp and decision note into the hash-chained trail. The model has no tools and no function-calling loop — every call is schema-constrained. Enterprise identity and proposer/approver separation are M2 work."**

**Deck `:532` — card 03 "SQLite search, metadata filters and local file ingestion".** File ingestion is true (`server/extract.mjs`, 118 lines, zero dependencies). "Search" exists but is client-side title substring at `src/App.jsx:92` and never touches SQLite. "Metadata filters" has no referent. `server/persistence.mjs` stores the workspace as one JSON blob; the only SELECTs are `WHERE id = 1` and full-table reads.
> **"No chunking, no embeddings, no vector store. The whole workspace goes into one context window, which is what makes cross-document contradictions visible at all — a chunked retriever would never surface 'DOC-A says approved, DOC-B says pending'. SQLite is the persistence and append-only audit store, not the retriever. Local ingestion covers MD, TXT, CSV, JSON, DOCX and XLSX with no dependency; PDFs and images go to the model directly."**

Do not build FAISS/Chroma. The brief lists them as available tools, not requirements.

**Deck `:594` — readiness score "46" with "Not ready for simulated inspection" and "8 open deterministic findings".** Seed is `portfolioScore: 78` (`server/state.mjs:417`), 5 findings, 1 critical. "1 critical" is correct. The full phrase does not exist in the code — though `Not ready` *is* a real status (`server/state.mjs:114`) shown on 4 of 7 documents at seed.
> Run the demo once and put the number the app actually shows — or drop the numeral: **"The score is computed over assessed checks only, with a criticality gate: a failed or unassessed critical item withholds a Ready verdict."** The gate is a better story than any single number and it is covered by a passing test.

**Deck `:699`, `:728` — sources cite "GxP Sentinel Visual User Manual v1.0".** No such document exists in the repo. It is cited as the authority for precisely the five claims that are false.
> **"1. GBS Hackathon 2026 problem statement (the brief). 2. The running build — README.md and the repository; every number in this deck was read off it. 3. The append-only audit trail exported from `/api/audit-trail.pdf`."**

**Product name — four names for one product.** Deck title and brand "GxP Sentinel"; `src/App.jsx:526` "Document Checker"; `server/index.mjs:164` logs "Document Checker running at…"; `package.json:2` `"gxp-sentinel-live"`; `README.md:1` and `gxp-sentinel-solution.md:1` "# Document Checker"; `server/report.mjs:41` stamps "DOCUMENT CHECKER" but `:137/:156/:196` stamp "GxP Sentinel". **Pick one and apply it in six places.** "GxP Sentinel" is the stronger name for a pharma panel and the deck is already built around it; renaming the app is one line per site. Whichever wins, the sidebar in the live demo must read the same word as the slide behind it.

**`README.md:38` — "sent to OpenAI only when you request AI analysis."** Not accurate. With a key set, `src/App.jsx:409-416` auto-starts Mira's greeting the first time Home loads, and `server/realtime.mjs:42-72` POSTs `miraInstructions(state, view)` — which embeds every document's title, owner, status, score, summary, every check label and note, up to 5000 characters of each document's content, and every issue's detail — to `api.openai.com/v1/realtime/calls`. `src/App.jsx:277-279` re-sends the same context on every state revision and view change.
> **"Documents and workspace state are stored locally in SQLite. Document text is sent to OpenAI when you run a check, ask a question, draft a section or run a safety test — and when Mira's voice session opens, which happens automatically the first time you open Home."**

Do not disable the proactive greeting; commit `221452c` shipped it deliberately.

**`README.md:38` — "Word document".** `server/extract.mjs:100-104` rejects legacy `.doc`/`.xls` with a 400. Append: **"Word and spreadsheet files must be .docx or .xlsx; save legacy .doc or .xls as .docx, .xlsx or PDF first."** (The accept list at `src/App.jsx:526` is already correct — `.doc` was removed in the working tree.)

**`gxp-sentinel-solution.md:39-45` — the screens table lists five, the build ships six.** Add the row:
> `| Audit trail | Inspect the append-only, hash-chained record of every AI prompt and response, and download it as a PDF. |`

**`gxp-sentinel-solution.md:12` — "Read its text, tables and basic details."** Until 1.1/1.7 land:
> **"Read its text, embedded images and basic details (version, owner, approval and effective dates)."**

**`README.md:26-36` — nine steps, ten capabilities.** Add:
> **"10. Ask Mira to create a missing document, such as a risk assessment, and it is added to your workspace as a draft for review."**

---

## 3. ALREADY TRUE

Say these out loud. Each was executed or traced end to end.

**`npm test` → 19 pass, 0 fail (203ms). `npm run build` → 16 modules, `dist/assets/index-Ff3jWzrJ.js` 227.83 kB, 136ms.** Both reproduce.

**The completion score is calculated, rendered in three places, recalculated, and unit-tested.** `readiness()` at `server/state.mjs:106-118` weights critical items 3x (`CRITICAL` regex at `:103`), counts only assessed items, and gates readiness on a failed critical item. Rendered at `src/App.jsx:14`, `:52`, `:93`, and in the PDF at `server/report.mjs:63-66`. Verified by hand on a live PDF export: DOC-OAM-017 = owner(pass,w1) + recovery(fail,w1) + escalation(pass,w1) + approval(fail,w3) = 2/6 = **33%**, and the PDF reads "Equipment Maintenance Procedure / 33% / Complete / STATUS Not ready". Works end to end for `.docx`, `.xlsx`, `.txt`, `.md`, `.csv`, `.json` and all seeds. Six of nine accepted formats.

**The deterministic-rule / AI-verdict split with visible provenance.** `server/state.mjs:571-575` sets `source: 'rule'` or `'ai'` per check; `src/App.jsx:93` renders a `RULE`/`AI` badge on every row. Date arithmetic is pure code, never the model.

**Honest abstention.** `server/state.mjs:57-59` — "A rule may only assert what it actually inspected" — and `:114-115` — "A percentage next to unassessed critical items reads as a pass. Withhold it." Both behaviours are pinned by passing tests (`test/state.test.mjs:298-307`).

**Append-only SHA-256 hash-chained audit trail.** `server/persistence.mjs:17-48` creates `workspace` / `audit_events` / `uploaded_files` in `node:sqlite`. Uploads, checks, drafts, draft decisions, questions and approvals all reach it via `addEvent` → `appendAuditEvent`. I re-ran `verifyAuditChain`'s algorithm over the shipped `data/document-checker.db`: **verified: true, count: 189**. It survives restart and survives `resetState` (`server/state.mjs:829-837` never touches `audit_events`). The in-memory `state.events` cap of 40 (`server/state.mjs:465`) is a view, not the store. Full UI at `src/App.jsx:125-161` with a PDF export.

**Issues: evidence → owner → human approval.** Walked live with no API key: `POST /api/finding/update` set FND-001's owner; `POST /api/action/prepare` created `ACTION-…` at status `Awaiting approval`; `POST /api/action/approve` returned `Approved`, `approvedBy: 'Anita Nair'`, and moved the finding to `In progress`. **This is the safest demo opener — it works without a key or a network.**

**PDF report download.** `GET /api/inspection-pack` → HTTP 200, `application/pdf`, `attachment; filename="document-check-report.pdf"`, 7,333 bytes, `%PDF-1.3`. Scoped to `state.selectedDocumentId` plus its findings and actions.

**Judges can swap the checklist and re-run.** `addChecklist` (`server/state.mjs:506`) and `applyChecklist` (`:488`); `test/state.test.mjs:23-37` adds a 3-item checklist, applies it, asserts the swap, restores and asserts checks and score return identical. `scripts/verify-ui.mjs:32-39` does the same in a real browser. This is a hackathon guideline the brief names explicitly and it is fully satisfied.

**Encrypted files are refused with a specific sentence, not mishandled.** `server/extract.mjs:100-108` detects a CFB container and a PDF `/Encrypt` dictionary and throws `UnreadableFileError` (400) → `"This PDF is password-protected and cannot be read. Upload an unprotected copy."` Covered at `test/state.test.mjs:331-337`. **Do not build decryption.** A stated boundary reads better than a guess.

**Mira's voice loop.** `server/realtime.mjs:59` sets `server_vad`, threshold 0.5, `silence_duration_ms: 650`, `create_response: true`. `src/App.jsx:283-286` calls `releaseMicrophone()` on `input_audio_buffer.speech_stopped`, genuinely stopping the tracks so the browser's own mic indicator clears; `:319` releases again on `response.done`. Click cycle traced idle → connecting → listening → thinking → speaking → ready → click → listening. Spoken turns join the typed thread via `recordMiraConversation` → `broadcast()` → SSE. *Run one live turn with the key set before the demo — that is the only way to prove it.*

**Draft generation requires and records a human decision.** Status starts `Awaiting review` (`server/state.mjs:635`); only `decideDraft` changes it; approval is the only path into the document; the decision is audited. Word export verified: 8,756 bytes, extracting to "Suggested Document Content / New Risk assessment | Full risk assessment draft / Review status: Awaiting review". Test at `test/state.test.mjs:112-124`.

**Two-pass workspace review with a retraction ledger.** Seven roles run, then a **second independent model pass** marks each proposed issue supported/unsupported and drops the rest, filtered again against real document IDs (`server/state.mjs:740-762`). `proposed / retained / rejected` is rendered on Home with a "Show rejected" toggle. **This is the strongest thing in the build and the deck buries it under a routing diagram.**

**Grounded answers with refusal.** `answerSchema` (`server/state.mjs:174`) makes `confidence` a required integer 0–100 under strict `json_schema`; `found: false` forces `confidence: null` and `sources: []`. Tested at `test/state.test.mjs:64-75`.

**Twilio inbound with real signature verification.** `POST /api/whatsapp` with `Body=STATUS` returned valid TwiML live. `server/twilio.mjs` implements HMAC-SHA1 over sorted params + URL with `crypto.timingSafeEqual`; `server/index.mjs:145` returns 403 on mismatch. `APPROVE` is refused: *"Approval is not accepted through WhatsApp. Review the document in the web app."*

**Seven live safety tests.** `server/state.mjs:403-412` (S1 hidden instructions → S7 permanent rule); `runAssuranceScenario` at `:834-853` fires a real model call per scenario and writes the verbatim prompt and response to the audit chain. Dedicated nav view, click-verified at `scripts/verify-ui.mjs:86-91`. "Reversible" holds literally — the function mutates only `scenario.result` plus an append-only event.

**Real seed documents of real length.** `server/seed-content.mjs`: URS-042 400 words, RISK-PSE-009 376, DOC-OAM-017 399, SOP-VAL-004 358, ACC-REV-2026-Q2 359, INC-PI-1021 377 — counted, not estimated. The model reads the full body text, not summaries.

**8 MB upload holds.** An 8 MB file becomes an 11,184,924-byte JSON body and `POST /api/document/import` returns 200 under the `12mb` limit at `server/index.mjs:48`; the client guards at `src/App.jsx:504`.

---

## 4. KEEP AND PROMOTE

Working capabilities the sources undersell or never mention. One sentence each — add it verbatim.

**Hash-chained audit trail.** Never claimed in `gxp-sentinel-solution.md`, and it is the strongest GxP artefact in the repo.
> *"Every AI prompt and response is written verbatim to an append-only SQLite table, each row hashed over its predecessor. The chain is re-verified on every load — 189 events in the shipped database, verified true — and exports as a PDF. Delete a row and the banner turns red."*

Add it to the Prototype boundary at `gxp-sentinel-solution.md:49` and open the Audit trail screen during the demo.

**Retraction ledger.** The deck never mentions it.
> *"The reviewer retracts its own findings. A second independent pass re-checks every proposed issue against the same evidence and drops the unsupported ones — proposed, retained and rejected are all shown, and the rejected ones are kept on screen rather than hidden."*

**RULE / AI provenance.** Never mentioned in any source document.
> *"Date arithmetic — approval age, effective-date ordering, periodic review — is deterministic code, not the model, and every check row is badged RULE or AI so a reviewer knows which verdicts a model produced. A rule that inspected nothing returns 'not assessed', never 'absent'."*

This is the answer to "how do I know the AI didn't make this up", and it is currently a badge nobody explains.

**Criticality gate and withheld score.** Reads as breakage; it is the honesty story the deck wants.
> *"Critical items — approval, signature, effective date, test evidence — weigh 3x, and a failed or unassessed critical item withholds the percentage entirely. A number beside an unchecked approval reads as a pass, so the product refuses to print one."*

**Mira, the realtime voice host.** `gxp-sentinel-solution.md:31-32` covers it well; the deck does not mention it at all.
> *"A live voice host answers questions about the workspace, releases the microphone the moment you stop speaking, and highlights the exact on-screen control she recommends. Her transcript joins the same conversation thread as typed questions."*

**WhatsApp with a refusal.** The refusal is the interesting half and nobody says it.
> *"Ask for a document's status, evidence, owner or open issues over WhatsApp and get a signed-webhook answer. Ask it to approve something and it refuses — approvals only happen in the app, where the decision is recorded to the audit chain."*

**Zero-dependency OOXML extraction.** 118 lines, `node:zlib` only, and no source document mentions it.
> *"Word and Excel files are parsed in-process with no third-party parser — no supply-chain surface for the one component that touches untrusted customer files."*

**No tools, no agent loop.** The strongest safety claim available and it is nowhere in the deck.
> *"The model has no function-calling loop and no tools. Every call is a schema-constrained request whose output is validated server-side; it cannot take an action, only propose one."*

**Word export with review status stamped in.** `server/word.mjs` writes "Review status: Awaiting review" into the file itself.
> *"An exported draft carries its review status inside the document, so an unapproved draft that leaves the app still says so."*

---

## 5. MEASUREMENT

The deck slide headed **Evaluation** (`GxP_Sentinel_Interactive_Hackathon_Showcase.html:540`) contains no measured number. `ls bench` → does not exist; `scripts/` holds only `verify-ui.mjs`; npm scripts are `dev build start test verify:ui`. `grep -rniE "benchmark|gold.set|accuracy|precision|recall|ground.truth"` over `.mjs`/`.jsx`/`.json` → zero hits in code. The team's own research file (`novo-nordisk-gbs-hackathon-2026-research.md:124`) records that rival teams reported extraction accuracy, processing speed and cost. This build reports none.

### Two things it already records and throws away

- `document.lastReview = { model, responseId, durationMs }` at `server/state.mjs:583` — never read by `src/` or `server/report.mjs`.
- `usage` — `grep -rn usage server/ src/ scripts/ test/` returns **exactly one hit**, `server/openai.mjs:54 usage: data.usage || null`, returned by every AI call and discarded by every caller.

**One production edit:** `server/state.mjs:583` → `document.lastReview = { model: response.model, responseId: response.responseId, durationMs: Date.now() - started, usage: response.usage }`. `openai.mjs` already hands it to that exact call site.

### `scripts/benchmark.mjs` — ~90 lines, no new dependencies

```js
process.env.NODE_TEST_CONTEXT = '1'   // MUST be line 1
const { resetState, importDocument, reviewDocument, reviewWorkspace, answerQuestion, getState }
  = await import('../server/state.mjs')   // DYNAMIC import — static imports hoist above the assignment
```

That env var flips `server/persistence.mjs:10 testMode` and `:16` to `:memory:` sqlite, so the benchmark cannot pollute `data/document-checker.db` or the hash chain. Verified: `resetState` + `importDocument` ran clean and the db's mtime never moved.

Per gold entry, per pass (`BENCH_PASSES` default 3): `resetState()`; read the file; `.txt`/`.md` → `excerpt: text`, else `dataUrl: 'data:<mime>;base64,' + buf.toString('base64')`; `importDocument({name, size, type, excerpt|dataUrl, checklistId})` — it already accepts `file.checklistId` at `server/state.mjs:524`; take `getState().selectedDocumentId` (set at `:550`); `await reviewDocument(id)`; read `document.checks` and `document.lastReview`. **Join labels lowercased, exactly as `reviewDocument` does at `server/state.mjs:570.**

Count TP (expected fail, got fail), FN (expected fail, got pass = **missed gap**), FP, TN, and **abstained** (`unknown` — counted separately, never scored right or wrong). Bucket every row by `check.source` (`'rule'`/`'ai'`) and by file format. Emit a markdown table to stdout plus `bench/results.json` with raw per-check rows so the number is auditable.

### The seven metrics, split by what they need

**No ground truth required — runnable today on the six seed documents, about an hour:**

| Metric | Source | The claim it earns |
|---|---|---|
| **Verdict repeatability across 3 passes, split by `source`** | `check.result` per pass | The strongest number this repo can produce. `deterministicChecks` (`server/state.mjs:51-95`) is pure date arithmetic and will be **100% identical**; the model rows will not. That is precisely the ICH Q9(R1) argument for why the rules carry the compliance decision. |
| **Median `durationMs`** | `document.lastReview.durationMs`; `workspaceReview.durationMs` (`server/state.mjs:776`) | Replaces the invented "10 min" hero stat at deck `:399`. |
| **Tokens and cost per review** | the newly-kept `usage` | Print the rate beside the number. |
| **Verifier rejection rate** | `workspaceReview.proposed` vs `.retained` (`server/state.mjs:776`) | One `reviewWorkspace()` call, no labels. "The reviewer retracted N of M of its own findings." |
| **Score availability by format** | `document.score != null` | "Documents that produced a score after one AI check: N/6 seed, N/8 held-out." Turns the em-dash from a hole into a demonstration of abstention. |

**Ground truth required — `bench/gold.json`, an afternoon:**

| Metric | Formula | The claim |
|---|---|---|
| **Gap recall** | TP/(TP+FN) | "How often does it miss a real gap" — the only question a QA judge asks. Headline. |
| **False-flag rate** | FP/(FP+TN) | Adoption cost. A tool that cries wolf gets switched off. |
| **Abstention rate** | abstained / total | The honesty control. Makes a bounded recall read as bounded rather than blind. |

### `bench/gold.json`

Eight documents **nobody on the team wrote** — public WHO TRS annex SOPs, an ICH Q9(R1) or Q10 PDF, an FDA warning letter, a published GMP SOP template, an ISO procedure, a university lab access-review template. At least one per checklist id (the six at `server/state.mjs:201-289`), plus one `.docx` and one `.pdf` to exercise `server/extract.mjs`, plus one unreadable file to prove the abstention path.

```json
{"file": "bench/docs/who-trs986-annex2.txt", "checklistId": "CHK-PROCEDURE", "split": "held-out",
 "source": "WHO TRS 986 Annex 2, public", "labelledBy": ["SS","AK"],
 "disputed": ["Periodic review date is stated and has not passed"],
 "expected": {"Document owner is named": "pass", "Approval and effective date are present": "fail"}}
```

Three rules that keep it cheap and defensible:
1. `expected` keys are **verbatim** checklist labels from `server/state.mjs:201-289` — `reviewDocument` joins on lowercased label at `:570`.
2. The vocabulary is only `"pass"` and `"fail"`. **Never label `"unknown"** — a returned `unknown` is an abstention, counted separately and scored neither right nor wrong. That removes the whole argument about what unknown means.
3. Partial labelling. 8–12 cells per document, not all 14. Eight documents / ~80 labelled cells is an afternoon, not a week.

Two people label independently; disagreements go in `disputed`, which yields an inter-rater agreement number for free and is itself a defence.

**Report the authored split (6 docs / 24 curated checks) and the held-out split separately, and label both on the slide.** The team wrote both the seed text *and* its verdicts — grading the model on those is grading your own exam, and it is the single most likely question to end the measurement beat. A judge who sees you disclose the split stops hunting for the flaw. Keep the authored split as a regression tripwire for prompt edits; never quote it as the headline.

### Fourth section: answer calibration

`bench/questions.json`, 20–30 questions over the seed plus held-out documents, each with a one-line expected answer and a boolean `answerable` — about a third deliberately unanswerable from the document (ask a procedure for a batch number). Call `answerQuestion(q, 'document')` after selecting the document; bucket the returned `confidence` into 50–69 / 70–89 / 90–100 and report observed correctness per bucket, plus the abstention rate on the unanswerable third (`found: false`, `confidence: null`).

Two claims fall out: *"when Mira says 90+, she is right N% of the time"* and *"on questions the document cannot answer, she abstains N% of the time."* The second is the one a GxP audience cares about, and the code already does the right thing — it is just unmeasured.

### Wiring

- `package.json` scripts → `"bench": "node scripts/benchmark.mjs"`, listed in the README **Verify** block. *"`npm run bench` regenerates every number on that slide and it is in the repo you have"* is worth more than the table itself, and it only lands if the command is where a judge skimming the README will find it.
- `--checklist=CHK-XXX` override, ~4 lines. The brief's guideline says judges may hand over their own checklist; this turns that from a feature you satisfy into a number you can regenerate on stage.
- Loop S1–S7 through `runAssuranceScenario` and print `7/7 scenarios contained` with each model response id. That line replaces the invented 9/9.
- Wrap `scripts/verify-ui.mjs`'s existing steps with `performance.now()` and print a per-step table next to the `console.log` at `:99`. It already visits every screen the "10-minute journey" claims — six added lines and no new file. Quote the measured total or drop the stat.
- Business-case calculator (deck `:672`, "183 illustrative expert hours"): keep the disclosure, replace one input with a measured number. Feed the benchmark's median `durationMs` into "Guided review effort"; get "Current effort" by timing three people reviewing one held-out document manually against the same checklist and taking the median. One hour, no code. Then show the arithmetic on the slide. A small honest number with its inputs visible survives cross-examination; 183 with four invented inputs does not, and the disclaimer only half-protects it.