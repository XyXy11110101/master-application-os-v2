# V2 implementation boundaries

The renderer owns presentation and unsaved drafts. It has no Node integration, runs sandboxed with context isolation, and receives a fixed set of typed methods from preload. IPC validates sender, frame and payload. External websites open in the system browser.

The main process owns workspace selection, SQLite transactions, revision checks, credential encryption, file dialogs, managed copies and backup/restore. API keys are stored outside workspaces, encrypted with Electron safeStorage (Windows DPAPI). A different Windows user or restored workspace must configure its own key.

The utility process owns cancellable website research and document parsing. It receives only the selected public project context for research, never applicant documents or background. Local document checks do not use a model. A worker can return drafts and check results; it cannot use renderer IPC to approve or submit an application.

## Durable domain

- Project identity is scoped to a cycle. Legacy identifiers only prevent duplicate imports.
- Requirements separate evidence support, necessity, personal applicability and progress.
- Evidence contains original quote, source URL, time, source hash, location and scope.
- A research run is a draft. Adoption checks revisions and explicitly selects candidate rows.
- Changed requirements invalidate matching check results by revision; the original files and progress remain.
- Materials have immutable copied versions. Each requirement selects one version independently.
- Recommendation contacts are shared, while outreach and receipt are per project.
- Prepared, submitted, confirmed and received facts are separate.
- Action suggestions derive from current requirements, dependencies and waiting dates in workspace timezone.

## Release checks

Automatic tests use temporary directories and fake network responses. Current source truth comes from official pages, not frozen regression fixtures. UI checks run the actual Electron application and use fictional data. A clean Windows installation and actual independent users remain separate sources of evidence.


## 0.2 target and editor state

Projects retain legacy `degree`/`cycle` verbatim and store degreeLevel, degreeName, entryYear and entryMonth independently. An abbreviation never determines academic level. SQLite schema 1 migrates to schema 2 only after a verified full backup; ambiguous legacy years remain null. Confirmation invalidates related requirement checks by revision, while progress, immutable files and original evidence remain. Once confirmed, a different level/intake needs a new project; copying only supplies identity fields. A subsequently filled degree name is allowed and requires scope review.

Research discovery, text selection, public model context, model cache and source-link cache are target-specific. Both resume and adoption check the recorded context. Source years must describe entry, not deadlines or page timestamps; seasons do not invent calendar months. Graduate policies are not undergraduate policies. Unknown intake fields remain explicit even when core facts can be adopted.

Renderer session drafts live only in memory, keyed by workspace and entity. They survive navigation and normal save failures, and provide an explicit discard action. Saved records remain authoritative; drafts are never adopted implicitly or written into backups. A narrowly typed boolean IPC controls the main-process normal-close prompt. API credentials in an unfinished form remain only in session memory; a successful save clears the input.
