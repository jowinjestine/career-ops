# ATS Form Patterns — Platform-Specific Selectors for Auto-Apply

Reference file for the Claude agent when filling application forms via Playwright.
Each ATS platform has different DOM structures, button labels, and field patterns.

## Greenhouse

**URL patterns:** `boards.greenhouse.io/{company}/jobs/{id}`, `grnh.se/{id}`

### Apply button
- Primary: `a[href*="apply"]`, `a.btn--apply`
- Text: "Apply for this job", "Apply Now"
- May redirect to a separate application page

### Form structure
- **Page 1**: Personal info (name, email, phone, resume upload)
- **Page 2+**: Custom questions (varies by company)
- Navigation: "Next" / "Continue" button between pages

### Field selectors
```
First Name:     input[name*="first_name"], #first_name
Last Name:      input[name*="last_name"], #last_name
Email:          input[name*="email"], input[type="email"]
Phone:          input[name*="phone"], input[type="tel"]
Resume upload:  input[type="file"][name*="resume"], input[type="file"]
LinkedIn:       input[name*="linkedin"], input[placeholder*="LinkedIn"]
Website:        input[name*="website"], input[placeholder*="portfolio"]
Cover letter:   textarea[name*="cover_letter"], #cover_letter
Location:       input[name*="location"]
How heard:      select[name*="source"], select[name*="how_did_you_hear"]
```

### Custom questions
- Wrapped in `div.field`, `div.custom-question`
- Label: `label` element or `div.label`
- Input: `textarea`, `input[type="text"]`, `select`
- Character counters may appear as `span.char-counter`

### Submit
- Button: `input[type="submit"]`, `button[type="submit"]`
- Text: "Submit Application", "Submit"
- May show confirmation page after submission

### EEO/Demographics
- Usually on a separate page or section
- Labels contain: "gender", "race", "veteran", "disability", "demographic"
- **Always select "Decline to self-identify" or leave blank**
- Select options: look for "Decline", "Prefer not to say", "I don't wish to answer"

---

## Lever

**URL patterns:** `jobs.lever.co/{company}/{job-id}`

### Apply button
- Primary: `a.postings-btn--apply`, `a[href*="apply"]`
- Text: "Apply for this job"
- Opens form on same page (scrolls down) or new page

### Form structure
- Single page form (no multi-step)
- Resume upload at top
- Standard fields in middle
- Custom questions at bottom

### Field selectors
```
Full Name:      input[name="name"]
Email:          input[name="email"]
Phone:          input[name="phone"]
Current Company: input[name="org"]
Resume upload:  input[type="file"][name="resume"]
LinkedIn:       input[name="urls[LinkedIn]"]
Portfolio:      input[name="urls[Portfolio]"]
GitHub:         input[name="urls[GitHub]"]
Twitter:        input[name="urls[Twitter]"]
Other URL:      input[name="urls[Other]"]
Comments:       textarea[name="comments"]
```

### Custom questions
- Wrapped in `div.application-question`
- Label: `label` element
- Input types: `textarea`, `input[type="text"]`, `select`, checkboxes
- Required fields have `required` attribute

### Submit
- Button: `button.postings-btn--submit`
- Text: "Submit application"
- Shows inline success message after submission

### EEO
- Separate section at bottom: "Equal Employment Opportunity"
- Dropdowns for gender, race, veteran status
- **Select "Decline to self-identify" for all**

---

## Ashby

**URL patterns:** `jobs.ashbyhq.com/{company}/{job-id}`

### Apply button
- React SPA — button may load dynamically
- Primary: `button` containing "Apply", `a` containing "Apply"
- Text: "Apply Now", "Apply for this role"
- Opens inline form or modal

### Form structure
- React-rendered — fields may mount asynchronously
- Wait for form elements to appear after clicking Apply
- Single page with sections

### Field selectors
```
Name:           input[name="name"], input[data-testid*="name"]
Email:          input[name="email"], input[type="email"]
Phone:          input[name="phone"], input[type="tel"]
Resume upload:  input[type="file"], drop zone div
LinkedIn:       input[name*="linkedin"], input[placeholder*="LinkedIn"]
Location:       input[name*="location"]
```

