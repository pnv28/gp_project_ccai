#!/usr/bin/env node
/**
 * server.js - HK Job Matcher — retro terminal edition
 */

import express from "express";
import multer from "multer";
import axios from "axios";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import { EventEmitter } from "events";
import { randomBytes } from "crypto";
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

const genId = () => randomBytes(8).toString("hex");

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, _res, next) => {
  console.log(`[HTTP] ${new Date().toISOString()}  ${req.method} ${req.path}`);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".txt", ".docx"].includes(ext)) return cb(null, true);
    cb(new Error("Only .pdf, .txt, and .docx files are allowed."));
  },
});

// ─── Translation progress ──────────────────────────────────────────────────────
const progressEmitter = new EventEmitter();
let translationRunning = false;
let translationState = { running: false, completed: 0, total: 0, message: "", done: false, error: null };

function emitProgress(data) {
  Object.assign(translationState, data, { running: !data.done });
  progressEmitter.emit("update", translationState);
}

// ─── Upload job store (for SSE progress on CV upload) ────────────────────────
const uploadJobs = new Map(); // jobId → { emitter, result: null|html, error: null|str, done: bool }

// ─── Job cache ────────────────────────────────────────────────────────────────
let jobCache = null;

function getJobs() {
  if (jobCache) return jobCache;
  jobCache = readJobsFromDisk();
  console.log(`[Cache] Loaded ${jobCache.length} jobs into memory.`);
  return jobCache;
}

function invalidateJobCache() {
  jobCache = null;
  console.log("[Cache] Job cache invalidated.");
}

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
      { model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 1000, stream: false },
      { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, timeout: 60000 }
    );
    const elapsed = Date.now() - start;
    const content = response.data.choices[0].message.content.trim();
    const usage = response.data.usage || {};

    console.log(`[DeepSeek ↓ #${callId}] ${ts()}  elapsed=${elapsed}ms`);
    console.log(`[DeepSeek ↓ #${callId}] tokens: prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`);
    console.log(`[DeepSeek ↓ #${callId}] response (${content.length} chars):\n${content}`);
    console.log("─".repeat(60) + "\n");
    return content;
  } catch (e) {
    const elapsed = Date.now() - start;
    console.error(`[DeepSeek ✗ #${callId}] ${ts()}  elapsed=${elapsed}ms  error: ${e.message}`);
    if (e.response) console.error(`[DeepSeek ✗ #${callId}] HTTP ${e.response.status}: ${JSON.stringify(e.response.data)}`);
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
  if (ext === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString("utf-8");
}

// ─── CV profile extraction ────────────────────────────────────────────────────
async function extractCVProfile(cvText) {
  const prompt = `You are a CV analyzer. Read the CV below and extract a structured candidate profile.

Return ONLY valid JSON — no markdown, no explanation:
{
  "languages": [{"name": "English", "level": "Fluent"}],
  "skills": ["Python", "React", "SQL"],
  "domain": "Software Engineering",
  "experienceLevel": "Mid-level",
  "summary": "Backend developer with 3 years experience in Python and cloud infrastructure"
}

Rules:
- languages: only include English, Mandarin, Cantonese if mentioned. Levels: Fluent, Intermediate, Basic.
- skills: list up to 10 key technical or professional skills found in the CV.
- domain: one short phrase (e.g. "Software Engineering", "Finance", "Education", "Marketing").
- experienceLevel: Entry-level, Mid-level, Senior, or Executive.
- summary: one sentence describing the candidate.

CV:
${cvText.slice(0, 4000)}

JSON:`;

  const raw = await callDeepSeek(prompt, "extract-cv-profile");
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        languages: Array.isArray(parsed.languages) ? parsed.languages : [],
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        domain: parsed.domain || "Unknown",
        experienceLevel: parsed.experienceLevel || "Unknown",
        summary: parsed.summary || "",
      };
    }
  } catch { console.error("Failed to parse CV profile JSON:", raw); }
  return { languages: [], skills: [], domain: "Unknown", experienceLevel: "Unknown", summary: "" };
}

// ─── Job matching ─────────────────────────────────────────────────────────────
function countCsvRows(csvPath) {
  if (!fs.existsSync(csvPath)) return 0;
  try {
    const content = fs.readFileSync(csvPath, "utf-8");
    return csvParse(content, { columns: true, skip_empty_lines: true, relax_column_count: true }).length;
  } catch { return 0; }
}

