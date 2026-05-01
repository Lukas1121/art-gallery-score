const PIN = '2210';

const CAT_LABELS = {
  how_metal: 'How metal?',
  creativity: 'Creativity',
  execution: 'Execution',
  would_buy: 'Would buy'
};

let cards = [];
let capturedImage = null;
let currentCard = null;
let cameraStream = null;

// ---- Init ----

window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js');
  }

  if (sessionStorage.getItem('authed')) {
    showScreen('home');
    loadCards();
  }

  document.getElementById('pin-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') checkPin();
  });

  document.getElementById('file-input').addEventListener('change', handleFileSelect);

});

// ---- PIN ----

function checkPin() {
  const val = document.getElementById('pin-input').value;
  if (val === PIN) {
    sessionStorage.setItem('authed', '1');
    showScreen('home');
    loadCards();
  } else {
    document.getElementById('pin-error').classList.remove('hidden');
    document.getElementById('pin-input').value = '';
  }
}

// ---- Navigation ----

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById('screen-' + name).classList.remove('hidden');
}

// ---- Cards ----

async function loadCards() {
  try {
    const res = await fetch('/api/cards');
    cards = await res.json();
    renderCardList();
  } catch (err) {
    console.error('Failed to load cards:', err);
  }
}

function renderCardList() {
  const list = document.getElementById('card-list');
  const countEl = document.getElementById('card-count');
  const banner = document.getElementById('warning-banner');

  countEl.textContent = cards.length + (cards.length === 1 ? ' card' : ' cards');
  const hasWarnings = cards.some(c => c.status === 'needs_review');
  banner.classList.toggle('hidden', !hasWarnings);

  if (cards.length === 0) {
    list.innerHTML = '<p class="empty-state">No cards scanned yet</p>';
    return;
  }

  list.innerHTML = '';
  cards.forEach(card => {
    const isReview = card.status === 'needs_review';
    const el = document.createElement('div');
    el.className = 'card-item';
    el.innerHTML = `
      <div class="card-info">
        <div class="card-voter">${esc(card.voter)}</div>
        <span class="badge badge-${isReview ? 'review' : 'complete'}">
          ${isReview ? 'Needs review' : 'Complete'}
        </span>
      </div>
      <div class="card-actions">
        ${isReview ? `<button class="btn-secondary btn-sm" onclick="openReview('${card.id}')">Fix</button>` : ''}
        <button class="btn-danger" onclick="deleteCard('${card.id}')">Delete</button>
      </div>
    `;
    list.appendChild(el);
  });
}

async function deleteCard(id) {
  if (!confirm('Delete this card?')) return;
  await fetch('/api/cards/' + id, { method: 'DELETE' });
  await loadCards();
}

function openReview(id) {
  const card = cards.find(c => c.id === id);
  if (card) showReviewScreen(card);
}

// ---- Capture ----

async function triggerCapture() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280, max: 1280 },
        height: { ideal: 960,  max: 960  }
      },
      audio: false
    });
    cameraStream = stream;
    const video = document.getElementById('camera-video');
    video.srcObject = stream;
    showScreen('camera');
  } catch (err) {
    // Fallback for browsers that block getUserMedia (e.g. non-HTTPS desktop)
    document.getElementById('file-input').click();
  }
}

function closeCamera() {
  stopCamera();
  showScreen('home');
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

function captureFrame() {
  const video = document.getElementById('camera-video');
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  capturedImage = canvas.toDataURL('image/jpeg', 0.85);
  stopCamera();
  document.getElementById('preview-img').src = capturedImage;
  showScreen('preview');
}

// Gallery — bulk import, no preview
async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  e.target.value = '';

  showScreen('processing');

  for (let i = 0; i < files.length; i++) {
    document.querySelector('.processing-text').textContent =
      files.length > 1 ? `Processing ${i + 1} of ${files.length}...` : 'Reading scorecard...';

    try {
      const image = await compressImage(files[i]);
      await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image })
      });
    } catch (err) {
      // Skip failed cards silently — they'll be missing from the list
    }
  }

  document.querySelector('.processing-text').textContent = 'Reading scorecard...';
  await loadCards();
  showScreen('home');
}

function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function retakePhoto() {
  capturedImage = null;
  showScreen('home');
}

async function acceptPhoto() {
  showScreen('processing');
  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: capturedImage })
    });
    const card = await res.json();

    if (card.error) {
      alert('Error: ' + card.error);
      showScreen('home');
      return;
    }

    await loadCards();

    if (card.status === 'needs_review') {
      showReviewScreen(card);
    } else {
      showScreen('home');
    }
  } catch (err) {
    alert('Processing failed: ' + err.message);
    showScreen('home');
  }
}

// ---- Review ----

