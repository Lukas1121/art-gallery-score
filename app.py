import os
import re
import uuid
import json
import anthropic
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='')
client = anthropic.Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))

# In-memory card store — persists for the lifetime of the server process
cards = {}

EXTRACT_PROMPT = """Extract data from this Metal Gallery voting scorecard image.

The card has:
- A "Voter:" field at the top with a handwritten name
- Columns numbered 1-18 representing artwork numbers
- Rows: "How metal?", "Creativity", "Execution", "Would buy", "Total"
- Handwritten scores from 0-10 in each cell

Instructions:
- Read the voter name from the "Voter:" field
- Extract scores for every artwork column that has values filled in
- Skip completely empty columns or columns that are crossed out
- Ignore the "Total" row entirely — do not extract it
- If a cell is illegible or unclear, omit it from the scores object and add it to warnings

Warning format rules — CRITICAL:
- Warnings MUST use EXACTLY this format: artwork_N_category
- N is the artwork number (integer), category is one of: how_metal, creativity, execution, would_buy
- Valid examples: "artwork_3_how_metal", "artwork_7_would_buy", "artwork_12_creativity", "artwork_1_execution"
- Do NOT write free text in warnings. Only use the artwork_N_category format.
- If the entire card is blank, return empty scores {} and empty warnings []

Category key mapping:
- "How metal?" → how_metal
- "Creativity" → creativity
- "Execution" → execution
- "Would buy" → would_buy

Return ONLY valid JSON with no markdown, no explanation, no code block:
{
  "voter": "handwritten name",
  "scores": {
    "1": {"how_metal": 7, "creativity": 8, "execution": 6, "would_buy": 5},
    "2": {"how_metal": 4, "creativity": 7, "execution": 5, "would_buy": 2}
  },
  "warnings": ["artwork_5_how_metal", "artwork_9_would_buy"]
}"""


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/process', methods=['POST'])
def process_card():
    data = request.get_json()
    image_data = data.get('image', '')
    if ',' in image_data:
        image_data = image_data.split(',')[1]

    if not image_data:
        return jsonify({'error': 'No image provided'}), 400

    try:
        msg = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=2048,
            messages=[{
                'role': 'user',
                'content': [
                    {
                        'type': 'image',
                        'source': {
                            'type': 'base64',
                            'media_type': 'image/jpeg',
                            'data': image_data
                        }
                    },
                    {'type': 'text', 'text': EXTRACT_PROMPT}
                ]
            }]
        )

        response_text = msg.content[0].text.strip()
        # Strip markdown code fences if Claude wraps the response
        response_text = re.sub(r'^```(?:json)?\s*', '', response_text)
        response_text = re.sub(r'\s*```$', '', response_text)

        extracted = json.loads(response_text)
        scores = extracted.get('scores', {})
        warnings = extracted.get('warnings', [])

        if not scores and not warnings:
            return jsonify({'error': 'Card appears blank — no scores found. Make sure the card is filled in and the photo is clear.'}), 400

        card_id = str(uuid.uuid4())
        card = {
            'id': card_id,
            'voter': extracted.get('voter', 'Unknown'),
            'scores': scores,
            'warnings': warnings,
            'status': 'needs_review' if warnings else 'complete'
        }
        cards[card_id] = card
        return jsonify(card)

    except json.JSONDecodeError as e:
        return jsonify({'error': 'Could not parse scorecard data: ' + str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cards', methods=['GET'])
def get_cards():
    return jsonify(list(cards.values()))


@app.route('/api/cards/<card_id>', methods=['DELETE'])
def delete_card(card_id):
    cards.pop(card_id, None)
    return jsonify({'success': True})


@app.route('/api/cards/<card_id>', methods=['PUT'])
def update_card(card_id):
    if card_id not in cards:
        return jsonify({'error': 'Card not found'}), 404
    data = request.get_json()
    cards[card_id].update({
        'voter': data.get('voter', cards[card_id]['voter']),
        'scores': data.get('scores', cards[card_id]['scores']),
        'warnings': [],
        'status': 'complete'
    })
    return jsonify(cards[card_id])


@app.route('/api/results', methods=['GET'])
def get_results():
    completed = [c for c in cards.values() if c['status'] == 'complete']
    if not completed:
        return jsonify({'error': 'No completed cards to calculate results from'}), 400

    artwork_data = {}
    voter_all_scores = {}

    for card in completed:
        voter = card['voter']
        voter_all_scores.setdefault(voter, [])
        for artwork_num, cats in card['scores'].items():
            artwork_data.setdefault(
                artwork_num,
                {k: [] for k in ['how_metal', 'creativity', 'execution', 'would_buy']}
            )
            for cat, score in cats.items():
                if score is not None and cat in artwork_data[artwork_num]:
                    artwork_data[artwork_num][cat].append(score)
                    voter_all_scores[voter].append(score)

    def avg(lst):
        return round(sum(lst) / len(lst), 2) if lst else 0

    artwork_averages = {
        num: {
            **{cat: avg(scores) for cat, scores in cats.items()},
            'total': round(sum(avg(scores) for scores in cats.values()), 2)
        }
        for num, cats in artwork_data.items()
    }

    overall_winner = max(artwork_averages.items(), key=lambda x: x[1]['total'])
    category_winners = {
        cat: max(artwork_averages.items(), key=lambda x: x[1].get(cat, 0))
        for cat in ['how_metal', 'creativity', 'execution', 'would_buy']
    }
    voter_avgs = {v: avg(scores) for v, scores in voter_all_scores.items()}
    most_g = max(voter_avgs.items(), key=lambda x: x[1])
    least_g = min(voter_avgs.items(), key=lambda x: x[1])

    return jsonify({
        'overall_winner': {'artwork': overall_winner[0], 'score': overall_winner[1]['total']},
        'category_winners': {
            cat: {'artwork': w[0], 'score': w[1][cat]}
            for cat, w in category_winners.items()
        },
        'most_generous': {'voter': most_g[0], 'avg': most_g[1]},
        'least_generous': {'voter': least_g[0], 'avg': least_g[1]},
        'artwork_breakdown': artwork_averages,
        'voter_breakdown': voter_avgs
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