### Custom questions
- React components — use `browser_snapshot` to read labels
- May use custom input components (not standard HTML inputs)
- Click to focus, then type
- Dropdowns may be custom (not `<select>`) — click to open, then click option

### Submit
- Button: last `button` in the form
- Text: "Submit Application", "Apply"
- May show loading spinner, then redirect to confirmation

### File upload
- Often drag-and-drop zone
- May have a hidden `input[type="file"]` inside a styled div
- Use `browser_snapshot` to find the file input ref, then `browser_file_upload`

---

## Workday

**URL patterns:** `*.myworkdayjobs.com/*/job/*`

### Special notes
- **Multi-step wizard** — 3-5 pages
- **May require account creation** — STOP and inform user
- Complex JavaScript-driven UI
- Fields load asynchronously

### Step 1: Source tracking
- "How did you hear about this job?" — select "Job Board" or "Company Website"
- Click "Apply" or "Next"

### Step 2: Personal information
```
First Name:     input[data-automation-id*="firstName"]
Last Name:      input[data-automation-id*="lastName"]
Email:          input[data-automation-id*="email"]
Phone:          input[data-automation-id*="phone"]
Country:        select/dropdown with data-automation-id*="country"
Address:        input[data-automation-id*="address"]
```

### Step 3: Resume upload
- Upload section with `input[type="file"]` or drag-drop area
- May also have "Parse Resume" option
- "My Information is correct" checkbox after parsing

### Step 4: Questions
- Custom questions from employer
- May include education history, work history forms
- Complex nested forms for each past position

### Step 5: Review & Submit
- Summary page showing all entered data
- Checkbox: "I agree to the terms"
- Submit button

### Submit
- Button: `button[data-automation-id*="submit"]`
- Text: "Submit"
- Shows confirmation number after submission

---

## BambooHR

**URL patterns:** `*.bamboohr.com/careers/{id}`

### Apply button
- `a.apply-btn`, `button.apply-btn`
- Text: "Apply for This Job"

### Form structure
- Relatively simple single-page form
- Standard fields + resume upload + optional cover letter

### Field selectors
```
First Name:     input[name="firstName"]
Last Name:      input[name="lastName"]
Email:          input[name="email"]
Phone:          input[name="phone"]
Address:        input[name="address"]
City:           input[name="city"]
State:          select[name="state"]
Zip:            input[name="zip"]
Resume upload:  input[type="file"][name="resume"]
Cover letter:   textarea[name="coverLetter"]
LinkedIn:       input[name*="linkedin"]
Website:        input[name*="website"]
```

### Submit
- Button: `button[type="submit"]`, `input[type="submit"]`
- Text: "Submit Application"

---

## Generic / Unknown ATS

When the platform is not recognized:

### Discovery strategy
1. `browser_snapshot` → read all form elements
2. Identify the application form boundary (usually a `<form>` element)
3. Map fields by:
   - `<label>` text associated with each input
   - `placeholder` attribute
   - `name` or `id` attribute patterns
   - `aria-label` attribute
4. Classify each field using the label text

### Common label → field mapping
```
"First Name" / "Given Name"           → candidate.firstName
"Last Name" / "Family Name" / "Surname" → candidate.lastName
"Email" / "Email Address"              → candidate.email
"Phone" / "Phone Number" / "Mobile"    → candidate.phone
"LinkedIn"                             → candidate.linkedin
"Website" / "Portfolio" / "URL"        → candidate.portfolio
"GitHub"                               → candidate.github
"Resume" / "CV" / "Upload"            → resume file upload
"Cover Letter"                         → generated cover letter
"Current Company" / "Employer"         → from cv.md
"Current Title" / "Job Title"          → from cv.md
"Location" / "City"                    → candidate.location
```

### Dropdown handling
1. Click the dropdown to open it
2. `browser_snapshot` to read options
3. Select the best matching option
4. For "Other" → may reveal a text input, fill it

### Multi-page detection
- Look for "Next", "Continue", "Step X of Y" patterns
- After filling visible fields, click Next
- Repeat snapshot + fill cycle for each page

### Skip signals (do NOT fill)
- Fields with labels containing: "gender", "race", "ethnicity", "veteran", "disability", "demographic", "EEO", "optional survey"
- Fields clearly marked as internal/admin
- CAPTCHA elements — stop and inform user
