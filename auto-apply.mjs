#!/usr/bin/env node

/**
 * auto-apply.mjs — ATS Direct Application Submitter
 *
 * For ATS platforms with public application APIs (Greenhouse, Lever, Ashby),
 * submit applications programmatically without browser automation.
 *
 * For platforms without APIs, outputs a structured JSON manifest that
 * the Claude agent uses with Playwright to fill forms.
 *
 * Usage:
 *   node auto-apply.mjs --report 042 --pdf output/cv-jane-acme-2026-04-14.pdf [--dry-run]
 *   node auto-apply.mjs --url https://boards.greenhouse.io/acme/jobs/123 --pdf output/cv.pdf
 *   node auto-apply.mjs --manifest 042   # Generate form-fill manifest for Playwright
 *
 * Requires: config/profile.yml, report in reports/, PDF in output/
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import yaml from 'js-yaml';

const PROFILE_PATH = 'config/profile.yml';
const REPORTS_DIR = 'reports';
const OUTPUT_DIR = 'output';
const APPLICATIONS_PATH = 'data/applications.md';

mkdirSync('batch', { recursive: true });

// ── Profile loader ─────────────────────────────────────────────────

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) {
    throw new Error('config/profile.yml not found. Run onboarding first.');
  }
  return yaml.load(readFileSync(PROFILE_PATH, 'utf-8'));
}

// ── Report loader ──────────────────────────────────────────────────

function findReport(reportNum) {
  if (!existsSync(REPORTS_DIR)) throw new Error(`${REPORTS_DIR}/ not found`);
  const files = readdirSync(REPORTS_DIR);
  const padded = String(reportNum).padStart(3, '0');
  const match = files.find(f => f.startsWith(padded + '-'));
  if (!match) throw new Error(`Report #${reportNum} not found in ${REPORTS_DIR}/`);
  return readFileSync(resolve(REPORTS_DIR, match), 'utf-8');
}

function extractReportMeta(reportContent) {
  const meta = {};

  const urlMatch = reportContent.match(/\*\*URL:\*\*\s*(https?:\/\/\S+)/);
  meta.url = urlMatch ? urlMatch[1] : null;

  const scoreMatch = reportContent.match(/\*\*(?:Score|Global):\*\*\s*([\d.]+)\/5/);
  meta.score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

  const companyMatch = reportContent.match(/\*\*(?:Company|Empresa):\*\*\s*(.+)/);
  meta.company = companyMatch ? companyMatch[1].trim() : null;

  const roleMatch = reportContent.match(/\*\*(?:Role|Rol):\*\*\s*(.+)/);
  meta.role = roleMatch ? roleMatch[1].trim() : null;

  // Extract Section H draft answers
  const sectionH = reportContent.match(/## H\).*?\n([\s\S]*?)(?=\n## [A-Z]|\n---|\s*$)/);
  meta.draftAnswers = sectionH ? parseDraftAnswers(sectionH[1]) : [];

  return meta;
}

function parseDraftAnswers(sectionText) {
  const answers = [];
  const blocks = sectionText.split(/###\s+\d+\.\s+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split('\n');
    const question = lines[0].trim();
    const answer = lines
      .slice(1)
      .map(l => l.replace(/^>\s*/, ''))
      .join('\n')
      .trim();
    if (question && answer) {
      answers.push({ question, answer });
    }
  }
  return answers;
}

// ── ATS Detection ──────────────────────────────────────────────────

function detectATS(url) {
  if (!url) return { platform: 'unknown', canApiSubmit: false };

  if (url.includes('boards.greenhouse.io') || url.includes('grnh.se')) {
    const match = url.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
    if (match) {
      return {
        platform: 'greenhouse',
        canApiSubmit: true,
        company: match[1],
        jobId: match[2],
        apiUrl: `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs/${match[2]}`,
      };
    }
  }

  if (url.includes('jobs.lever.co')) {
    const match = url.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/);
    if (match) {
      return {
        platform: 'lever',
        canApiSubmit: true,
        company: match[1],
        jobId: match[2],
        apiUrl: `https://api.lever.co/v0/postings/${match[1]}/${match[2]}/apply`,
      };
    }
  }

  if (url.includes('jobs.ashbyhq.com')) {
    const match = url.match(/jobs\.ashbyhq\.com\/[^/]+\/([a-f0-9-]+)/);
    return {
      platform: 'ashby',
      canApiSubmit: true,
      jobPostingId: match ? match[1] : null,
      apiUrl: 'https://api.ashbyhq.com/posting-api/application-form',
    };
  }

  if (url.includes('myworkdayjobs.com')) {
    return { platform: 'workday', canApiSubmit: false };
  }
  if (url.includes('bamboohr.com')) {
    return { platform: 'bamboohr', canApiSubmit: false };
  }

  return { platform: 'unknown', canApiSubmit: false };
}

