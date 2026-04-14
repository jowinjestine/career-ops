# Modo: auto-apply — Automated Application Submission

Fills out job application forms via Playwright and submits them after user confirmation. This is the final step after evaluation + PDF generation.

## Prerequisites

Before auto-apply can run for a given offer:
1. **Report exists** in `reports/` with score >= threshold (default 4.0, configurable in `config/profile.yml` under `auto_apply.min_score`)
2. **PDF exists** in `output/` (tailored CV for this role)
3. **Draft answers exist** in Section H of the report (or will be generated on the fly)
4. **Profile configured** in `config/profile.yml` with candidate details

## Workflow

```
1. RESOLVE    → Find report + PDF + draft answers for this offer
2. NAVIGATE   → Open the application form in Playwright
3. DETECT     → Identify ATS platform and form structure
4. MAP        → Map form fields to profile data + draft answers
5. FILL       → Fill all fields programmatically
6. UPLOAD     → Upload resume PDF
7. SCREENSHOT → Take snapshot, show user what was filled
8. CONFIRM    → STOP and wait for user approval
9. SUBMIT     → Click submit only after explicit "yes"
10. UPDATE    → Update tracker status to "Applied"
```

## Step 1 — Resolve Context

1. **Find the report**: Match by company + role in `reports/` or by report number
2. **Find the PDF**: Match in `output/` by company slug
3. **Load draft answers**: Section H of the report. If missing, generate on the fly using `modes/auto-pipeline.md` Step 4 logic
4. **Load profile**: `config/profile.yml` for standard fields (name, email, phone, LinkedIn, etc.)

If no report exists, abort and suggest running the auto-pipeline first.

## Step 2 — Navigate to Application Form

1. Extract the application URL from the report header (`**URL:**` field)
2. `browser_navigate` to the URL
3. `browser_snapshot` to read the page
4. Look for "Apply" / "Apply Now" / "Submit Application" / "Solicitar" button
5. Click it to open the application form
6. `browser_snapshot` again to read the form

**If the form requires authentication (LinkedIn, Workday login):**
- Inform the user: "This form requires login. Please log in manually, then tell me to continue."
- Wait for user to confirm they're logged in
- `browser_snapshot` to read the form after login

## Step 3 — Detect ATS Platform

Identify the platform from URL patterns and page structure:

| Platform | URL Pattern | Form Characteristics |
|----------|-------------|---------------------|
| **Greenhouse** | `boards.greenhouse.io`, `grnh.se` | Multi-page form, file upload, custom questions section |
| **Lever** | `jobs.lever.co` | Single-page form, resume upload, custom fields at bottom |
| **Ashby** | `jobs.ashbyhq.com` | React SPA, file upload, custom questions |
| **Workday** | `*.myworkdayjobs.com` | Multi-step wizard, complex dropdowns, requires account |
| **BambooHR** | `*.bamboohr.com` | Simple form, file upload |
| **Wellfound** | `wellfound.com` | Profile-based, may pre-fill from account |
| **Custom** | Any other | Generic form detection via field labels |

**Platform detection order:**
1. Check URL against known patterns above
2. Check page content for platform identifiers (e.g., "Powered by Greenhouse")
3. Fall back to generic form detection

## Step 4 — Map Form Fields

Take a `browser_snapshot` and classify every form field:

### Standard Fields (from profile.yml)

| Form Label Pattern | Source | Value |
|-------------------|--------|-------|
| First Name / Nombre | `candidate.full_name` (split) | First word |
| Last Name / Apellido | `candidate.full_name` (split) | Rest |
| Email | `candidate.email` | Direct |
| Phone | `candidate.phone` | Direct |
| LinkedIn | `candidate.linkedin` | Direct, prefix https:// if needed |
| Portfolio / Website | `candidate.portfolio_url` | Direct |
| GitHub | `candidate.github` | Direct, prefix https:// if needed |
| Location / City | `candidate.location` | Direct |
| Current Company | From `cv.md` | Most recent employer |
| Current Title | From `cv.md` | Most recent title |

### Resume/CV Upload

