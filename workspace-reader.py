"""Bounded read-only scanner. Every descendant is opened relative to a directory fd."""
import json
import os
import re
import stat
import sys

EXTENSIONS = {'.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx',
              '.mjs', '.cjs', '.py', '.html', '.css', '.scss', '.yaml', '.yml',
              '.toml', '.swift', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.sh'}
BLOCKED = re.compile(r'(^\.|(?:^|[-_.])(env|secret|secrets|credential|credentials|token|tokens|password|passwd|key|keys|auth|private|local)(?:$|[-_.])|\.(pem|p12|p8|key)$|^id_(rsa|ed25519)|^(node_modules|vendor|dist|build)$)', re.I)
SENSITIVE = re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*[\x22\x27]?[A-Za-z0-9_./+\-=]{12,}', re.I)
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
MAX_BYTES = 128 * 1024


def safe(name):
    return bool(name) and name not in ('.', '..') and '/' not in name and '\x00' not in name and not BLOCKED.search(name)


def open_relative(root_fd, parts, directory=False):
    current = os.dup(root_fd)
    try:
        for index, part in enumerate(parts):
            if not safe(part):
                raise ValueError('Unsafe path')
            flags = DIRECTORY if directory or index < len(parts) - 1 else os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            next_fd = os.open(part, flags, dir_fd=current)
            os.close(current)
            current = next_fd
        result, current = current, None
        return result
    finally:
        if current is not None:
            os.close(current)


def scan(data):
    root_fd = os.open(data['path'], DIRECTORY)
    try:
        root = os.fstat(root_fd)
        if root.st_dev != data['device'] or root.st_ino != data['inode']:
            raise ValueError('Workspace changed')
        queue, paths, folders, examined = [()], [], 0, 0
        while queue and folders < 80 and len(paths) < 600 and examined < 2000:
            parts = queue.pop(0)
            folders += 1
            try:
                directory_fd = open_relative(root_fd, parts, True)
            except (OSError, ValueError):
                continue
            try:
                with os.scandir(directory_fd) as entries:
                    for entry in entries:
                        examined += 1
                        if examined > 2000 or len(paths) >= 600:
                            break
                        if not safe(entry.name) or entry.is_symlink():
                            continue
                        child = parts + (entry.name,)
                        if len('/'.join(child)) > 500:
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            if len(queue) + folders < 80:
                                queue.append(child)
                        elif entry.is_file(follow_symlinks=False) and os.path.splitext(entry.name)[1].lower() in EXTENSIONS:
                            paths.append(child)
            finally:
                os.close(directory_fd)
        words = [word for word in re.findall(r'[\w-]{2,}', data.get('query', '').lower()) if len(word) < 40][:12]
        paths.sort(key=lambda parts: -sum(word in '/'.join(parts).lower() for word in words))
        matches = []
        for parts in paths[:120]:
            fd = None
            try:
                fd = open_relative(root_fd, parts)
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_BYTES:
                    continue
                content = bytearray()
                while len(content) <= MAX_BYTES:
                    chunk = os.read(fd, min(16384, MAX_BYTES + 1 - len(content)))
                    if not chunk:
                        break
                    content.extend(chunk)
                after = os.fstat(fd)
                if len(content) > MAX_BYTES or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    continue
                text = bytes(content).decode('utf-8')
                if SENSITIVE.search(text):
                    continue
                path = '/'.join(parts)
                score = sum((6 if word in path.lower() else 0) + (2 if word in text.lower() else 0) for word in words)
                score += 2 if parts[-1].lower().startswith('readme') else 1 if path == 'package.json' else 0
                matches.append((score, path, text))
            except (OSError, ValueError, UnicodeError):
                continue
            finally:
                if fd is not None:
                    os.close(fd)
        matches.sort(key=lambda item: (-item[0], item[1]))
        selected, budget = [], 16000
        for _, path, text in matches[:8]:
            if budget <= 0:
                break
            excerpt = text[:min(3000, budget)]
            budget -= len(excerpt)
            selected.append({'path': path, 'text': excerpt, 'truncated': len(excerpt) < len(text)})
        return {'tree': sorted('/'.join(parts) for parts in paths[:100]),
                'treeTruncated': len(paths) > 100 or examined >= 2000 or bool(queue), 'files': selected}
    finally:
        os.close(root_fd)


try:
    print(json.dumps(scan(json.loads(sys.stdin.read(8192))), ensure_ascii=False))
except Exception:
    # No paths or file contents in diagnostics.
    print('Workspace read failed', file=sys.stderr)
    sys.exit(1)