// ── Greenhouse API Submission ──────────────────────────────────────

async function submitGreenhouse(ats, profile, pdfPath, draftAnswers) {
  // Get job details and application questions
  const jobRes = await fetch(ats.apiUrl);
  if (!jobRes.ok) throw new Error(`Greenhouse job fetch failed: HTTP ${jobRes.status}`);
  const jobData = await jobRes.json();

  const formData = new FormData();

  const nameParts = profile.candidate.full_name.split(' ');
  formData.append('first_name', nameParts[0]);
  formData.append('last_name', nameParts.slice(1).join(' '));
  formData.append('email', profile.candidate.email);
  if (profile.candidate.phone) formData.append('phone', profile.candidate.phone);

  // Resume upload
  const pdfBuffer = await readFile(pdfPath);
  const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('resume', pdfBlob, basename(pdfPath));

  // Custom question answers
  if (jobData.questions) {
    for (const q of jobData.questions) {
      const label = q.label || q.description || '';
      const answer = matchDraftAnswer(label, draftAnswers, profile);
      if (answer) formData.append(`question_${q.id}`, answer);
    }
  }

  const submitUrl = `https://boards-api.greenhouse.io/v1/boards/${ats.company}/jobs/${ats.jobId}`;
  const res = await fetch(submitUrl, { method: 'POST', body: formData });
  return { success: res.ok, status: res.status, body: await res.text() };
}

// ── Lever API Submission ───────────────────────────────────────────

async function submitLever(ats, profile, pdfPath, draftAnswers) {
  const formData = new FormData();

  formData.append('name', profile.candidate.full_name);
  formData.append('email', profile.candidate.email);
  if (profile.candidate.phone) formData.append('phone', profile.candidate.phone);

  if (profile.candidate.linkedin) {
    const linkedin = profile.candidate.linkedin.startsWith('http')
      ? profile.candidate.linkedin : `https://${profile.candidate.linkedin}`;
    formData.append('urls[LinkedIn]', linkedin);
  }
  if (profile.candidate.portfolio_url) {
    formData.append('urls[Portfolio]', profile.candidate.portfolio_url);
  }
  if (profile.candidate.github) {
    const github = profile.candidate.github.startsWith('http')
      ? profile.candidate.github : `https://${profile.candidate.github}`;
    formData.append('urls[GitHub]', github);
  }

  const pdfBuffer = await readFile(pdfPath);
  const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('resume', pdfBlob, basename(pdfPath));

  const coverLetter = draftAnswers.find(a =>
    /cover letter|why.*role|why.*company|interested/i.test(a.question)
  );
  if (coverLetter) formData.append('comments', coverLetter.answer);

  const res = await fetch(ats.apiUrl, { method: 'POST', body: formData });
  return { success: res.ok, status: res.status, body: await res.text() };
}

// ── Ashby API Submission ───────────────────────────────────────────

async function submitAshby(ats, url, profile, pdfPath, draftAnswers) {
  const jobPostingId = ats.jobPostingId;
  if (!jobPostingId) throw new Error('Could not extract Ashby job ID from URL');

  // Get application form structure
  const formRes = await fetch('https://api.ashbyhq.com/posting-api/application-form', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobPostingId }),
  });
  if (!formRes.ok) throw new Error(`Ashby form fetch failed: HTTP ${formRes.status}`);
  const formSchema = await formRes.json();

  const appForm = {};

  for (const section of (formSchema.applicationForm?.sections || [])) {
    for (const field of (section.fields || [])) {
      const path = field.path;

      if (path === '_systemfield_name') {
        appForm[path] = profile.candidate.full_name;
      } else if (path === '_systemfield_email') {
        appForm[path] = profile.candidate.email;
      } else if (path === '_systemfield_phone') {
        appForm[path] = profile.candidate.phone || '';
      } else if (path === '_systemfield_resume') {
        const pdfBuffer = await readFile(pdfPath);
        appForm[path] = {
          filename: basename(pdfPath),
          mimeType: 'application/pdf',
          content: pdfBuffer.toString('base64'),
        };
      } else if (field.isRequired || field.required) {
        const answer = matchDraftAnswer(field.title || field.label, draftAnswers, profile);
        if (answer) appForm[path] = answer;
      }
    }
  }

  const res = await fetch('https://api.ashbyhq.com/posting-api/application-form/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobPostingId, applicationForm: appForm }),
  });
  return { success: res.ok, status: res.status, body: await res.text() };
}