| Field Type | Action |
|-----------|--------|
| File input (`<input type="file">`) | Upload the generated PDF from `output/` |
| "Paste resume" text area | Paste content from `cv.md` |
| URL field for resume | Use `candidate.portfolio_url` if applicable |

### Common Dropdowns

| Field | Strategy |
|-------|----------|
| How did you hear about us? | Select "Job Board" or "Company Website" or type the source from report |
| Work authorization | Match from `config/profile.yml` `location.visa_status` |
| Willing to relocate | Match from `config/profile.yml` `compensation.location_flexibility` |
| Years of experience | Calculate from `cv.md` work history |
| Highest education | From `cv.md` education section |
| Salary expectation | From `config/profile.yml` `compensation.target_range` — use the midpoint |
| Start date | "Immediately" or "2 weeks notice" (configurable in profile.yml) |
| Gender / Race / Veteran / Disability | **SKIP** — never auto-fill EEO/demographic fields. Leave blank or select "Prefer not to say" / "Decline to self-identify" |

### Custom Questions (from Section H draft answers)

For each custom text question in the form:
1. Match against Section H draft answers by question similarity
2. If match found → use the draft answer
3. If no match → generate a new answer using the report context + `modes/auto-pipeline.md` Step 4 tone rules
4. **Character limits**: If the form field has a character limit, truncate the answer to fit

### Cover Letter

If the form has a cover letter field:
1. Check if a cover letter was generated in the report
2. If not, generate one using the report's Block B (CV match) + Block E (personalization plan)
3. Keep it to 3-4 paragraphs, using the "I'm choosing you" tone from `auto-pipeline.md`

## Step 5 — Fill the Form

Execute field filling in order:

### For Playwright-based filling:

```
For each field:
  1. browser_snapshot → identify the field's ref/selector
  2. Click the field to focus it
  3. Type or select the value
  4. Tab to next field
```

**Platform-specific patterns:**

### Greenhouse
1. Standard fields are on page 1 (name, email, phone, resume upload)
2. Custom questions are on page 2 or below the fold
3. Look for "Submit Application" at the bottom
4. Resume upload: find `<input type="file">` near "Resume/CV" label

### Lever
1. Single page form
2. Resume upload at the top
3. Standard fields (name, email, phone, LinkedIn, website)
4. Custom questions below
5. "Submit application" button at bottom

### Ashby
1. React-based — fields may load dynamically
2. After clicking "Apply", wait for form to render
3. Fill fields top to bottom
4. File upload via drag-and-drop or file input

### Workday
1. **Multi-step wizard** — handle page by page
2. May require creating an account first → **STOP and inform user**
3. Source tracking page → fill and click Next
4. Personal info page → fill from profile
5. Resume upload page → upload PDF
6. Custom questions page → fill from Section H
7. Review page → take snapshot for user review

### Generic Forms
1. Scan all `<input>`, `<select>`, `<textarea>` elements
2. Match by label text, placeholder, or name attribute
3. Fill matching fields from profile + draft answers
4. Skip any unrecognized fields and report them to the user

## Step 6 — Upload Resume

1. Find the file upload field (look for `<input type="file">` or drag-and-drop zone)
2. Resolve the PDF path: `output/cv-{candidate}-{company}-{date}.pdf` (most recent)
3. Upload using `browser_file_upload` with the file input ref
4. Wait for upload confirmation (progress bar, filename displayed, checkmark)
5. If upload fails, try alternative methods:
   - Direct file input click
   - Drag-and-drop simulation
   - Report failure to user

## Step 7 — Pre-submission Review

**This is the critical human-in-the-loop checkpoint.**

1. `browser_snapshot` the completed form
2. Present a summary to the user:

```
## Application Ready — [Company] | [Role]

Report: #NNN | Score: X.X/5
PDF: cv-{name}-{company}-{date}.pdf

### Fields Filled:
| Field | Value |
|-------|-------|
| Name | Jane Smith |
| Email | jane@example.com |
| Resume | cv-jane-smith-acme-2026-04-14.pdf ✅ |
| Why this role? | [first 50 chars]... |
| ... | ... |

### Skipped Fields:
- EEO demographics (never auto-filled)
- [Any unrecognized fields]

### ⚠️ Review Required:
- [Any fields where the answer was generated (not from drafts)]
- [Any fields where character limit was hit]

→ Should I submit this application? (yes/no/edit)
```

