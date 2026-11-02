"""Extract the authorized V0.38/0.38.1 model fields; never copy the workbook.

Usage: python3 scripts/import-v038.py SOURCE.xlsx --r3 REVIEW.xlsx --out catalog.json
Only identity labels come from the already public v035 catalog. All NEW weights
are read from the two source sheets, never inferred from a legacy weight vector.
"""
import argparse
import hashlib
import json
import posixpath
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def read_workbook(path):
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels = {e.get('Id'): e.get('Target') for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        result = {}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
            target = rels[sheet.get(RID)]
            part = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            rows = []
            for row in ET.fromstring(z.read(part)).findall('s:sheetData/s:row', NS):
                values = {'_row': int(row.get('r'))}
                for cell in row.findall('s:c', NS):
                    v = cell.find('s:v', NS)
                    inline = cell.find('s:is', NS)
                    value = v.text if v is not None else None
                    if cell.get('t') == 's' and value is not None:
                        value = strings[int(value)]
                    elif inline is not None:
                        value = ''.join(inline.itertext())
                    elif value is not None and cell.get('t') not in ('str', 'e', 'b'):
                        value = float(value)
                        value = int(value) if value.is_integer() else value
                    values[''.join(c for c in cell.get('r') if c.isalpha())] = value
                rows.append(values)
            result[sheet.get('name')] = rows
        return result


def ticks(row, columns):
    values = [row.get(c) for c in columns]
    if all(v is None for v in values):
        return None
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or v * 2 != int(v * 2) for v in values):
        raise ValueError(f'Non half-point weight at source row {row["_row"]}')
    out = [int(v * 2) for v in values]
    if any(v < 0 or v > 200 for v in out) or sum(out[:4]) != 140 or out[4:] != [30, 30]:
        raise ValueError(f'Invalid weights at source row {row["_row"]}')
    return out