// ── Answer matching ────────────────────────────────────────────────

function matchDraftAnswer(question, draftAnswers, profile) {
  if (!question) return null;
  const q = question.toLowerCase();

  // Direct match from Section H draft answers
  for (const da of draftAnswers) {
    const dq = da.question.toLowerCase();
    const qWords = q.split(/\s+/).filter(w => w.length > 3);
    const dWords = dq.split(/\s+/).filter(w => w.length > 3);
    const overlap = qWords.filter(w => dWords.some(d => d.includes(w) || w.includes(d)));
    if (overlap.length >= 2 || (qWords.length <= 3 && overlap.length >= 1)) {
      return da.answer;
    }
  }

  // Common field auto-answers
  if (/how did you hear|how did you find|source/i.test(q)) return 'Company career page';
  if (/linkedin/i.test(q) && !/why|what|how.*role/i.test(q)) {
    const u = profile.candidate.linkedin;
    return u?.startsWith('http') ? u : `https://${u}`;
  }
  if (/portfolio|website|personal.*url/i.test(q)) return profile.candidate.portfolio_url || '';
  if (/github/i.test(q)) {
    const g = profile.candidate.github;
    return g?.startsWith('http') ? g : `https://${g}`;
  }
  if (/salary|compensation|pay.*expect/i.test(q)) return profile.compensation?.target_range || '';
  if (/start.*date|when.*start|availability/i.test(q)) return profile.auto_apply?.start_date || '2 weeks notice';
  if (/visa|work.*auth|sponsor/i.test(q)) return profile.location?.visa_status || '';
  if (/relocat/i.test(q)) return profile.compensation?.location_flexibility || 'Open to discussion';

  return null;
}

// ── Manifest generator (for Playwright filling) ────────────────────

function generateManifest(profile, reportMeta, pdfPath, ats) {
  const nameParts = profile.candidate.full_name.split(' ');

  return {
    platform: ats.platform,
    url: reportMeta.url,
    canApiSubmit: ats.canApiSubmit,
    candidate: {
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' '),
      email: profile.candidate.email,
      phone: profile.candidate.phone || '',
      linkedin: profile.candidate.linkedin || '',
      portfolio: profile.candidate.portfolio_url || '',
      github: profile.candidate.github || '',
      location: profile.candidate.location || profile.location?.city || '',
    },
    resume: { path: resolve(pdfPath), filename: basename(pdfPath) },
    draftAnswers: reportMeta.draftAnswers,
    autoApplyConfig: profile.auto_apply || {},
    company: reportMeta.company,
    role: reportMeta.role,
    score: reportMeta.score,
  };
}

// ── Tracker updater ────────────────────────────────────────────────

function updateTrackerStatus(company, role) {
  if (!existsSync(APPLICATIONS_PATH)) return false;

  let text = readFileSync(APPLICATIONS_PATH, 'utf-8');
  const lines = text.split('\n');
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    const companyCell = cells[3] || '';
    const roleCell = cells[4] || '';

    if (
      companyCell.toLowerCase().includes(company.toLowerCase()) &&
      roleCell.toLowerCase().includes(role.toLowerCase())
    ) {
      // Update status cell
      for (let c = 5; c < cells.length; c++) {
        if (/evaluated|skip/i.test(cells[c])) {
          cells[c] = 'Applied';
          lines[i] = '| ' + cells.slice(1, -1).join(' | ') + ' |';
          updated = true;
          break;
        }
      }
      if (updated) break;
    }
  }

  if (updated) writeFileSync(APPLICATIONS_PATH, lines.join('\n'), 'utf-8');
  return updated;
}

// ── Find best PDF match ────────────────────────────────────────────