3. **WAIT for explicit user approval**
   - "yes" / "submit" / "go" → proceed to Step 8
   - "no" / "cancel" → abort, leave form filled but not submitted
   - "edit [field]" → let user specify changes, re-fill that field, re-show summary

## Step 8 — Submit

1. Find the submit button: "Submit Application" / "Apply" / "Send" / "Enviar"
2. `browser_click` the submit button
3. Wait for confirmation page (success message, redirect)
4. `browser_snapshot` the confirmation page
5. If submission fails (error message visible):
   - Report the error to the user
   - `browser_snapshot` to show what went wrong
   - Suggest fixes

## Step 9 — Post-submission Update

After successful submission:

1. **Update tracker**: Set status to `Applied` in `data/applications.md`
   - Find the existing row by company + role
   - Update status from `Evaluated` to `Applied`
   - Add note: `Auto-applied {date}`

2. **Update report**: Add submission confirmation to Section H
   ```
   ### Submission Confirmation
   - **Submitted:** {YYYY-MM-DD HH:MM}
   - **Platform:** {ATS name}
   - **Confirmation:** {any confirmation number or message}
   ```

3. **Suggest next steps**:
   ```
   ✅ Application submitted to [Company] for [Role]

   Next steps:
   → /career-ops contacto — Find and message a hiring manager on LinkedIn
   → /career-ops followup — Set up follow-up cadence
   ```

## Batch Auto-Apply

When processing multiple offers (from pipeline), auto-apply can run in sequence:

1. Sort offers by score (highest first)
2. For each offer with score >= threshold:
   a. Run auto-apply Steps 1-7
   b. Show summary and **ask for confirmation for EACH application individually**
   c. If confirmed → submit
   d. If rejected → skip, move to next
3. Show final summary of all submissions

**NEVER batch-submit without individual confirmation.** Each application gets its own review.

## Error Recovery

| Scenario | Action |
|----------|--------|
| Form not found at URL | Try clicking "Apply" button variations, check for redirects |
| CAPTCHA detected | **STOP** — inform user, cannot bypass CAPTCHA |
| Login required | **STOP** — inform user to log in manually |
| File upload fails | Try alternative upload method, or inform user |
| Form validation error | Read error messages, fix fields, re-attempt |
| Network timeout | Retry once, then inform user |
| Unexpected page layout | `browser_snapshot`, show user, ask for guidance |

## Configuration (config/profile.yml)

```yaml
auto_apply:
  min_score: 4.0              # Minimum score to auto-apply (default 4.0)
  require_confirmation: true   # Always ask before submitting (STRONGLY recommended)
  skip_eeo: true              # Never fill demographic/EEO fields (default true)
  cover_letter: true          # Generate cover letter if form has field (default true)
  start_date: "2 weeks"       # Default answer for "when can you start"
  salary_strategy: "midpoint" # How to answer salary questions: midpoint, minimum, range, skip
  max_per_session: 5          # Maximum applications per session (prevent spray-and-pray)
  cooldown_minutes: 2         # Wait between submissions to avoid rate limiting
```

## Safety Rails

1. **max_per_session**: Hard cap on applications per session. After hitting the limit, refuse to apply more and suggest the user reviews their pipeline.
2. **Score threshold**: Never auto-apply to offers below `min_score`. If the user insists, require them to explicitly override.
3. **EEO fields**: Never auto-fill. Always skip or select "Decline to self-identify."
4. **Confirmation required**: Even if `require_confirmation: false` is set, ALWAYS confirm on the first application of a session. This catches misconfiguration.
5. **CAPTCHA/Login**: Never attempt to bypass. Stop and inform the user.
6. **Rate limiting**: Wait `cooldown_minutes` between submissions to avoid being flagged.