function readJobsFromDisk() {
  if (!fs.existsSync(ENG_CSV)) return [];
  const content = fs.readFileSync(ENG_CSV, "utf-8");
  return csvParse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

const LANG_KEYWORDS = {
  english: ["english"],
  mandarin: ["mandarin", "putonghua", "普通話"],
  cantonese: ["cantonese", "廣東話", "粵語"],
};

function fieldContainsLang(text, lang) {
  const t = (text || "").toLowerCase();
  return LANG_KEYWORDS[lang].some((kw) => t.includes(kw.toLowerCase()));
}

function isCantoneseRequired(job) {
  return parseInt(job.badge, 10) === 0 || fieldContainsLang(job.languages_required_english, "cantonese");
}

async function batchScoreJobs(profile, jobs) {
  const jobLines = jobs.map((j) => JSON.stringify({
    job_id: j.job_id,
    title: j.job_title_english,
    company: j.company,
    languages_required: j.languages_required_english,
    description: (j.translated_description_english || "").slice(0, 300),
  })).join("\n");

  const prompt = `You are a job matching assistant. Score how well this candidate matches each job.

Candidate profile:
- Summary: ${profile.summary}
- Domain: ${profile.domain}
- Experience level: ${profile.experienceLevel}
- Skills: ${profile.skills.join(", ")}
- Languages: ${profile.languages.map((l) => `${l.name} (${l.level})`).join(", ") || "not specified"}

Scoring guide:
- 85–100: Excellent match — domain, skills, and experience align closely
- 65–84: Good match — most requirements met, minor gaps
- 40–64: Partial match — some relevant skills but different domain or missing key requirements
- 15–39: Weak match — limited overlap
- 0–14: No match — completely different field

Consider both skill/domain fit AND whether the candidate's languages meet the job's language requirements.

Return ONLY valid JSON:
{"scores": [{"job_id": "1", "score": 82, "reason": "Strong Python match for backend role"}, ...]}

Jobs:
${jobLines}

JSON:`;

  const raw = await callDeepSeek(prompt, "score-jobs-batch");
  const result = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.scores)) {
        for (const s of parsed.scores) {
          result[String(s.job_id)] = { score: Math.min(100, Math.max(0, Math.round(s.score))), reason: s.reason || "" };
        }
      }
    }
  } catch { console.error("Failed to parse job scores JSON:", raw); }
  return result;
}

async function matchJobsWithAI(jobs, profile, onBatch = null) {
  const ineligible = jobs.filter(isCantoneseRequired).map((j) => ({ ...j, score: 0, reason: "Cantonese required" }));
  const eligible = jobs.filter((j) => !isCantoneseRequired(j));

  const BATCH = 10;
  const totalBatches = Math.ceil(eligible.length / BATCH);
  const aiScoresMap = {};

  for (let i = 0; i < eligible.length; i += BATCH) {
    const batch = eligible.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    console.log(`[Matching] Scoring batch ${batchNum}/${totalBatches} (${batch.length} jobs)...`);
    onBatch?.(batchNum, totalBatches);
    const scores = await batchScoreJobs(profile, batch);
    Object.assign(aiScoresMap, scores);
  }

  const scored = eligible.map((job) => {
    const s = aiScoresMap[String(job.job_id)] || { score: 50, reason: "Score unavailable" };
    return { ...job, score: s.score, reason: s.reason };
  });

  return { matchedJobs: [...scored, ...ineligible].sort((a, b) => b.score - a.score), aiScoresMap };
}

function applyStoredScores(jobs, aiScoresMap, userLanguages) {
  const userLangs = userLanguages.map((l) => (l.name || l).toLowerCase());

  const results = jobs.map((job) => {
    if (isCantoneseRequired(job)) return { ...job, score: 0, reason: "Cantonese required" };
    const stored = aiScoresMap[String(job.job_id)];
    if (!stored) return { ...job, score: 50, reason: "Score unavailable" };

    let { score, reason } = stored;
    const langField = job.languages_required_english || "";
    if (fieldContainsLang(langField, "mandarin") && !userLangs.includes("mandarin")) {
      score = Math.round(score * 0.5); reason += " · Missing Mandarin";
    }
    if (fieldContainsLang(langField, "english") && !userLangs.includes("english")) {
      score = Math.round(score * 0.3); reason += " · Missing English";
    }
    return { ...job, score, reason };
  });

  return results.sort((a, b) => b.score - a.score);
}

// ─── HTML / CSS ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function scoreColor(score) {
  if (score >= 85) return "#33ff33";
  if (score >= 65) return "#ffdd00";
  if (score >= 40) return "#ff9900";
  return "#ff3333";
}

function blockBar(pct, width = 24) {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&display=swap');

:root {
  --bg: #080c08;
  --surface: #0c140c;
  --surface2: #101a10;
  --green: #33ff33;
  --green-bright: #66ff66;
  --green-dim: #1a6b1a;
  --green-glow: rgba(51,255,51,0.18);
  --amber: #ffb700;
  --red: #ff3333;
  --text: #b8e8b8;
  --text-dim: #4a7a4a;
  --border: #1a3a1a;
  --border-bright: #2a6a2a;
}

*{box-sizing:border-box;margin:0;padding:0}

body {
  font-family:'Share Tech Mono',monospace;
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  position:relative;
}

/* CRT scanlines overlay */
body::before {
  content:'';
  position:fixed;
  inset:0;
  background:repeating-linear-gradient(
    0deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,0.07) 3px,
    rgba(0,0,0,0.07) 4px
  );
  pointer-events:none;
  z-index:9999;
}

/* CRT corner vignette */
body::after {
  content:'';
  position:fixed;
  inset:0;
  background:radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.6) 100%);
  pointer-events:none;
  z-index:9998;
}

a{color:var(--green);text-decoration:none}
a:hover{text-shadow:0 0 8px var(--green)}