function findPdf(companyName) {
  if (!existsSync(OUTPUT_DIR)) return null;
  const files = readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.pdf'));
  const slug = (companyName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const match = files.filter(f => f.toLowerCase().includes(slug)).sort().pop();
  return match ? resolve(OUTPUT_DIR, match) : null;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const manifestOnly = args.some(a => a === '--manifest');
  const force = args.includes('--force');

  let reportNum = null;
  let url = null;
  let pdfPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && args[i + 1]) reportNum = args[++i];
    if (args[i] === '--url' && args[i + 1]) url = args[++i];
    if (args[i] === '--pdf' && args[i + 1]) pdfPath = args[++i];
    if (args[i] === '--manifest' && args[i + 1] && !args[i + 1].startsWith('-')) reportNum = args[++i];
  }

  if (!reportNum && !url) {
    console.error('Usage:');
    console.error('  node auto-apply.mjs --report NUM --pdf PATH [--dry-run]');
    console.error('  node auto-apply.mjs --url URL --pdf PATH [--dry-run]');
    console.error('  node auto-apply.mjs --manifest NUM');
    process.exit(1);
  }

  const profile = loadProfile();
  console.log(`Candidate: ${profile.candidate.full_name}`);

  let reportMeta = {};
  if (reportNum) {
    const content = findReport(reportNum);
    reportMeta = extractReportMeta(content);
    if (!url) url = reportMeta.url;
    console.log(`Report: #${reportNum} | ${reportMeta.company} | ${reportMeta.role} | ${reportMeta.score}/5`);
  }

  const minScore = profile.auto_apply?.min_score || 4.0;
  if (reportMeta.score && reportMeta.score < minScore && !force) {
    console.error(`Score ${reportMeta.score}/5 is below threshold ${minScore}. Use --force to override.`);
    process.exit(1);
  }

  if (!pdfPath) {
    pdfPath = findPdf(reportMeta.company);
    if (pdfPath) {
      console.log(`PDF: ${pdfPath}`);
    } else {
      console.error('No PDF found. Generate one first with /career-ops pdf');
      process.exit(1);
    }
  }

  const ats = detectATS(url);
  console.log(`Platform: ${ats.platform} | API submit: ${ats.canApiSubmit}`);

  // Manifest mode
  if (manifestOnly) {
    const manifest = generateManifest(profile, reportMeta, pdfPath, ats);
    const outFile = `batch/apply-manifest-${reportNum || 'url'}.json`;
    writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`\nManifest: ${outFile}`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // Dry run
  if (dryRun) {
    console.log('\n--- DRY RUN ---');
    console.log(`URL: ${url}`);
    console.log(`Platform: ${ats.platform} (API: ${ats.canApiSubmit})`);
    console.log(`Name: ${profile.candidate.full_name}`);
    console.log(`Email: ${profile.candidate.email}`);
    console.log(`PDF: ${pdfPath}`);
    console.log(`Draft answers: ${reportMeta.draftAnswers?.length || 0}`);
    if (reportMeta.draftAnswers?.length > 0) {
      console.log('\nDraft answers:');
      for (const da of reportMeta.draftAnswers) {
        console.log(`  Q: ${da.question}`);
        console.log(`  A: ${da.answer.slice(0, 80)}...`);
      }
    }
    return;
  }

  // API submission
  if (ats.canApiSubmit) {
    console.log(`\nSubmitting via ${ats.platform} API...`);
    let result;
    try {
      if (ats.platform === 'greenhouse') {
        result = await submitGreenhouse(ats, profile, pdfPath, reportMeta.draftAnswers || []);
      } else if (ats.platform === 'lever') {
        result = await submitLever(ats, profile, pdfPath, reportMeta.draftAnswers || []);
      } else if (ats.platform === 'ashby') {
        result = await submitAshby(ats, url, profile, pdfPath, reportMeta.draftAnswers || []);
      }

      if (result.success) {
        console.log(`\n✅ Application submitted via ${ats.platform} API`);
        if (reportMeta.company && reportMeta.role) {
          const updated = updateTrackerStatus(reportMeta.company, reportMeta.role);
          if (updated) console.log('Tracker: Evaluated → Applied');
        }
      } else {
        console.error(`\n❌ API submission failed: HTTP ${result.status}`);
        console.error(result.body);
        console.log('\nFallback: use Claude agent with Playwright');
        console.log(`  node auto-apply.mjs --manifest ${reportNum}`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`\n❌ ${err.message}`);
      console.log('\nFallback: use Claude agent with Playwright');
      console.log(`  node auto-apply.mjs --manifest ${reportNum}`);
      process.exit(1);
    }
  } else {
    console.log(`\n${ats.platform} requires Playwright for form filling.`);
    const manifest = generateManifest(profile, reportMeta, pdfPath, ats);
    const outFile = `batch/apply-manifest-${reportNum || 'url'}.json`;
    writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`Manifest written: ${outFile}`);
    console.log('\nUse the Claude agent to fill the form with Playwright:');
    console.log('  /career-ops auto-apply');
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