def extract(source, r3=None):
    sheets = read_workbook(source)
    root = Path(__file__).resolve().parents[1]
    identities = json.loads((root / 'src/data/v035/families.v035.json').read_text())
    families = []
    family_rows = sheets['01一级68套'][1:]
    for f in identities:
        profiles = {}
        for category, name in [('song', '歌曲'), ('instrumental', '乐曲')]:
            row = next(r for r in family_rows if r.get('A') == f['id'] and r.get('B') == name)
            profiles[category] = {'weightsTicks': ticks(row, 'CDEFGH'), 'rationale': row.get('I', ''), 'sourceRow': row['_row']}
        families.append({'id': f['id'], 'name': f['name_zh'], 'nameEn': f['name_en'], 'profiles': profiles})
    modes = {category: sheets[name][1:] for category, name in [('song', '02歌曲565'), ('instrumental', '03乐曲565')]}
    records = {}
    for category, rows in modes.items():
        for row in rows:
            gid = row['B']
            if gid not in records:
                records[gid] = {'id': gid, 'name': row['C'], 'nameEn': row['D'], 'familyId': row['E'], 'classification': row['F'], 'profiles': {}}
            elif (records[gid]['name'], records[gid]['familyId'], records[gid]['classification']) != (row['C'], row['E'], row['F']):
                raise ValueError(f'Mode identity mismatch: {gid}')
            records[gid]['profiles'][category] = {
                'weightsTicks': ticks(row, 'IJKLMN'), 'applicability': row['G'],
                'trialAllowed': row['H'] == '是', 'source': row.get('Q', ''),
                'rationale': row.get('R', ''), 'reviewStatus': row['S'],
                'sourceSheet': '02歌曲565' if category == 'song' else '03乐曲565', 'sourceRow': row['_row'],
            }
    if len(families) != 34 or len(records) != 565 or any(len(r['profiles']) != 2 for r in records.values()):
        raise ValueError('Expected 34 families, 565 stable IDs and both independent modes')
    if sum(r['classification'] == 'index_only' for r in records.values()) != 43:
        raise ValueError('Expected 43 index-only records')
    if sum(r['classification'] == 'definition_review' for r in records.values()) != 5:
        raise ValueError('Expected 5 definition-review records')
    anchors = []
    for region, sheet in [('china', '04中文84格'), ('global', '05国际84格')]:
        for row in sheets[sheet][1:]:
            category = 'song' if row['B'] == '歌曲' else 'instrumental'
            anchors.append({
                'id': f'{region}-{category}-{row["D"]}-{int(row["E"] * 2)}',
                'region': region, 'category': category, 'dimension': row['C'], 'stars': row['E'],
                'album': row['F'], 'artist': row['G'], 'year': str(row['H']), 'feature': row.get('I', ''),
                'standard': row.get('J', ''), 'include': row.get('K', ''), 'exclude': row.get('L', ''),
                'lower': row.get('M', ''), 'upper': row.get('N', ''), 'comparison': row.get('O', ''),
                'risk': row.get('P', ''), 'listening': row.get('Q', ''), 'approved': False,
                'status': '研究候选·待整碟复核', 'version': 'v0.38.1', 'sourceSheet': sheet, 'sourceRow': row['_row'], 'sources': [],
            })
    r3_hash = None
    if r3:
        review = read_workbook(r3)
        rows = review['02候选与证据']
        # Header labels are resolved from the actual workbook, not an auxiliary JSON.
        header = next(r for r in rows if r.get('A') == 'ID' and r.get('B') == '维度')
        columns = {v: k for k, v in header.items() if k != '_row' and v is not None}
        def get(row, *labels):
            return next((row.get(columns[label]) or '' for label in labels if label in columns), '')
        for row in rows:
            if row['_row'] <= header['_row'] or not str(get(row, 'ID')).startswith('CN-'):
                continue
            dimension = get(row, '维度')
            star = get(row, '拟议档位')
            if not isinstance(star, (int, float)):
                raise ValueError(f'R3 stars missing, headers: {list(columns)}')
            anchor = next(a for a in anchors if a['region'] == 'china' and a['category'] == 'song' and a['dimension'] == dimension and a['stars'] == star)
            anchor.update({
                'album': get(row, '候选专辑', '专辑'), 'artist': get(row, '主艺人', '艺术家'),
                'year': str(get(row, '年份')), 'feature': get(row, '典型维度特征'),
                'evidence': get(row, '跨曲目线索（资料，非试听结论）'),
                'lower': get(row, '与低半星区分：待检验'), 'upper': get(row, '与高半星区分：待检验'),
                'comparison': get(row, '先比较的区间'), 'risk': get(row, '反例与判断边界'),
                'auditExtent': get(row, '整碟证据核到哪一步'), 'edition': get(row, '采用版本与口径'),
                'pending': get(row, '仍需完成的核验'), 'sourceText': get(row, '资料来源：名称、网址、支持范围、读取方式'),
                'status': get(row, '候选状态') or 'R3研究候选·待审',
                'listening': '未做完整试听', 'approved': False, 'version': 'v0.38.1-cn-r3',
                'sourceSheet': '02候选与证据', 'sourceRow': row['_row'],
                'unassigned': not bool(get(row, '主艺人')), 'standard': '拟议档位是比较起点，未锁定半星；整碟试听与审定尚未完成。',
            })
        r3_hash = hashlib.sha256(Path(r3).read_bytes()).hexdigest()
    return {'schemaVersion': 1, 'sourceVersion': 'v0.38.1', 'weightVersion': 'v0.38',
            'sourceSha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(), 'r3Sha256': r3_hash,
            'publicRelease': 'Extracted model fields authorized by the owner on 2026-11-02; research approval is separate.',
            'families': families, 'genres': list(records.values()), 'anchors': anchors}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--r3', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--split', action='store_true', help='Write reviewable small JSON modules instead of one large JSON')
    args = parser.parse_args()
    result = extract(args.source, args.r3)
    if args.split:
        args.out.mkdir(parents=True, exist_ok=True)
        def write(name, data):
            (args.out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        write('manifest.json', {k: v for k, v in result.items() if k not in ('families', 'genres', 'anchors')})
        write('families.json', result['families'])
        imports = ["import manifest from './manifest.json';", "import families from './families.json';"]
        groups = {}
        for key, size in [('genres', 20), ('anchors', 7)]:
            names = []
            for i in range(0, len(result[key]), size):
                name = f'{key}{i // size + 1:02d}'
                write(f'{name}.json', result[key][i:i + size])
                imports.append(f"import {name} from './{name}.json';")
                names.append('...' + name)
            groups[key] = ', '.join(names)
        (args.out / 'index.ts').write_text('\n'.join(imports) + '\nexport default { ...manifest, families, genres: [' + groups['genres'] + '], anchors: [' + groups['anchors'] + '] };\n')
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'families': len(result['families']), 'genres': len(result['genres']), 'anchors': len(result['anchors']), 'sourceSha256': result['sourceSha256']}))