/* ── Header ── */
header {
  border-bottom:1px solid var(--border-bright);
  background:var(--surface);
  padding:.8rem 0;
  position:relative;
}
header::after {
  content:'';
  position:absolute;
  bottom:0;left:0;right:0;
  height:1px;
  background:linear-gradient(90deg,transparent,var(--green),transparent);
  box-shadow:0 0 8px var(--green);
}
.header-inner{max-width:1100px;margin:0 auto;padding:0 2rem;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:1rem}
.logo-text h1{
  font-family:'VT323',monospace;
  font-size:1.8rem;
  color:var(--green);
  text-shadow:0 0 10px var(--green),0 0 20px var(--green-glow);
  letter-spacing:2px;
}
.logo-text h1 a{color:inherit}
.logo-sub{font-size:.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-top:.1rem}
.header-tag{
  font-size:.65rem;
  border:1px solid var(--green-dim);
  color:var(--green-dim);
  padding:.25rem .75rem;
  letter-spacing:2px;
  text-transform:uppercase;
}

/* ── Hero ── */
.hero {
  background:var(--surface);
  border-bottom:1px solid var(--border);
  padding:3rem 2rem 4rem;
  text-align:center;
  position:relative;
  overflow:hidden;
}
.hero-grid {
  position:absolute;
  inset:0;
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size:40px 40px;
  opacity:.4;
}
.hero-content{position:relative;z-index:1}
.hero-label{
  font-size:.65rem;
  letter-spacing:4px;
  color:var(--text-dim);
  text-transform:uppercase;
  margin-bottom:.75rem;
}
.hero h2{
  font-family:'VT323',monospace;
  font-size:2.8rem;
  color:var(--green);
  text-shadow:0 0 16px var(--green),0 0 40px var(--green-glow);
  letter-spacing:3px;
  margin-bottom:.75rem;
  line-height:1.1;
}
.hero p{color:var(--text-dim);font-size:.85rem;letter-spacing:1px;max-width:520px;margin:0 auto 2rem;line-height:1.7}

/* ── Stats ── */
.stats-row{display:flex;justify-content:center;gap:0;margin-top:1.5rem;border:1px solid var(--border-bright);display:inline-flex}
.stat{
  padding:.75rem 2rem;
  border-right:1px solid var(--border-bright);
  text-align:center;
}
.stat:last-child{border-right:none}
.stat-num{
  font-family:'VT323',monospace;
  font-size:2.2rem;
  color:var(--green);
  display:block;
  line-height:1;
  text-shadow:0 0 10px var(--green);
}
.stat-lbl{font-size:.6rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:2px;margin-top:.2rem}

/* ── Container ── */
.container{max-width:1100px;margin:0 auto;padding:2rem 2rem 4rem}

/* ── Action grid ── */
.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:2rem}
@media(max-width:680px){.action-grid{grid-template-columns:1fr}}

.action-card {
  background:var(--surface);
  border:1px solid var(--border-bright);
  padding:1.75rem;
  display:flex;
  flex-direction:column;
  position:relative;
  transition:border-color .2s,box-shadow .2s;
}
.action-card:hover {
  border-color:var(--green-dim);
  box-shadow:0 0 20px rgba(51,255,51,0.06);
}
.action-card::before {
  content:attr(data-label);
  position:absolute;
  top:-.6rem;left:1rem;
  background:var(--bg);
  padding:0 .5rem;
  font-size:.6rem;
  color:var(--green-dim);
  letter-spacing:3px;
  text-transform:uppercase;
}
.card-icon{font-size:1.5rem;margin-bottom:1rem}
.action-card h3{
  font-family:'VT323',monospace;
  font-size:1.4rem;
  color:var(--green);
  letter-spacing:2px;
  margin-bottom:.6rem;
}
.action-card p{font-size:.78rem;color:var(--text-dim);line-height:1.7;flex:1;margin-bottom:1.25rem;letter-spacing:.5px}

/* ── Generic card ── */
.card {
  background:var(--surface);
  border:1px solid var(--border-bright);
  padding:1.75rem;
  margin-bottom:1.5rem;
  position:relative;
}
.card::before {
  content:attr(data-label);
  position:absolute;
  top:-.6rem;left:1rem;
  background:var(--bg);
  padding:0 .5rem;
  font-size:.6rem;
  color:var(--green-dim);
  letter-spacing:3px;
  text-transform:uppercase;
}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;flex-wrap:wrap;gap:.75rem}
.card-title{font-family:'VT323',monospace;font-size:1.3rem;color:var(--green);letter-spacing:2px}

/* ── Forms ── */
.form-group{margin-bottom:1.5rem}
.form-group label{display:block;font-size:.7rem;color:var(--text-dim);letter-spacing:3px;text-transform:uppercase;margin-bottom:.6rem}

