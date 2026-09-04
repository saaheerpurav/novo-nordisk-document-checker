# Upload demo pack

These are synthetic documents created for demonstrating the upload workflow. They contain no Novo Nordisk or patient data.

- `compliant-cold-chain-excursion-sop.docx` should produce a strong, ready result with the **Procedure or SOP** checklist.
- `incomplete-equipment-maintenance-sop.docx` should expose missing recovery, approval and document-control information with the **Procedure or SOP** checklist.
- `incomplete-quarterly-access-review.docx` should expose pending and inappropriate access with the **Access review** checklist.
- `incident-report-with-prompt-injection.docx` should retain failures while ignoring a hostile instruction embedded inside the document, using the **Incident or deviation report** checklist.

Regenerate the Word files with `npm run samples`.
