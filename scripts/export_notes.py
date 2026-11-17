"""Publish owner-authored, explicitly labelled notes; never execute issue text."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import requests

ROOT = Path(__file__).resolve().parents[1]
MARKER = re.compile(r'<!-- financial-note:\s*(\{[^\n]*\})\s*-->')


def accepted_note(issue, config, catalog):
    if ('pull_request' in issue or issue.get('state') != 'open'
            or issue.get('user', {}).get('id') != config['owner_id']
            or config['label'] not in [v.get('name') for v in issue.get('labels', [])]):
        return None
    body = issue.get('body') or ''
    matches = list(MARKER.finditer(body))
    if len(matches) != 1:
        return None
    try:
        target = json.loads(matches[0].group(1))
    except ValueError:
        return None
    if not isinstance(target, dict):
        return None
    kind, key = target.get('kind'), target.get('key')
    valid = ({s['code'] for s in catalog['stocks']} if kind == 'stock'
             else {g['id'] for g in catalog['groups']} if kind == 'industry' else set())
    if not isinstance(key, str) or key not in valid:
        return None
    number = int(issue['number'])
    return dict(number=number, kind=kind, key=key, title=issue.get('title') or '未命名心得',
                body=MARKER.sub('', body).strip(), created_at=issue['created_at'], updated_at=issue['updated_at'],
                url=f"https://github.com/{config['repository']}/issues/{number}")


def export(root=ROOT):
    config = json.loads((root/'notes-config.json').read_text(encoding='utf-8'))
    catalog = json.loads((root/'data/catalog.json').read_text(encoding='utf-8'))
    session = requests.Session()
    session.headers['Accept'] = 'application/vnd.github+json'
    if os.environ.get('GH_TOKEN'):
        session.headers['Authorization'] = 'Bearer '+os.environ['GH_TOKEN']
    notes, page = [], 1
    while True:
        response = session.get(f"https://api.github.com/repos/{config['repository']}/issues",
                               params=dict(creator=config['owner_login'], labels=config['label'],
                                           state='open', per_page=100, page=page, sort='created', direction='asc'), timeout=60)
        response.raise_for_status()
        issues = response.json()
        if not isinstance(issues, list):
            raise ValueError('Invalid notes response; preserving previous publication')
        for issue in issues:
            note = accepted_note(issue, config, catalog)
            if note is not None:
                notes.append(note)
        if len(issues) < 100:
            break
        page += 1
    notes.sort(key=lambda n: (n['updated_at'], n['number']), reverse=True)
    payload = dict(config=config, notes=notes, synced_at=datetime.now(timezone.utc).isoformat(timespec='seconds'))
    (root/'data/notes.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Published {len(notes)} owner-authored notes', flush=True)


if __name__ == '__main__':
    export()
