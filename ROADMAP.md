# Gallery Scorer — Roadmap
**METAL GALLERY — Birthday Edition**

## Scorecard format (from reference image)
- One card per voter; voter writes their name at the top
- Columns 1–18 = artwork numbers
- Rows: How metal? / Creativity / Execution / Would buy / Total
- Scores 0–10 per category; Total = sum of 4 categories (0–40)
- 2 cards printed per A4 page

## Stack
- **Frontend**: PWA (HTML/CSS/vanilla JS) — installable on Android, camera access, IndexedDB local storage
- **Backend**: Flask + Claude Vision API — extracts scores from scorecard photos

---

## Phase 1 — Project scaffold
- [ ] Flask app skeleton (`app.py`, `requirements.txt`)
- [ ] PWA shell (`index.html`, `manifest.json`, `service-worker.js`)
- [ ] Basic mobile-first CSS

## Phase 2 — Camera + local storage
- [ ] Camera capture UI (open camera, preview shot, confirm/retake)
- [ ] Prompt user to enter voter name before saving (or rely on Claude to read it)
- [ ] IndexedDB wrapper: save, list, delete scorecard photos + metadata
- [ ] Gallery view: see all captured cards with voter names

## Phase 3 — Score extraction
- [ ] Flask endpoint: receives image, calls Claude Vision API
- [ ] Claude prompt: extract voter name + scores for artworks 1–18 across all 4 categories
- [ ] Return structured JSON:
  ```json
  {
    "voter": "Alice",
    "scores": {
      "1": { "how_metal": 7, "creativity": 8, "execution": 6, "would_buy": 5 },
      "2": { ... },
      ...
    }
  }
  ```
- [ ] Handle partially filled cards (not all 18 artworks may be rated)
- [ ] Frontend: "Process all" button — sends each stored image to backend

## Phase 4 — Results & statistics
- [ ] Aggregate scores across all processed cards
- [ ] Results page:
  - **Overall winner** — artwork with highest average total across all voters
  - **Category winners** — top artwork per category (How metal / Creativity / Execution / Would buy)
  - **Most generous voter** — highest average score given across all artworks & categories
  - **Least generous voter** — lowest average score given
- [ ] Per-artwork breakdown table (averages per category, ranked)
- [ ] Per-voter summary

## Phase 5 — Polish
- [ ] PWA install prompt on Android ("Add to Home Screen")
- [ ] Offline-friendly (service worker caches app shell)
- [ ] Export / share results (copy to clipboard or screenshot-friendly layout)
