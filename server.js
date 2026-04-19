#!/usr/bin/env node
/**
 * server.js - Express server for the HK Job Matcher platform.
 */

import express from "express";
import multer from "multer";
import axios from "axios";
import { parse as csvParse } from "csv-parse/sync";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { config } from "dotenv";
import { translate } from "./translate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

config({ path: path.join(__dirname, ".env") });

const TOKEN = process.env.token;
const PORT = 3000;
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const ENG_CSV = path.join(__dirname, "listings", "english_jobs.csv");
const CANTO_CSV = path.join(__dirname, "listings", "canto_jobs.csv");

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[HTTP] ${new Date().toISOString()}  ${req.method} ${req.path}`);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pdf" || ext === ".txt") return cb(null, true);
    cb(new Error("Only .pdf and .txt files are allowed."));
  },
});

// ─── DeepSeek helper ──────────────────────────────────────────────────────────
let _dsCallCount = 0;

async function callDeepSeek(prompt, label = "general") {
  const callId = ++_dsCallCount;
  const ts = () => new Date().toISOString();

  console.log("\n" + "─".repeat(60));
  console.log(`[DeepSeek ↑ #${callId}] ${ts()}  label="${label}"`);
  console.log(`[DeepSeek ↑ #${callId}] model=${MODEL}  max_tokens=1000  temperature=0.1`);
  console.log(`[DeepSeek ↑ #${callId}] prompt (${prompt.length} chars):`);
  console.log(prompt);
  console.log("─".repeat(60));

  const start = Date.now();
  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1000,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    const elapsed = Date.now() - start;
    const content = response.data.choices[0].message.content.trim();
    const usage = response.data.usage || {};

    console.log(`[DeepSeek ↓ #${callId}] ${ts()}  elapsed=${elapsed}ms`);
    console.log(`[DeepSeek ↓ #${callId}] tokens: prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`);
    console.log(`[DeepSeek ↓ #${callId}] response (${content.length} chars):`);
    console.log(content);
    console.log("─".repeat(60) + "\n");

    return content;
  } catch (e) {
    const elapsed = Date.now() - start;
    console.error(`[DeepSeek ✗ #${callId}] ${ts()}  elapsed=${elapsed}ms  error: ${e.message}`);
    if (e.response) {
      console.error(`[DeepSeek ✗ #${callId}] HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`);
    }
    console.log("─".repeat(60) + "\n");
    return "";
  }
}

// ─── CV text extraction ───────────────────────────────────────────────────────
async function extractText(buffer, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
  }
  return buffer.toString("utf-8");
}

// ─── Language extraction via DeepSeek ────────────────────────────────────────
async function extractLanguagesFromCV(cvText) {
  const prompt = `You are a CV language analyzer. Read the CV text below and extract what languages the candidate knows.

Return ONLY valid JSON — no markdown, no explanation:
{"languages": [{"name": "English", "level": "Fluent"}, {"name": "Mandarin", "level": "Intermediate"}]}

Only include languages from: English, Mandarin, Cantonese
Valid levels: Fluent, Intermediate, Basic
Only include languages that are actually mentioned in the CV.

CV:
${cvText.slice(0, 3000)}

JSON:`;

  const raw = await callDeepSeek(prompt, "extract-languages");
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.languages)) return parsed.languages;
    }
  } catch {
    console.error("Failed to parse language JSON:", raw);
  }
  return [];
}

// ─── Job matching ─────────────────────────────────────────────────────────────
function countCsvRows(csvPath) {
  if (!fs.existsSync(csvPath)) return 0;
  try {
    const content = fs.readFileSync(csvPath, "utf-8");
    return csvParse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }).length;
  } catch {
    return 0;
  }
}

