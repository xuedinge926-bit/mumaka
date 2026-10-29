"""Reproduce browser JSON from frozen V0.19 reference inputs (stdlib only).
Run at repository root: python3 scripts/extract_model.py
The original sources are never changed. No weights or rubric are inferred.
"""
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'docs/reference-supplement'
OUTPUT = ROOT / 'src/data'
DIMENSIONS = ['lyrics', 'composition', 'performance', 'sound', 'vision', 'context']


def rows(filename):
    with (SOURCE / 'data' / filename).open(encoding='utf-8-sig', newline='') as file:
        return list(csv.DictReader(file))


def write(name, data):
    (OUTPUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


genres = [dict(id=r['genre_id'], nameEn=r['name_en'], name=r['name_zh'], status=r['status'],
               weights=[int(r[k]) for k in DIMENSIONS], parentId=r['parent_id'], note=r['note'],
               validation=r['weight_validation'], orientationReason=r['orientation_reason'])
          for r in rows('genre-weights-v0.17-frozen.csv')]
index = [dict(id=r['entry_id'], name=r['display_name'], group=r['group'], genreId=r['global_genre_id'],
              status=r['usage_state'], kind=r['entry_type'], criteria=r['criteria'],
              insufficient=r['not_sufficient'], verification=r['usage_research'])
         for r in rows('CHINA_MARKET_INDEX_33.csv')]
assert len(genres) == 558 and len({g['id'] for g in genres}) == 558
assert len(index) == 33 and len({i['genreId'] for i in index}) == 32
assert all(sum(g['weights']) == 100 and sum(g['weights'][:4]) == 70 and g['weights'][4:] == [15, 15] for g in genres)
assert all(i['genreId'] in {g['id'] for g in genres} for i in index)
write('genres.json', genres)
write('china-index.json', index)
for source, target in [('MODEL_POLICY_V019.json', 'policy.json'), ('source-correction-policy-v0.16.json', 'source-policy.json'), ('data/GOLDEN_CALC_FIXTURES.json', 'golden-fixtures.json')]:
    (OUTPUT / target).write_bytes((SOURCE / source).read_bytes())

handbook = (SOURCE / 'data/HANDBOOK_V0.16_BASELINE.md').read_text(encoding='utf-8')
rubric = {}
for title, body in re.findall(r'^### (.+?)\n\n(.*?)(?=^### |^## D\.|\Z)', handbook, re.S | re.M):
    if ' · ' not in title or title.split(' · ')[1].strip() not in DIMENSIONS:
        continue
    dimension = title.split(' · ')[1].strip()
    levels = [dict(star=float(star), label=label, criteria=criteria) for star, label, criteria in re.findall(r'\| ([0-5]\.\d) \| (.*?) \| (.*?) \|', body)]
    assert len(levels) == 10
    rubric[dimension] = dict(definition=body.split('\n\n')[0], question=re.search(r'\*\*核心问题：\*\*(.*)', body).group(1), boundary=re.search(r'\*\*边界：\*\*(.*)', body).group(1), levels=levels)
assert len(rubric) == 6
write('rubric.json', rubric)

manifest = json.loads((OUTPUT / 'provenance.json').read_text(encoding='utf-8'))
manifest['sourceFiles'] = {str(f.relative_to(ROOT / 'docs')): hashlib.sha256(f.read_bytes()).hexdigest()
                         for f in (ROOT / 'docs').rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix != '.pyc'}
manifest['baseDataSha256'] = hashlib.sha256((SOURCE / 'data/genre-weights-v0.17-frozen.csv').read_bytes()).hexdigest()
assert manifest['baseDataSha256'] == json.loads((SOURCE / 'data/VERSION_MANIFEST.json').read_text())['global_base_sha256']
manifest['policySha256'] = hashlib.sha256((SOURCE / 'MODEL_POLICY_V019.json').read_bytes()).hexdigest()
write('provenance.json', manifest)
print('Verified: 558 frozen weights, 33 entries → 32 global IDs, 60 verbatim rubric levels, source SHA256.')
