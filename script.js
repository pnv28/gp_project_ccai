const searchInput = document.getElementById("jobSearch");
const clearButton = document.getElementById("clearSearch");
const resultCount = document.getElementById("resultCount");
const jobList = document.getElementById("jobList");
const cvUpload = document.getElementById("cvUpload");

function formatScore(score) {
  return `${score}% match`;
}

function renderJobs(jobs) {
  jobList.innerHTML = jobs.map((job) => {
    const badgeText = job.englishFriendly ? "\u{1F7E2} English-friendly" : "\u26AA Local language likely";
    return `
      <article class="job-card">
        <div class="job-header">
          <div>
            <h2 class="job-title">${job.title}</h2>
            <p class="job-company">${job.company}</p>
          </div>
          <span class="badge">${badgeText}</span>
        </div>
        <p class="job-description">${job.description}</p>
        <div class="match-score">
          <span>Match score</span>
          <span class="score-pill">${formatScore(job.matchScore)}</span>
        </div>
      </article>
    `;
  }).join("");
}

function updateResultCount(count, total) {
  if (count === total) {
    resultCount.textContent = `${count} jobs available`;
  } else if (count === 0) {
    resultCount.textContent = "No results match your search.";
  } else {
    resultCount.textContent = `${count} out of ${total} jobs match your search.`;
  }
}

function filterJobs(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return jobData;
  }
  return jobData.filter((job) => {
    return [job.title, job.company, job.description]
      .some((field) => field.toLowerCase().includes(normalized));
  });
}

function refresh() {
  const filtered = filterJobs(searchInput.value);
  renderJobs(filtered);
  updateResultCount(filtered.length, jobData.length);
}

searchInput.addEventListener("input", refresh);
clearButton.addEventListener("click", () => {
  searchInput.value = "";
  refresh();
});
cvUpload.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    document.querySelector(".upload-card span").textContent = `CV uploaded: ${file.name}`;
  }
});

window.addEventListener("DOMContentLoaded", refresh);
