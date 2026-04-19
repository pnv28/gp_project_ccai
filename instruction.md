I need a complete Node.js web application for a job matching platform for non‑Chinese speakers in Hong Kong. The backend translation module (translate.js) is already working and produces `listings/english_jobs.csv` with columns: job_id, job_title_english, company, url, translated_description_english, languages_required_english, badge (1 = suitable – no Cantonese required, 0 = Cantonese required, -1 = error), date_translated.

Now I need a **single‑server** application where frontend and backend are not separate – it’s just an Express server that renders HTML pages. No separate frontend JavaScript or API endpoints. The server should:

1. Serve a simple HTML form at `GET /` where the user can:
   - Upload a CV file (.txt or .pdf)
   - (Optional) Manually adjust detected languages as a fallback

2. On `POST /upload`, the server:
   - Extracts text from the uploaded CV (use `pdf-parse` for PDF, plain text for .txt).
   - Calls the **DeepSeek API** (same as in translate.js) with a prompt that asks DeepSeek to extract:
     - Which languages the user knows: English, Mandarin, Cantonese.
     - Proficiency level for each (Fluent / Intermediate / Basic) – optional but nice.
     - (Optional) Key skills – could be used later.
   - DeepSeek should return **structured JSON** (e.g., `{ "languages": [{"name": "English", "level": "Fluent"}, ...] }`). Use a strict prompt to ensure valid JSON.

3. After getting languages from DeepSeek, the server:
   - Reads `listings/english_jobs.csv`.
   - For each job:
     - If `badge === 0` or the job's `languages_required_english` contains "Cantonese" → mark as "Not suitable – Cantonese required" with match score 0.
     - Otherwise, compute a match score based on whether the user has the required languages (ignoring Cantonese if not required). Simple logic:
       - 100% if user has all languages mentioned in `languages_required_english` (e.g., if job requires "English, Mandarin" and user has both).
       - 70% if user has at least one but missing some.
       - 50% if user has English only but job requires Mandarin as well.
       - 0% if user has none of the required languages.
     - Also store a short reason (e.g., "Missing Mandarin").
   - Sort jobs by match score descending.

4. Render an HTML response page showing:
   - The detected languages (allow the user to manually edit them with checkboxes and a "Re‑match" button that resubmits the same CV text with manual overrides).
   - A table/list of matched jobs with:
     - Job title (clickable link to URL)
     - Company
     - 🟢 badge if `badge === 1`, otherwise ❌ or nothing
     - Match score (percentage with progress bar or colored badge)
     - Reason text
   - Filtering option: show only jobs with score > 0.

5. The server should:
   - Use ES modules (`"type": "module"` in package.json).
   - Use `express`, `multer` for file upload, `pdf-parse`, `csv-parser`, and `axios` for DeepSeek calls.
   - Read the DeepSeek API key from a `.env` file (`token`).
   - Reuse the same DeepSeek calling function as in translate.js (or share a common module).
   - Store uploaded CVs temporarily in `/tmp` or delete after processing.

6. The design should be clean and modern – Claude Code can choose any CSS framework or plain CSS. Make it responsive and professional.

7. **Do not create separate frontend JavaScript files for API calls** – everything should be server‑rendered. Use HTML forms and server‑side rendering (e.g., embedded HTML templates or EJS). However, you can include a small amount of inline JavaScript for the manual language editing and re‑matching (but that still sends a POST request to the server).

8. The final output should be all necessary files:
   - `server.js`
   - `public/index.html` (or just serve from a template string inside server.js – simpler)
   - `package.json`
   - `.env.example`

Make sure the server runs on port 3000 with `yarn start`.

The goal is to have a working platform where a non‑Chinese speaking user uploads their CV, DeepSeek tells us what languages they know, and we show them which Hong Kong jobs are suitable (and which require Cantonese).