.file-drop {
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  width:100%;padding:2rem;
  border:1px dashed var(--border-bright);
  background:var(--surface2);
  cursor:pointer;
  transition:border-color .2s,background .2s;
  text-align:center;
}
.file-drop:hover,.file-drop:focus-within{border-color:var(--green-dim);background:#0f1e0f}
.file-drop input[type=file]{position:absolute;opacity:0;width:0;height:0}
.file-drop-icon{font-size:1.5rem;margin-bottom:.5rem;filter:grayscale(1)}
.file-drop-text{font-size:.75rem;color:var(--text-dim);letter-spacing:1px}
.file-drop-text strong{color:var(--green)}
.file-name{margin-top:.5rem;font-size:.75rem;color:var(--green);display:none}

/* ── Buttons ── */
.btn {
  display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  padding:.55rem 1.4rem;
  font-family:'Share Tech Mono',monospace;
  font-size:.8rem;
  letter-spacing:2px;
  text-transform:uppercase;
  cursor:pointer;
  border:1px solid var(--green-dim);
  background:transparent;
  color:var(--green);
  transition:all .15s;
  white-space:nowrap;
}
.btn:hover:not(:disabled){
  background:var(--green);
  color:var(--bg);
  box-shadow:0 0 16px var(--green),0 0 32px var(--green-glow);
}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-success{border-color:#1a6b1a;color:#33dd33}
.btn-success:hover:not(:disabled){background:#33dd33;color:var(--bg);box-shadow:0 0 16px #33dd33}
.btn-amber{border-color:#7a5a00;color:var(--amber)}
.btn-amber:hover:not(:disabled){background:var(--amber);color:var(--bg)}
.btn-full{width:100%}
.btn-sm{font-size:.65rem;padding:.35rem .9rem}

/* ── Flash ── */
.flash{
  padding:.75rem 1rem;
  margin-bottom:1.5rem;
  font-size:.75rem;
  letter-spacing:1px;
  border-left:3px solid;
  display:flex;align-items:center;gap:.75rem;
}
.flash.success{border-color:var(--green);background:rgba(51,255,51,0.05);color:var(--green)}
.flash.error{border-color:var(--red);background:rgba(255,51,51,0.05);color:var(--red)}
.flash.info{border-color:var(--amber);background:rgba(255,183,0,0.05);color:var(--amber)}

/* ── Language pills ── */
.lang-row{display:flex;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem}
.lang-pill{
  display:flex;align-items:center;gap:.5rem;
  padding:.4rem 1rem;
  border:1px solid var(--border-bright);
  background:var(--surface2);
  cursor:pointer;
  transition:all .15s;
  font-size:.75rem;
  letter-spacing:1px;
}
.lang-pill:has(input:checked){
  border-color:var(--green);
  color:var(--green);
  box-shadow:0 0 8px var(--green-glow);
}
.lang-pill input{width:13px;height:13px;cursor:pointer;accent-color:var(--green)}
.lang-name{font-weight:600}
.level-tag{font-size:.65rem;border:1px solid var(--green-dim);color:var(--green-dim);padding:.1rem .4rem;letter-spacing:1px}

.actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}

/* ── Skills chips ── */
.skills-wrap{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem}
.skill-chip{
  font-size:.65rem;
  border:1px solid var(--border-bright);
  color:var(--text-dim);
  padding:.15rem .6rem;
  letter-spacing:1px;
  text-transform:uppercase;
}

/* ── Filter ── */
.filter-label{
  display:flex;align-items:center;gap:.4rem;
  font-size:.65rem;letter-spacing:2px;text-transform:uppercase;
  color:var(--text-dim);cursor:pointer;
  border:1px solid var(--border);
  padding:.35rem .75rem;
}
.filter-label:hover{border-color:var(--border-bright);color:var(--text)}
.filter-label input{accent-color:var(--green);width:12px;height:12px}

/* ── Table ── */
.job-count{font-size:.7rem;color:var(--text-dim);margin-left:.5rem;letter-spacing:1px}
.table-wrap{overflow-x:auto;border:1px solid var(--border)}
table{width:100%;border-collapse:collapse;font-size:.78rem}
th{
  padding:.65rem 1rem;text-align:left;
  background:var(--surface2);
  border-bottom:1px solid var(--border-bright);
  font-size:.6rem;color:var(--green-dim);
  text-transform:uppercase;letter-spacing:3px;white-space:nowrap;
}
td{padding:.65rem 1rem;border-bottom:1px solid var(--border);vertical-align:middle;color:var(--text)}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(51,255,51,0.03)}
td a{color:var(--green)}
td a:hover{text-shadow:0 0 6px var(--green)}

.badge-ok{color:var(--green);font-size:.7rem;letter-spacing:1px;border:1px solid var(--green-dim);padding:.1rem .5rem}
.badge-no{color:var(--red);font-size:.7rem;letter-spacing:1px;border:1px solid #7a1a1a;padding:.1rem .5rem}

/* ── Score bar (retro block chars) ── */
.score-cell{display:flex;align-items:center;gap:.6rem;min-width:160px;font-family:'Share Tech Mono',monospace}
.score-bar{
  font-size:.7rem;
  letter-spacing:1px;
}
@keyframes glow-pulse{
  0%,100%{text-shadow:0 0 4px currentColor}
  50%{text-shadow:0 0 12px currentColor,0 0 24px currentColor}
}
.score-bar.good{color:var(--green);animation:glow-pulse 2s ease-in-out infinite}
.score-bar.mid{color:var(--amber)}
.score-bar.low{color:#ff6600}
.score-bar.none{color:var(--red)}
.score-num{font-size:.72rem;min-width:36px;text-align:right;font-family:'Share Tech Mono',monospace}

.reason{color:var(--text-dim);font-size:.72rem;letter-spacing:.5px}

/* ── Terminal progress ── */
.terminal-wrap{max-width:600px;margin:4rem auto;padding:0 1.5rem}
.terminal-box{
  background:var(--surface);
  border:1px solid var(--border-bright);
  position:relative;
}
.terminal-box::before{
  content:attr(data-title);
  display:block;
  background:var(--surface2);
  border-bottom:1px solid var(--border-bright);
  padding:.5rem 1rem;
  font-size:.65rem;
  color:var(--green-dim);
  letter-spacing:3px;
  text-transform:uppercase;
}
.terminal-body{padding:1.5rem}
.term-log{
  min-height:8rem;max-height:14rem;
  overflow-y:auto;
  margin-bottom:1.25rem;
  font-size:.78rem;
  color:var(--text-dim);
  line-height:1.7;
}
.term-log .log-line{color:var(--text-dim)}
.term-log .log-line.active{color:var(--green)}
.term-log .log-line.done{color:var(--green-dim)}
.prog-line{
  font-family:'Share Tech Mono',monospace;
  font-size:.9rem;
  color:var(--green);
  letter-spacing:2px;
  margin-bottom:.75rem;
  word-break:break-all;
}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.cursor{
  display:inline-block;
  color:var(--green);
  animation:blink .8s step-end infinite;
  font-size:1rem;
  margin-left:.25rem;
}
.term-status{font-size:.7rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase}

/* ── Overlay ── */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:50;align-items:center;justify-content:center}
.overlay.show{display:flex}
.overlay-box{
  background:var(--surface);
  border:1px solid var(--border-bright);
  padding:2rem 2.5rem;
  text-align:center;
  max-width:360px;width:90%;
}
.overlay-box h3{font-family:'VT323',monospace;font-size:1.5rem;color:var(--green);letter-spacing:2px;margin-bottom:.5rem}
.overlay-box p{font-size:.75rem;color:var(--text-dim);letter-spacing:1px;line-height:1.6}
.overlay-prog{font-family:'Share Tech Mono',monospace;font-size:.8rem;color:var(--green);margin:.75rem 0;letter-spacing:1px}

/* ── Error / center ── */
.center-card{max-width:480px;margin:4rem auto;text-align:center}
.center-card h2{font-family:'VT323',monospace;font-size:1.8rem;color:var(--red);letter-spacing:2px;margin-bottom:.75rem}
.center-card p{color:var(--text-dim);font-size:.8rem;margin-bottom:1.5rem;letter-spacing:1px}

@media(max-width:640px){.hero h2{font-size:2rem}.stats-row{flex-direction:column}}
`;

function shell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="logo">
      <div class="logo-text">
        <h1><a href="/">// HK_JOB_MATCHER</a></h1>
        <div class="logo-sub">Powered by DeepSeek AI &nbsp;·&nbsp; Non-Chinese Speaker Platform</div>
      </div>
    </div>
    <span class="header-tag">v1.0 BETA</span>
  </div>
</header>
<main>${body}</main>
</body>
</html>`;
}

// ─── Pages ────────────────────────────────────────────────────────────────────
function homePage(flash = null) {
  const cantoCount = countCsvRows(CANTO_CSV);
  const engCount = countCsvRows(ENG_CSV);
  const suitableCount = (() => {
    try { return getJobs().filter((j) => parseInt(j.badge, 10) === 1).length; } catch { return 0; }
  })();

  const flashHtml = flash
    ? `<div class="flash ${flash.type}"><span>&gt;</span> ${esc(flash.msg)}</div>`
    : "";

  return shell("HK Job Matcher", `
<div class="hero">
  <div class="hero-grid"></div>
  <div class="hero-content">
    <div class="hero-label">&gt; SYSTEM READY</div>
    <h2>HK JOB MATCHER_</h2>
    <p>Upload your CV. AI extracts your skills and matches you against Hong Kong jobs — no Cantonese required.</p>
    <div class="stats-row">
      <div class="stat"><span class="stat-num">${cantoCount}</span><div class="stat-lbl">Raw Listings</div></div>
      <div class="stat"><span class="stat-num">${engCount}</span><div class="stat-lbl">Translated</div></div>
      <div class="stat"><span class="stat-num">${suitableCount}</span><div class="stat-lbl">Suitable</div></div>
    </div>
  </div>
</div>

<div class="container">
  ${flashHtml}
  <div class="action-grid">

    <div class="action-card" data-label="// MODULE_01">
      <div class="card-icon">[ CV ]</div>
      <h3>MATCH MY CV</h3>
      <p>Upload your CV as PDF, DOCX, or TXT. DeepSeek will extract your skills, domain, and experience — then match you against all available listings.</p>
      <form method="POST" action="/upload" enctype="multipart/form-data" onsubmit="handleUpload(this)">
        <div class="form-group">
          <label>&gt; Select file</label>
          <div class="file-drop" onclick="this.querySelector('input').click()">
            <input type="file" name="cv" accept=".pdf,.txt,.docx" required onchange="showFileName(this)">
            <div class="file-drop-icon">[ 📁 ]</div>
            <div class="file-drop-text"><strong>CHOOSE FILE</strong> or drag &amp; drop</div>
            <div class="file-drop-text" style="margin-top:.25rem;font-size:.65rem;letter-spacing:1px">.pdf &nbsp;·&nbsp; .docx &nbsp;·&nbsp; .txt &nbsp;·&nbsp; max 10MB</div>
            <div class="file-name" id="fileName"></div>
          </div>
        </div>
        <button type="submit" class="btn btn-full">&gt; ANALYSE &amp; MATCH</button>
      </form>
    </div>

    <div class="action-card" data-label="// MODULE_02">
      <div class="card-icon">[ DB ]</div>
      <h3>UPDATE LISTINGS</h3>
      <p>Sync Cantonese job listings to English. DeepSeek translates each listing and detects if Cantonese is required. Processed in parallel batches of 5.</p>
      <p style="font-size:.7rem;color:var(--text-dim);margin-top:-.5rem;margin-bottom:1.25rem;letter-spacing:1px">
        &gt; STATUS: <span style="color:var(--green)">${engCount}/${cantoCount}</span> listings translated
      </p>
      <form method="POST" action="/update-listings">
        <button type="submit" class="btn btn-success btn-full" ${translationRunning ? "disabled" : ""}>
          &gt; ${translationRunning ? "UPDATE IN PROGRESS..." : "RUN UPDATE"}
        </button>
      </form>
    </div>

  </div>
</div>

<div class="overlay" id="overlay">
  <div class="overlay-box">
    <h3>PROCESSING<span class="cursor">█</span></h3>
    <p id="overlayMsg">Initialising...</p>
    <div class="overlay-prog" id="overlayProg"></div>
  </div>
</div>

<script>
function showFileName(input) {
  var el = document.getElementById('fileName');
  if (input.files && input.files[0]) { el.textContent = '> ' + input.files[0].name; el.style.display = 'block'; }
}
function handleUpload(form) {
  var btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = '> UPLOADING...';
  document.getElementById('overlayMsg').textContent = 'Reading CV and calling DeepSeek...';
  document.getElementById('overlay').classList.add('show');
}
</script>`);
}

function terminalProgressPage({ title, dataTitle, eventsUrl, doneRedirectFn, steps }) {
  return shell(title, `
<div class="terminal-wrap">
  <div class="terminal-box" data-title="${esc(dataTitle)}">
    <div class="terminal-body">
      <div class="term-log" id="termLog"></div>
      <div class="prog-line" id="progLine">[░░░░░░░░░░░░░░░░░░░░░░░░] 0%</div>
      <div class="term-status" id="termStatus">connecting...<span class="cursor">█</span></div>
    </div>
  </div>
</div>

<script>
var STEPS = ${JSON.stringify(steps)};
var es = new EventSource(${JSON.stringify(eventsUrl)});

function addLog(text, cls) {
  var log = document.getElementById('termLog');
  var line = document.createElement('div');
  line.className = 'log-line ' + (cls || '');
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function setBar(pct) {
  var filled = Math.round(pct / 100 * 24);
  var empty = 24 - filled;
  var bar = '[' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + pct + '%';
  document.getElementById('progLine').textContent = bar;
}

function setStatus(txt) { document.getElementById('termStatus').innerHTML = txt + '<span class="cursor">█</span>'; }

es.onmessage = function(e) {
  var d = JSON.parse(e.data);
  (${doneRedirectFn.toString()})(d, es, addLog, setBar, setStatus);
};

es.onerror = function() { setStatus('CONNECTION LOST — CHECK TERMINAL'); };
</script>`);
}

function uploadProgressPage(jobId) {
  const doneRedirectFn = function(d, es, addLog, setBar, setStatus) {
    if (d.step === "reading")   { addLog("> Reading CV file...", "active"); setBar(5); setStatus("extracting text"); }
    if (d.step === "profiling") { addLog("> Calling DeepSeek: extract candidate profile...", "active"); setBar(15); setStatus("profiling candidate"); }
    if (d.step === "scoring") {
      var pct = 15 + Math.round((d.batch / d.totalBatches) * 80);
      addLog("> Scoring batch " + d.batch + "/" + d.totalBatches + " (" + d.count + " jobs)...", "active");
      setBar(pct);
      setStatus("ai scoring — batch " + d.batch + "/" + d.totalBatches);
    }
    if (d.step === "done") {
      setBar(100);
      addLog("> DONE. All jobs scored.", "done");
      setStatus("complete — redirecting");
      es.close();
      setTimeout(function() { window.location.href = "/upload/result/" + d.jobId; }, 600);
    }
    if (d.step === "error") {
      addLog("> ERROR: " + d.message, "active");
      setStatus("error");
      es.close();
      setTimeout(function() { window.location.href = "/?status=error&msg=" + encodeURIComponent(d.message); }, 2500);
    }
  };

  return terminalProgressPage({
    title: "Analysing CV…",
    dataTitle: "// CV_ANALYSIS.EXE — JOB: " + jobId,
    eventsUrl: "/upload/events/" + jobId,
    doneRedirectFn,
    steps: [],
  });
}

function updateProgressPage() {
  const doneRedirectFn = function(d, es, addLog, setBar, setStatus) {
    if (d.error) {
      es.close();
      window.location.href = "/?status=error&msg=" + encodeURIComponent(d.error);
      return;
    }
    if (d.done) {
      setBar(100);
      addLog("> " + (d.noChange ? "Already up to date." : "Translation complete: " + d.completed + " jobs."), "done");
      setStatus("complete — redirecting");
      es.close();
      var status = d.noChange ? "no-change" : "updated";
      setTimeout(function() {
        window.location.href = "/?status=" + status + "&msg=" + encodeURIComponent(d.message || "Done.");
      }, 1500);
      return;
    }
    var pct = d.total > 0 ? Math.round(d.completed / d.total * 100) : 0;
    setBar(pct);
    if (d.message) addLog("> " + d.message, "active");
    setStatus("translating — " + d.completed + "/" + (d.total || "?") + " jobs");
  };

  return terminalProgressPage({
    title: "Updating Listings…",
    dataTitle: "// TRANSLATE.EXE — BATCH MODE",
    eventsUrl: "/update-listings/events",
    doneRedirectFn,
    steps: [],
  });
}

function resultsPage(profile, matchedJobs, cvText, aiScoresMap) {
  const ALL_LANGS = ["English", "Mandarin", "Cantonese"];
  const detectedLangs = profile.languages || [];
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

  const aiScoresJson = esc(JSON.stringify(aiScoresMap));
  const profileJson = esc(JSON.stringify(profile));
  const exportLangInputs = detectedLangs.map((l) => `<input type="hidden" name="manual_languages" value="${esc(l.name)}">`).join("");

  const skillChips = profile.skills.map((s) => `<span class="skill-chip">${esc(s)}</span>`).join("");

  const rows = matchedJobs.map((job) => {
    const badge = parseInt(job.badge, 10);
    const badgeHtml = badge === 1 ? `<span class="badge-ok">[ OK ]</span>` : `<span class="badge-no">[ CANTO ]</span>`;
    const color = scoreColor(job.score);
    const barClass = job.score >= 85 ? "good" : job.score >= 65 ? "mid" : job.score >= 40 ? "low" : "none";
    const bar = blockBar(job.score, 12);
    return `<tr data-score="${job.score}">
  <td><a href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">${esc(job.job_title_english)}</a></td>
  <td style="color:var(--text-dim)">${esc(job.company)}</td>
  <td>${badgeHtml}</td>
  <td>
    <div class="score-cell">
      <span class="score-bar ${barClass}">[${bar}]</span>
      <span class="score-num" style="color:${color}">${job.score}%</span>
    </div>
  </td>
  <td class="reason">${esc(job.reason)}</td>
</tr>`;
  }).join("\n");

  return shell("HK Job Matcher — Results", `
<div class="hero" style="padding:2rem 2rem 3.5rem">
  <div class="hero-grid"></div>
  <div class="hero-content">
    <div class="hero-label">&gt; ANALYSIS COMPLETE</div>
    <h2>${esc(profile.domain.toUpperCase())}_</h2>
    <p>${esc(profile.experienceLevel)} &nbsp;·&nbsp; ${detectedLangs.map((l) => esc(l.name)).join(", ") || "No languages detected"}</p>
    ${profile.summary ? `<p style="color:var(--text-dim);font-size:.75rem;margin-top:.5rem;font-style:italic">"${esc(profile.summary)}"</p>` : ""}
  </div>
</div>

<div class="container">

  <div class="card" data-label="// CANDIDATE_PROFILE">
    <div class="card-header">
      <span class="card-title">PROFILE &amp; LANGUAGE OVERRIDE</span>
      <a href="/" class="btn btn-sm">&lt; BACK</a>
    </div>
    ${skillChips ? `<div class="skills-wrap">${skillChips}</div>` : ""}
    <p style="font-size:.72rem;color:var(--text-dim);letter-spacing:1px;margin-bottom:1rem">
      &gt; Adjust language profile and re-match instantly (no extra AI calls).
    </p>
    <form method="POST" action="/rematch">
      <input type="hidden" name="cv_text" value="${esc(cvText)}">
      <input type="hidden" name="ai_scores_json" value="${aiScoresJson}">
      <input type="hidden" name="profile_json" value="${profileJson}">
      <div class="lang-row">${langPills}</div>
      <div class="actions">
        <button type="submit" class="btn">&gt; RE-MATCH</button>
      </div>
    </form>
  </div>

  <div class="card" data-label="// JOB_RESULTS">
    <div class="card-header">
      <span class="card-title">MATCHES <span class="job-count" id="jobCount">[${matchedJobs.length}]</span></span>
      <div class="actions">
        <label class="filter-label">
          <input type="checkbox" id="filterCheck" onchange="applyFilter(this.checked)">
          SUITABLE ONLY
        </label>
        <form method="POST" action="/export" style="display:inline">
          ${exportLangInputs}
          <input type="hidden" name="ai_scores_json" value="${aiScoresJson}">
          <button type="submit" class="btn btn-sm btn-amber">&gt; EXPORT CSV</button>
        </form>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Job Title</th><th>Company</th><th>Status</th><th>AI Match Score</th><th>Reason</th></tr>
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
  document.getElementById('jobCount').textContent = '[' + visible + ']';
}
</script>`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const { status, msg } = req.query;
  let flash = null;
  if (status === "updated")   flash = { type: "success", msg: msg || "Job listings updated successfully." };
  if (status === "no-change") flash = { type: "info",    msg: "Listings are already up to date. Nothing to translate." };
  if (status === "error")     flash = { type: "error",   msg: msg || "An error occurred." };
  res.send(homePage(flash));
});

// CV upload — fire async, redirect to progress page
app.post("/upload", (req, res, next) => {
  upload.single("cv")(req, res, (err) => {
    if (err) return res.send(homePage({ type: "error", msg: err.message }));
    next();
  });
}, (req, res) => {
  if (!req.file) return res.send(homePage({ type: "error", msg: "No file received." }));

  const jobId = genId();
  const emitter = new EventEmitter();
  uploadJobs.set(jobId, { emitter, result: null, error: null, done: false });

  // Fire and forget
  (async () => {
    const job = uploadJobs.get(jobId);
    try {
      emitter.emit("e", { step: "reading" });
      const cvText = await extractText(req.file.buffer, req.file.originalname);
      if (!cvText.trim()) throw new Error("Could not extract text from the uploaded file.");

      emitter.emit("e", { step: "profiling" });
      const profile = await extractCVProfile(cvText);
      console.log(`[Profile] domain=${profile.domain}  level=${profile.experienceLevel}  skills=${profile.skills.join(", ")}`);

      const jobs = getJobs();
      const eligible = jobs.filter((j) => !isCantoneseRequired(j));
      const totalBatches = Math.ceil(eligible.length / 10);

      const { matchedJobs, aiScoresMap } = await matchJobsWithAI(jobs, profile, (batchNum, tb) => {
        emitter.emit("e", { step: "scoring", batch: batchNum, totalBatches: tb, count: Math.min(10, eligible.length - (batchNum - 1) * 10) });
      });

      const html = resultsPage(profile, matchedJobs, cvText, aiScoresMap);
      job.result = html;
      job.done = true;
      emitter.emit("e", { step: "done", jobId });
    } catch (e) {
      console.error("[Upload job error]", e.message);
      if (job) { job.error = e.message; job.done = true; }
      emitter.emit("e", { step: "error", message: e.message });
    }
  })();

  res.redirect(`/upload/progress/${jobId}`);
});

app.get("/upload/progress/:jobId", (req, res) => {
  res.send(uploadProgressPage(req.params.jobId));
});

app.get("/upload/events/:jobId", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const job = uploadJobs.get(req.params.jobId);
  if (!job) { res.write(`data: ${JSON.stringify({ step: "error", message: "Job not found." })}\n\n`); return; }

  // If already done, send result immediately
  if (job.done) {
    if (job.error) res.write(`data: ${JSON.stringify({ step: "error", message: job.error })}\n\n`);
    else res.write(`data: ${JSON.stringify({ step: "done", jobId: req.params.jobId })}\n\n`);
    res.end();
    return;
  }

  const listener = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  job.emitter.on("e", listener);
  req.on("close", () => job.emitter.off("e", listener));
});

app.get("/upload/result/:jobId", (req, res) => {
  const job = uploadJobs.get(req.params.jobId);
  if (!job || !job.result) return res.redirect("/?status=error&msg=Result+not+found+or+expired");
  const html = job.result;
  uploadJobs.delete(req.params.jobId); // clean up
  res.send(html);
});

app.post("/rematch", (req, res) => {
  try {
    const cvText = req.body.cv_text || "";
    const raw = req.body.manual_languages;
    const names = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const langs = names.map((n) => ({ name: n, level: "" }));

    let aiScoresMap = {};
    try { aiScoresMap = JSON.parse(req.body.ai_scores_json || "{}"); } catch {}
    let profile = { languages: langs, skills: [], domain: "Unknown", experienceLevel: "Unknown", summary: "" };
    try { profile = { ...JSON.parse(req.body.profile_json || "{}"), languages: langs }; } catch {}

    const matched = applyStoredScores(getJobs(), aiScoresMap, langs);
    res.send(resultsPage(profile, matched, cvText, aiScoresMap));
  } catch (e) {
    console.error(e);
    res.redirect("/?status=error&msg=" + encodeURIComponent(e.message));
  }
});

app.post("/export", (req, res) => {
  try {
    const raw = req.body.manual_languages;
    const names = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const langs = names.map((n) => ({ name: n, level: "" }));
    let aiScoresMap = {};
    try { aiScoresMap = JSON.parse(req.body.ai_scores_json || "{}"); } catch {}
    const matched = applyStoredScores(getJobs(), aiScoresMap, langs);

    const csvData = csvStringify(
      matched.map((j) => ({
        job_id: j.job_id, job_title: j.job_title_english, company: j.company,
        url: j.url, match_score: j.score + "%",
        suitable: parseInt(j.badge, 10) === 1 ? "Yes" : "No",
        reason: j.reason, date_translated: j.date_translated,
      })),
      { header: true }
    );

    const filename = `matched_jobs_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvData);
  } catch (e) {
    console.error(e);
    res.status(500).send("Export failed: " + e.message);
  }
});

app.post("/update-listings", (req, res) => {
  if (!TOKEN) return res.redirect("/?status=error&msg=" + encodeURIComponent("No DeepSeek token in .env"));
  if (translationRunning) return res.redirect("/update-listings/progress");

  translationRunning = true;
  translationState = { running: true, completed: 0, total: 0, message: "Starting...", done: false, error: null };

  translate(TOKEN, emitProgress).then(() => {
    translationRunning = false;
    invalidateJobCache();
  }).catch((e) => {
    console.error("[Update] Error:", e.message);
    translationRunning = false;
    emitProgress({ done: true, error: e.message });
  });

  res.redirect("/update-listings/progress");
});

app.get("/update-listings/progress", (_req, res) => {
  res.send(updateProgressPage());
});

app.get("/update-listings/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(translationState)}\n\n`);
  const listener = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  progressEmitter.on("update", listener);
  if (translationState.done) res.write(`data: ${JSON.stringify(translationState)}\n\n`);
  req.on("close", () => progressEmitter.off("update", listener));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🟢 Server running → http://localhost:${PORT}`);
  if (!TOKEN) console.warn("⚠  No DeepSeek token found in .env");
  console.log(`   Cantonese listings : ${countCsvRows(CANTO_CSV)}`);
  console.log(`   Translated listings: ${countCsvRows(ENG_CSV)}`);
  getJobs();
  console.log();
});