function readJobs() {
  if (!fs.existsSync(ENG_CSV)) return [];
  const content = fs.readFileSync(ENG_CSV, "utf-8");
  return csvParse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

const LANG_KEYWORDS = {
  english: ["english"],
  mandarin: ["mandarin", "putonghua", "普通話"],
  cantonese: ["cantonese", "廣東話", "粵語"],
};

function fieldContainsLang(text, lang) {
  const t = text.toLowerCase();
  return LANG_KEYWORDS[lang].some((kw) => t.includes(kw.toLowerCase()));
}

function matchJobs(jobs, userLanguages) {
  const userLangs = userLanguages.map((l) => (l.name || l).toLowerCase());

  const results = jobs.map((job) => {
    const badge = parseInt(job.badge, 10);
    const langField = job.languages_required_english || "";

    if (badge === 0 || fieldContainsLang(langField, "cantonese")) {
      return { ...job, score: 0, reason: "Cantonese required" };
    }

    const required = [];
    if (fieldContainsLang(langField, "english")) required.push("english");
    if (fieldContainsLang(langField, "mandarin")) required.push("mandarin");

    if (required.length === 0) {
      return { ...job, score: 100, reason: "No specific language requirement" };
    }

    const matched = required.filter((l) => userLangs.includes(l));
    const missing = required.filter((l) => !userLangs.includes(l));
    const missingLabel = missing
      .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
      .join(", ");

    if (matched.length === required.length) {
      return { ...job, score: 100, reason: "All required languages matched" };
    }
    if (matched.length > 0) {
      const score =
        userLangs.includes("english") &&
        !userLangs.includes("mandarin") &&
        required.includes("mandarin")
          ? 50
          : 70;
      return { ...job, score, reason: `Missing: ${missingLabel}` };
    }
    return { ...job, score: 0, reason: `Missing required: ${missingLabel}` };
  });

  return results.sort((a, b) => b.score - a.score);
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(score) {
  if (score === 100) return "#22c55e";
  if (score >= 70) return "#f59e0b";
  if (score >= 50) return "#f97316";
  return "#ef4444";
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4f8;color:#1e293b;min-height:100vh}
a{color:inherit;text-decoration:none}

/* ── Header ── */
header{background:linear-gradient(135deg,#0f2444 0%,#1d4ed8 100%);color:#fff;padding:0;margin-bottom:0}
.header-inner{max-width:1100px;margin:0 auto;padding:1.2rem 2rem;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:.75rem}
.logo-icon{font-size:2rem;line-height:1}
.logo-text h1{font-size:1.3rem;font-weight:800;letter-spacing:-.02em;color:#fff}
.logo-text p{font-size:.78rem;color:#93c5fd;margin-top:.1rem}
.header-badge{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#e0f2fe;font-size:.72rem;padding:.3rem .75rem;border-radius:20px;font-weight:500}

/* ── Hero ── */
.hero{background:linear-gradient(135deg,#0f2444 0%,#1d4ed8 100%);padding:3.5rem 2rem 5rem;text-align:center;position:relative;overflow:hidden}
.hero::after{content:'';position:absolute;bottom:-2px;left:0;right:0;height:60px;background:#f0f4f8;clip-path:ellipse(55% 100% at 50% 100%)}
.hero h2{font-size:2rem;font-weight:800;color:#fff;margin-bottom:.75rem;letter-spacing:-.03em}
.hero p{color:#bfdbfe;font-size:1rem;max-width:500px;margin:0 auto 2rem;line-height:1.6}
.stats-row{display:flex;justify-content:center;gap:2.5rem;margin-top:1rem}
.stat{color:#fff;text-align:center}
.stat-num{font-size:1.8rem;font-weight:800;display:block;line-height:1}
.stat-lbl{font-size:.75rem;color:#93c5fd;margin-top:.25rem}

/* ── Container ── */
.container{max-width:1100px;margin:0 auto;padding:0 2rem 4rem}

/* ── Action cards on home ── */
.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:-2.5rem;margin-bottom:2rem}
@media(max-width:680px){.action-grid{grid-template-columns:1fr}}
.action-card{background:#fff;border-radius:16px;padding:2rem;box-shadow:0 4px 20px rgba(0,0,0,.08);border:1px solid #e2e8f0;transition:box-shadow .2s,transform .2s;display:flex;flex-direction:column}
.action-card:hover{box-shadow:0 8px 32px rgba(0,0,0,.12);transform:translateY(-2px)}
.action-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;margin-bottom:1.25rem}
.action-icon.blue{background:#dbeafe}
.action-icon.green{background:#dcfce7}
.action-card h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem;color:#1e293b}
.action-card p{font-size:.875rem;color:#64748b;line-height:1.6;flex:1;margin-bottom:1.5rem}

/* ── Generic card ── */
.card{background:#fff;border-radius:16px;padding:2rem;margin-bottom:1.5rem;box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #e2e8f0}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;gap:.75rem}
.card-title{font-size:1.05rem;font-weight:700;color:#1e293b}

/* ── Forms ── */
.form-group{margin-bottom:1.5rem}
.form-group label{display:block;font-size:.85rem;font-weight:600;margin-bottom:.5rem;color:#374151}
.file-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;padding:2rem;border:2px dashed #cbd5e1;border-radius:12px;background:#f8fafc;cursor:pointer;transition:border-color .2s,background .2s;text-align:center}
.file-drop:hover,.file-drop:focus-within{border-color:#3b82f6;background:#eff6ff}
.file-drop input[type=file]{position:absolute;opacity:0;width:0;height:0}
.file-drop-icon{font-size:2rem;margin-bottom:.5rem}
.file-drop-text{font-size:.875rem;color:#64748b}
.file-drop-text strong{color:#3b82f6}
.file-name{margin-top:.5rem;font-size:.8rem;color:#1d4ed8;font-weight:600;display:none}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;padding:.6rem 1.4rem;border-radius:10px;font-size:.875rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:all .15s;white-space:nowrap;position:relative}
.btn:disabled{opacity:.6;cursor:not-allowed}
.btn-primary{background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;box-shadow:0 2px 8px rgba(37,99,235,.3)}
.btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#1e40af,#1d4ed8);box-shadow:0 4px 12px rgba(37,99,235,.4)}
.btn-success{background:linear-gradient(135deg,#15803d,#16a34a);color:#fff;box-shadow:0 2px 8px rgba(22,163,74,.3)}
.btn-success:hover:not(:disabled){background:linear-gradient(135deg,#166534,#15803d)}
.btn-ghost{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
.btn-ghost:hover{background:#e2e8f0}
.btn-full{width:100%}
.spinner{width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:none}
@keyframes spin{to{transform:rotate(360deg)}}
.btn.loading .spinner{display:block}
.btn.loading .btn-label{opacity:.7}

/* ── Flash banner ── */
.flash{border-radius:10px;padding:.9rem 1.25rem;margin-bottom:1.5rem;font-size:.875rem;font-weight:500;display:flex;align-items:center;gap:.6rem}
.flash.success{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.flash.error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.flash.info{background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe}

/* ── Language pills ── */
.lang-row{display:flex;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem}
.lang-pill{display:flex;align-items:center;gap:.5rem;padding:.55rem 1.1rem;border:2px solid #e2e8f0;border-radius:999px;background:#f8fafc;cursor:pointer;transition:all .15s;user-select:none}
.lang-pill:has(input:checked){border-color:#3b82f6;background:#eff6ff;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.lang-pill input{width:15px;height:15px;cursor:pointer;accent-color:#3b82f6}
.lang-name{font-weight:600;font-size:.875rem}
.level-tag{font-size:.72rem;background:#dbeafe;color:#1d4ed8;padding:.15rem .55rem;border-radius:999px;font-weight:600}

/* ── Actions row ── */
.actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}

/* ── Results table ── */
.job-count{font-size:.82rem;color:#94a3b8;margin-left:.35rem;font-weight:500}
.filter-label{display:flex;align-items:center;gap:.4rem;font-size:.82rem;color:#64748b;cursor:pointer;user-select:none;background:#f8fafc;border:1px solid #e2e8f0;padding:.4rem .85rem;border-radius:8px}
.filter-label input{accent-color:#3b82f6;width:14px;height:14px}
.table-wrap{overflow-x:auto;border-radius:10px;border:1px solid #f1f5f9}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{padding:.75rem 1rem;text-align:left;background:#f8fafc;border-bottom:2px solid #e9eef5;font-weight:600;color:#64748b;white-space:nowrap;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
td{padding:.75rem 1rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafbff}
td a{color:#1d4ed8;font-weight:600}
td a:hover{text-decoration:underline}
.badge-ok{background:#dcfce7;color:#15803d;padding:.2rem .65rem;border-radius:999px;font-size:.74rem;font-weight:700;white-space:nowrap}
.badge-no{background:#fee2e2;color:#b91c1c;padding:.2rem .65rem;border-radius:999px;font-size:.74rem;font-weight:700}
.score-cell{display:flex;align-items:center;gap:.6rem;min-width:130px}
.bar{flex:1;height:6px;background:#e2e8f0;border-radius:999px;overflow:hidden}
.bar-fill{height:100%;border-radius:999px;transition:width .4s}
.score-num{font-weight:700;font-size:.8rem;min-width:34px;text-align:right}
.reason{color:#94a3b8;font-size:.8rem}

/* ── Update progress overlay ── */
.overlay{display:none;position:fixed;inset:0;background:rgba(15,36,68,.7);backdrop-filter:blur(4px);z-index:50;align-items:center;justify-content:center}
.overlay.show{display:flex}
.overlay-box{background:#fff;border-radius:20px;padding:2.5rem 3rem;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);max-width:340px;width:90%}
.overlay-spinner{width:48px;height:48px;border:4px solid #e2e8f0;border-top-color:#1d4ed8;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1.25rem}
.overlay-box h3{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
.overlay-box p{font-size:.85rem;color:#64748b;line-height:1.5}

/* ── Error page ── */
.center-card{max-width:480px;margin:3rem auto;text-align:center}
.center-card .err-icon{font-size:3rem;margin-bottom:1rem}
.center-card h2{font-size:1.3rem;margin-bottom:.75rem}
.center-card p{color:#64748b;margin-bottom:1.5rem;font-size:.9rem}

@media(max-width:640px){
  .hero h2{font-size:1.5rem}
  .stats-row{gap:1.5rem}
  .card-header{flex-direction:column;align-items:flex-start}
}
`;

function shell(title, body, extraHead = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
${extraHead}
</head>
<body>
<header>
  <div class="header-inner">
    <div class="logo">
      <span class="logo-icon">🇭🇰</span>
      <div class="logo-text">
        <h1><a href="/">HK Job Matcher</a></h1>
        <p>Powered by DeepSeek AI</p>
      </div>
    </div>
    <span class="header-badge">Non-Chinese Speaker Platform</span>
  </div>
</header>
<main>${body}</main>
</body>
</html>`;
}

function homePage(flash = null) {
  const cantoCount = countCsvRows(CANTO_CSV);
  const engCount = countCsvRows(ENG_CSV);
  const suitableCount = (() => {
    if (!fs.existsSync(ENG_CSV)) return 0;
    try {
      const jobs = readJobs();
      return jobs.filter((j) => parseInt(j.badge, 10) === 1).length;
    } catch { return 0; }
  })();

  const flashHtml = flash
    ? `<div class="flash ${flash.type}"><span>${flash.icon}</span> ${esc(flash.msg)}</div>`
    : "";

  return shell(
    "HK Job Matcher",
    `<div class="hero">
  <h2>Find Hong Kong Jobs — No Cantonese Required</h2>
  <p>Upload your CV and let AI match you with roles that fit your language skills. All listings are translated and verified.</p>
  <div class="stats-row">
    <div class="stat"><span class="stat-num">${cantoCount}</span><div class="stat-lbl">Raw Listings</div></div>
    <div class="stat"><span class="stat-num">${engCount}</span><div class="stat-lbl">Translated Jobs</div></div>
    <div class="stat"><span class="stat-num">${suitableCount}</span><div class="stat-lbl">Suitable for You</div></div>
  </div>
</div>

<div class="container">
  ${flashHtml}
  <div class="action-grid">

    <div class="action-card">
      <div class="action-icon blue">📄</div>
      <h3>Match My CV</h3>
      <p>Upload your CV as a PDF or text file. DeepSeek will extract your language skills and match you against all available listings instantly.</p>
      <form method="POST" action="/upload" enctype="multipart/form-data" onsubmit="handleUpload(this)">
        <div class="form-group">
          <div class="file-drop" onclick="this.querySelector('input').click()">
            <input type="file" name="cv" accept=".pdf,.txt" required onchange="showFileName(this)">
            <span class="file-drop-icon">📎</span>
            <div class="file-drop-text"><strong>Choose a file</strong> or drag &amp; drop</div>
            <div class="file-drop-text" style="margin-top:.25rem;font-size:.75rem">.pdf or .txt · max 10 MB</div>
            <div class="file-name" id="fileName"></div>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-full">
          <span class="spinner"></span>
          <span class="btn-label">Analyse &amp; Match Jobs →</span>
        </button>
      </form>
    </div>

    <div class="action-card">
      <div class="action-icon green">🔄</div>
      <h3>Update Job Listings</h3>
      <p>Sync the latest Cantonese job listings to English. DeepSeek translates each listing and detects whether Cantonese is required. This may take a while.</p>
      <p style="font-size:.78rem;color:#94a3b8;margin-top:-.75rem;margin-bottom:1.5rem">
        Last synced: <strong>${engCount} of ${cantoCount}</strong> listings translated
      </p>
      <form method="POST" action="/update-listings" onsubmit="handleUpdate(this)">
        <button type="submit" class="btn btn-success btn-full">
          <span class="spinner"></span>
          <span class="btn-label">🔄 Update Now</span>
        </button>
      </form>
    </div>

  </div>
</div>

<div class="overlay" id="overlay">
  <div class="overlay-box">
    <div class="overlay-spinner"></div>
    <h3 id="overlayTitle">Processing…</h3>
    <p id="overlayMsg">Please wait, this may take a moment.</p>
  </div>
</div>

<script>
function showFileName(input) {
  var el = document.getElementById('fileName');
  if (input.files && input.files[0]) {
    el.textContent = '✓ ' + input.files[0].name;
    el.style.display = 'block';
  }
}
function handleUpload(form) {
  var btn = form.querySelector('button[type=submit]');
  btn.classList.add('loading');
  btn.disabled = true;
  showOverlay('Analysing your CV…', 'DeepSeek is reading your CV and detecting language skills. Hang tight!');
}
function handleUpdate(form) {
  var btn = form.querySelector('button[type=submit]');
  btn.classList.add('loading');
  btn.disabled = true;
  showOverlay('Updating job listings…', 'DeepSeek is translating Cantonese listings and detecting language requirements. This may take several minutes.');
}
function showOverlay(title, msg) {
  document.getElementById('overlayTitle').textContent = title;
  document.getElementById('overlayMsg').textContent = msg;
  document.getElementById('overlay').classList.add('show');
}
</script>`
  );
}

function resultsPage(detectedLangs, matchedJobs, cvText) {
  const ALL_LANGS = ["English", "Mandarin", "Cantonese"];
  const detectedNames = detectedLangs.map((l) => l.name);

  const langPills = ALL_LANGS.map((lang) => {
    const checked = detectedNames.includes(lang) ? "checked" : "";
    const lvl = detectedLangs.find((l) => l.name === lang)?.level || "";
    return `<label class="lang-pill">
  <input type="checkbox" name="manual_languages" value="${lang}" ${checked}>
  <span class="lang-name">${lang}</span>
  ${lvl ? `<span class="level-tag">${esc(lvl)}</span>` : ""}
</label>`;
  }).join("\n");

  const rows = matchedJobs.map((job) => {
    const badge = parseInt(job.badge, 10);
    const badgeHtml =
      badge === 1
        ? `<span class="badge-ok">✓ Suitable</span>`
        : `<span class="badge-no">✗ Cantonese</span>`;
    const color = scoreColor(job.score);
    return `<tr data-score="${job.score}">
  <td><a href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">${esc(job.job_title_english)}</a></td>
  <td>${esc(job.company)}</td>
  <td>${badgeHtml}</td>
  <td>
    <div class="score-cell">
      <div class="bar"><div class="bar-fill" style="width:${job.score}%;background:${color}"></div></div>
      <span class="score-num" style="color:${color}">${job.score}%</span>
    </div>
  </td>
  <td class="reason">${esc(job.reason)}</td>
</tr>`;
  }).join("\n");

  const detectedSummary = detectedLangs.length
    ? detectedLangs.map((l) => `<strong>${esc(l.name)}</strong>${l.level ? ` (${esc(l.level)})` : ""}`).join(", ")
    : "<em>No languages detected — please select manually below</em>";

  return shell(
    "HK Job Matcher – Results",
    `<div class="hero" style="padding:2rem 2rem 4rem">
  <h2 style="font-size:1.5rem">Your Job Matches</h2>
  <p>AI detected: ${detectedSummary}</p>
</div>

<div class="container">

  <div class="card">
    <div class="card-header">
      <span class="card-title">🧠 Detected Languages</span>
      <a href="/" class="btn btn-ghost" style="font-size:.8rem">← Upload new CV</a>
    </div>
    <p style="font-size:.85rem;color:#64748b;margin-bottom:1.25rem">Adjust the selection and click <strong>Re-match</strong> to override AI detection.</p>
    <form method="POST" action="/rematch">
      <input type="hidden" name="cv_text" value="${esc(cvText)}">
      <div class="lang-row">${langPills}</div>
      <div class="actions">
        <button type="submit" class="btn btn-primary">↻ Re-match</button>
      </div>
    </form>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="card-title">💼 Job Matches <span class="job-count" id="jobCount">${matchedJobs.length} jobs</span></span>
      <label class="filter-label">
        <input type="checkbox" id="filterCheck" onchange="applyFilter(this.checked)">
        Suitable only (score &gt; 0)
      </label>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Company</th>
            <th>Status</th>
            <th>Match Score</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody id="jobTable">${rows}</tbody>
      </table>
    </div>
  </div>

</div>

<script>
function applyFilter(enabled) {
  var rows = document.querySelectorAll('#jobTable tr');
  var visible = 0;
  rows.forEach(function(r) {
    var hide = enabled && r.dataset.score === '0';
    r.style.display = hide ? 'none' : '';
    if (!hide) visible++;
  });
  document.getElementById('jobCount').textContent = visible + ' job' + (visible !== 1 ? 's' : '');
}
</script>`
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const { status, msg } = req.query;
  let flash = null;
  if (status === "updated") flash = { type: "success", icon: "✅", msg: msg || "Job listings updated successfully." };
  if (status === "no-change") flash = { type: "info", icon: "ℹ️", msg: "Listings are already up to date. No translation needed." };
  if (status === "error") flash = { type: "error", icon: "❌", msg: msg || "An error occurred while updating listings." };
  res.send(homePage(flash));
});

app.post("/upload", (req, res, next) => {
  upload.single("cv")(req, res, (err) => {
    if (err) return res.send(homePage({ type: "error", icon: "❌", msg: err.message }));
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.send(homePage({ type: "error", icon: "❌", msg: "No file received. Please select a file." }));

    const cvText = await extractText(req.file.buffer, req.file.originalname);
    if (!cvText.trim()) return res.send(homePage({ type: "error", icon: "❌", msg: "Could not extract text from the uploaded file." }));

    const detectedLangs = await extractLanguagesFromCV(cvText);
    const jobs = readJobs();
    const matched = matchJobs(jobs, detectedLangs);

    res.send(resultsPage(detectedLangs, matched, cvText));
  } catch (e) {
    console.error(e);
    res.status(500).send(shell("Error",
      `<div class="container"><div class="card center-card">
        <div class="err-icon">⚠️</div>
        <h2>Something went wrong</h2>
        <p>${esc(e.message)}</p>
        <a href="/" class="btn btn-primary">← Back to Home</a>
      </div></div>`
    ));
  }
});

app.post("/rematch", (req, res) => {
  try {
    const cvText = req.body.cv_text || "";
    const raw = req.body.manual_languages;
    const names = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const langs = names.map((n) => ({ name: n, level: "" }));

    const jobs = readJobs();
    const matched = matchJobs(jobs, langs);

    res.send(resultsPage(langs, matched, cvText));
  } catch (e) {
    console.error(e);
    res.status(500).send(shell("Error",
      `<div class="container"><div class="card center-card">
        <div class="err-icon">⚠️</div>
        <h2>Something went wrong</h2>
        <p>${esc(e.message)}</p>
        <a href="/" class="btn btn-primary">← Back to Home</a>
      </div></div>`
    ));
  }
});

app.post("/update-listings", async (req, res) => {
  if (!TOKEN) {
    return res.redirect("/?status=error&msg=" + encodeURIComponent("No DeepSeek token configured in .env"));
  }
  console.log("\n[Update] Starting job listing translation...");
  try {
    const beforeCount = countCsvRows(ENG_CSV);
    await translate(TOKEN);
    const afterCount = countCsvRows(ENG_CSV);

    if (beforeCount === afterCount) {
      console.log("[Update] No changes needed.");
      return res.redirect("/?status=no-change");
    }
    console.log(`[Update] Done. ${afterCount} listings now translated.`);
    res.redirect("/?status=updated&msg=" + encodeURIComponent(`Listings updated: ${afterCount} jobs now available.`));
  } catch (e) {
    console.error("[Update] Error:", e.message);
    res.redirect("/?status=error&msg=" + encodeURIComponent(e.message));
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Server running → http://localhost:${PORT}`);
  if (!TOKEN) console.warn("⚠  No DeepSeek token found in .env — AI features will not work.");
  console.log(`   Cantonese listings : ${countCsvRows(CANTO_CSV)}`);
  console.log(`   Translated listings: ${countCsvRows(ENG_CSV)}\n`);
});
