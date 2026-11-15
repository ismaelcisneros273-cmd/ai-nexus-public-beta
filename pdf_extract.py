"""Isolated PDF text extraction for AI Nexus. Input is PDF bytes on stdin."""
import io
import json
import os
import resource
import sys
from pathlib import Path

resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
sys.path.insert(0, str(Path(__file__).resolve().parent / 'vendor'))
from pypdf import PdfReader  # noqa: E402

try:
    reader = PdfReader(io.BytesIO(sys.stdin.buffer.read()), strict=True)
    if reader.is_encrypted:
        raise ValueError('encrypted')
    total = len(reader.pages)
    parts = []
    length = 0
    truncated = total > 30
    for number, page in enumerate(reader.pages[:30], 1):
        text = ' '.join((page.extract_text() or '').split())
        if text:
            entry = f'[第 {number} 页]\n{text}\n'
            parts.append(entry[:max(0, 12000-length)])
            length += len(entry)
        if length >= 12000:
            truncated = True
            break
    content = ''.join(parts).strip()
    print(json.dumps({'text': content, 'pageCount': total, 'truncated': truncated}, ensure_ascii=False))
except Exception:
    print(json.dumps({'error': 'parse_failed'}))
    sys.exit(1)
