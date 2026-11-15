"""Parse badge requirements out of `pdftotext -layout` output of the TSL Handbook.
Usage: python3 -I parse_handbook.py hb.txt out.json
Each top-level numbered requirement (with all of its lettered sub-parts) becomes one row."""
import json, re, sys

src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().split('\n')
footer = re.compile(r'^\s*(\d+\s+)?[A-Z][A-Z \'’&.-]+ BADGE(\s+\d+)?\s*$|^\s*\d+\s*$|^\s*[A-Z][A-Z \'’]+\s+\d+\s*$|^\s*\d+\s+[A-Z][A-Z \'’]+\s*$')
title_re = re.compile(r'^\s*([A-Z][A-Z \'’&.-]+?) BADGE\s*$')
req_hdr = re.compile(r'BADGE\s*$|^\s*REQUIREMENTS\s*$')
rows, badge, in_req, section, cur, nsec = [], None, False, '', None, 0

def flush():
    global cur
    if cur:
        txt = re.sub(r'\s+', ' ', cur['text']).strip()
        txt = re.sub(r'(\w)- (\w)', r'\1\2', txt)  # de-hyphenate line breaks
        cur['text'] = txt
        rows.append(cur)
    cur = None

i = 0
while i < len(lines):
    ln = lines[i]
    s = ln.strip()
    m = re.match(r'^\s*([A-Z][A-Z \'’&.-]+?) BADGE( REQUIREMENTS)?\s*$', ln)
    if m and (m.group(2) or (i + 1 < len(lines) and lines[i + 1].strip() == 'REQUIREMENTS')):
        flush()
        badge = m.group(1).strip().title().replace('’S', '’s').replace("'S", "'s")
        in_req, section, nsec = True, '', 0
        i += 1
        continue
    if not in_req:
        i += 1; continue
    if re.match(r'^For (additional|more|required)', s) or ('stren.life/' in s and not re.match(r'^\d', s)):
        flush(); in_req = False; i += 1; continue
    if re.match(r'^Complete .*(requirement|task)', s):
        flush(); nsec += 1
        section = 'Mandatory' if 'mandatory' in s.lower() else ('Elective' if nsec > 1 else '')
        i += 1; continue
    if footer.match(ln) or s == 'REQUIREMENTS' or s == '':
        i += 1; continue
    mm = re.match(r'^\s*(\d{1,2})\.\s+(.*)$', ln)
    if mm and len(ln) - len(ln.lstrip()) <= 2:
        flush()
        cur = {'badge': badge, 'section': section, 'number': int(mm.group(1)), 'text': mm.group(2)}
    elif cur is not None:
        sub = re.match(r'^\s*([a-z]|[ivx]+)\.\s+(.*)$', ln)
        cur['text'] += (' (' + sub.group(1) + ') ' + sub.group(2)) if sub else (' ' + s)
    i += 1
flush()

def slug(x): return re.sub(r'[^a-z0-9]+', '-', x.lower()).strip('-')
for r in rows:
    r['id'] = slug(r['badge']) + '-' + (r['section'][:1].lower() if r['section'] else '') + str(r['number'])
    r['label'] = (r['section'] + ' ' if r['section'] else 'Req ') + str(r['number'])
json.dump(rows, open(out, 'w'), ensure_ascii=False, indent=0)
print(len(rows), 'requirements across', len({r['badge'] for r in rows}), 'badges')
