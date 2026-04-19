#!/usr/bin/env node
/**
 * translate.js - Translation module for Cantonese job listings to English.
 * Also uses AI to determine if the job requires Cantonese (badge: 1 = suitable, 0 = not suitable, -1 = error).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// ----------------------------------------------------------------------
// File paths and configuration
// ----------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTINGS_DIR = path.join(__dirname, "listings");
const CANTO_CSV = path.join(LISTINGS_DIR, "canto_jobs.csv");
const ENG_CSV = path.join(LISTINGS_DIR, "english_jobs.csv");

// DeepSeek API settings
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const TEMPERATURE = 0.1;
const MAX_TOKENS = 2000;
const SLEEP_BETWEEN_CALLS = 100; // milliseconds

// ----------------------------------------------------------------------
// Helper functions
// ----------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countCsvRows(csvPath) {
  if (!fs.existsSync(csvPath)) return 0;
  const content = fs.readFileSync(csvPath, "utf-8");
  const rows = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
  return rows.length;
}

function readCantoCsv() {
  const content = fs.readFileSync(CANTO_CSV, "utf-8");
  return parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

let _dsCallCount = 0;

async function callDeeepseek(prompt, token, label = "general") {
  const callId = ++_dsCallCount;
  const ts = () => new Date().toISOString();

  console.log("\n" + "─".repeat(60));
  console.log(`[DeepSeek ↑ #${callId}] ${ts()}  label="${label}"`);
  console.log(`[DeepSeek ↑ #${callId}] model=${MODEL}  max_tokens=${MAX_TOKENS}  temperature=${TEMPERATURE}`);
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
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
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

async function translateText(text, token) {
  if (!text || !text.trim()) return text;
  const prompt =
    "Translate the following Cantonese text into English. " +
    "Provide only the English translation without any additional commentary:\n\n" +
    text;
  const translation = await callDeeepseek(prompt, token, "translate");
  return translation || text;
}

async function detectCantoneseRequired(description, token) {
  if (!description || !description.trim()) return -1;

  const prompt = `You are a job analysis assistant. Read the following job description (in Cantonese/Chinese) and determine if the job REQUIRES the candidate to speak Cantonese (also known as 粵語 or 廣東話).

Rules:
- If the job description explicitly says Cantonese is required, mandatory, or a must-have -> answer 0
- If Cantonese is only mentioned as "preferred", "plus", "good to have", or not mentioned at all -> answer 1
- If you are unsure or the description is ambiguous -> answer -1

Answer with ONLY a single number: 0, 1, or -1. No extra text.

Job description:
${description}

Answer:`;

  const response = await callDeeepseek(prompt, token, "badge-detect");
  if (response === "0" || response === "1" || response === "-1") {
    return parseInt(response, 10);
  }
  // fallback
  if (response.includes("0") && !response.includes("1")) return 0;
  if (response.includes("1") && !response.includes("0")) return 1;
  return -1;
}

async function translateRow(row, token, dateTranslated) {
  const titleEn = await translateText(row["job_title_original"], token);
  await sleep(SLEEP_BETWEEN_CALLS);

  const descEn = await translateText(row["raw_description_chinese"], token);
  await sleep(SLEEP_BETWEEN_CALLS);

  const langsEn = await translateText(row["languages_required"], token);
  await sleep(SLEEP_BETWEEN_CALLS);

  const badge = await detectCantoneseRequired(row["raw_description_chinese"], token);

  return {
    job_id: row["job_id"],
    job_title_english: titleEn,
    company: row["company"],
    url: row["url"],
    translated_description_english: descEn,
    languages_required_english: langsEn,
    badge,
    date_translated: dateTranslated,
  };
}

function writeEnglishCsv(rows) {
  const columns = [
    "job_id",
    "job_title_english",
    "company",
    "url",
    "translated_description_english",
    "languages_required_english",
    "badge",
    "date_translated",
  ];
  const output = stringify(rows, { header: true, columns });
  fs.writeFileSync(ENG_CSV, output, "utf-8");
}

// ----------------------------------------------------------------------
// Main translate function
// ----------------------------------------------------------------------
export async function translate(token, onProgress = null) {
  const cantoCount = countCsvRows(CANTO_CSV);
  const englishCount = countCsvRows(ENG_CSV);

  console.log(`Cantonese listings: ${cantoCount}`);
  console.log(`English listings:   ${englishCount}`);

  if (cantoCount === englishCount) {
    console.log("Row counts match. No translation needed.");
    onProgress?.({ done: true, noChange: true, completed: englishCount, total: englishCount });
    return;
  }

  console.log("Mismatch detected. Starting translation + badge detection...");

  const cantoRows = readCantoCsv();
  if (!cantoRows.length) {
    console.log("No data in canto_jobs.csv. Nothing to translate.");
    onProgress?.({ done: true, noChange: true, completed: 0, total: 0 });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const englishRows = [];
  const total = cantoRows.length;
  const BATCH_SIZE = 5;
  const totalBatches = Math.ceil(total / BATCH_SIZE);
  let completed = 0;

  onProgress?.({ completed: 0, total, message: `Starting — ${total} jobs to translate...` });

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = cantoRows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const rowRange = `${i + 1}–${Math.min(i + BATCH_SIZE, total)}`;
    console.log(`\nBatch ${batchNum}/${totalBatches} — rows ${rowRange} of ${total} (${batch.length} jobs in parallel)...`);

    onProgress?.({ completed, total, message: `Batch ${batchNum}/${totalBatches} — translating ${batch.length} jobs in parallel...` });

    const batchResults = await Promise.all(
      batch.map(async (row, j) => {
        console.log(`  [batch ${batchNum}] job_id=${row["job_id"]} (row ${i + j + 1}/${total})`);
        const result = await translateRow(row, token, today);
        completed++;
        onProgress?.({ completed, total, message: `Translated: ${result.job_title_english} (${completed}/${total})` });
        return result;
      })
    );

    englishRows.push(...batchResults);
    console.log(`Batch ${batchNum}/${totalBatches} done.`);
  }

  writeEnglishCsv(englishRows);
  console.log(`\nTranslation complete. ${englishRows.length} jobs written to ${ENG_CSV}`);
  onProgress?.({ done: true, completed: englishRows.length, total, message: `Done — ${englishRows.length} jobs translated.` });
}

// ----------------------------------------------------------------------
// Optional direct execution
// ----------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createRequire } = await import("module");
  const { config } = await import("dotenv");

  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    const token = process.env.token;
    if (token) {
      await translate(token);
    } else {
      console.log("No 'token' found in .env file. Exiting.");
    }
  } else {
    console.log("No .env file found. This script is meant to be imported and called with a token.");
  }
}