function showReviewScreen(card) {
  currentCard = JSON.parse(JSON.stringify(card));
  document.getElementById('review-voter').value = card.voter;

  const container = document.getElementById('warning-inputs');
  container.innerHTML = '';

  let parsed = 0;

  card.warnings.forEach(w => {
    const match = w.match(/^artwork_(\d+)_(.+)$/);
    if (!match) return;
    const [, artworkNum, category] = match;
    if (!CAT_LABELS[category]) return;

    parsed++;
    const div = document.createElement('div');
    div.className = 'warning-field';
    div.innerHTML = `
      <label>Artwork ${artworkNum} — ${CAT_LABELS[category]}</label>
      <input type="number" min="0" max="10" step="1"
        data-artwork="${artworkNum}"
        data-category="${category}"
        placeholder="0–10">
    `;
    container.appendChild(div);
  });

  // Fallback: if warnings exist but none matched the expected format,
  // show the raw warning text so the user knows what Claude flagged.
  if (card.warnings.length > 0 && parsed === 0) {
    const note = document.createElement('p');
    note.className = 'review-info';
    note.style.color = '#e63946';
    note.textContent = 'Claude flagged issues but could not identify specific cells. Raw feedback:';
    container.appendChild(note);
    const ul = document.createElement('ul');
    ul.style.cssText = 'color:#888;font-size:.9rem;padding-left:20px;margin-top:8px;';
    card.warnings.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  showScreen('review');
}

async function saveReview() {
  const inputs = document.querySelectorAll('#warning-inputs input[type="number"]');
  const scores = JSON.parse(JSON.stringify(currentCard.scores));

  for (const input of inputs) {
    const val = parseInt(input.value);
    if (isNaN(val) || val < 0 || val > 10) {
      alert('Enter a valid score (0–10) for each flagged cell');
      input.focus();
      return;
    }
    const { artwork, category } = input.dataset;
    if (!scores[artwork]) scores[artwork] = {};
    scores[artwork][category] = val;
  }

  const voter = document.getElementById('review-voter').value.trim() || currentCard.voter;

  try {
    await fetch('/api/cards/' + currentCard.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voter, scores })
    });
    await loadCards();
    showScreen('home');
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

// ---- Results ----

async function showResults() {
  const pending = cards.filter(c => c.status === 'needs_review');
  if (pending.length > 0) {
    if (!confirm(`${pending.length} card(s) still need review. Show results using only completed cards?`)) return;
  }

  if (cards.filter(c => c.status === 'complete').length === 0) {
    alert('No completed cards yet.');
    return;
  }

  try {
    const res = await fetch('/api/results');
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    renderResults(data);
    showScreen('results');
  } catch (err) {
    alert('Failed to load results: ' + err.message);
  }
}

function renderResults(data) {
  const container = document.getElementById('results-content');

  const artworks = Object.entries(data.artwork_breakdown)
    .sort((a, b) => b[1].total - a[1].total);

  const rankingRows = artworks.map(([num, s], i) => `
    <tr class="${i === 0 ? 'top-row' : ''}">
      <td>#${num}</td>
      <td>${s.how_metal}</td>
      <td>${s.creativity}</td>
      <td>${s.execution}</td>
      <td>${s.would_buy}</td>
      <td>${s.total}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="result-card highlight">
      <div class="result-label">Overall Winner</div>
      <div class="result-value">Artwork #${data.overall_winner.artwork}</div>
      <div class="result-sub">Average total: ${data.overall_winner.score} / 40</div>
    </div>

    <div>
      <div class="section-label">Category Winners</div>
      <div class="categories-grid">
        ${Object.entries(data.category_winners).map(([cat, w]) => `
          <div class="result-card">
            <div class="result-label">${CAT_LABELS[cat]}</div>
            <div class="result-value">#${w.artwork}</div>
            <div class="result-sub">Avg: ${w.score}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div>
      <div class="section-label">Voter Generosity</div>
      <div class="voter-grid">
        <div class="result-card">
          <div class="result-label">Most Generous</div>
          <div class="result-value" style="font-size:1.3rem;">${esc(data.most_generous.voter)}</div>
          <div class="result-sub">Total points given: ${data.most_generous.total}</div>
        </div>
        <div class="result-card">
          <div class="result-label">Least Generous</div>
          <div class="result-value" style="font-size:1.3rem;">${esc(data.least_generous.voter)}</div>
          <div class="result-sub">Total points given: ${data.least_generous.total}</div>
        </div>
      </div>
    </div>

    <div class="result-card">
      <div class="result-label">Full Ranking</div>
      <table class="result-table">
        <thead>
          <tr>
            <th>Art</th>
            <th>Metal</th>
            <th>Creative</th>
            <th>Exec</th>
            <th>Buy</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${rankingRows}</tbody>
      </table>
    </div>
  `;
}

// ---- Utils ----

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
