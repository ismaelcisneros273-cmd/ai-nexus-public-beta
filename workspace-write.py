"""One-file, compare-and-swap write confined to an authorized directory fd."""
import hashlib
import json
import os
import re
import stat
import sys
import uuid

BLOCKED = re.compile(r'(^\.|(?:^|[-_.])(env|secret|secrets|credential|credentials|token|tokens|password|passwd|key|keys|auth|private|local)(?:$|[-_.])|\.(pem|p12|p8|key)$|^id_(rsa|ed25519)|^(node_modules|vendor|dist|build)$)', re.I)
EXTENSIONS = {'.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.html', '.css', '.scss', '.yaml', '.yml', '.toml', '.swift', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.sh'}
DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def write_one(data):
    parts = data['path'].split('/')
    if not parts or any(not part or part in ('.', '..') or BLOCKED.search(part) for part in parts):
        return {'status': 'invalid-path'}
    if os.path.splitext(parts[-1])[1].lower() not in EXTENSIONS:
        return {'status': 'invalid-path'}
    inspect = data.get('mode') == 'inspect'
    replacement = b'' if inspect else data['content'].encode('utf-8')
    if len(replacement) > 16384:
        return {'status': 'too-large'}
    root = os.open(data['root'], DIR)
    try:
        root_info = os.fstat(root)
        if root_info.st_dev != data['device'] or root_info.st_ino != data['inode']:
            return {'status': 'changed'}
        parent = os.dup(root)
        try:
            for part in parts[:-1]:
                child = os.open(part, DIR, dir_fd=parent)
                os.close(parent)
                parent = child
            target = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            try:
                before = os.fstat(target)
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 16384:
                    return {'status': 'invalid-file'}
                original = bytearray()
                while len(original) <= 16384:
                    chunk = os.read(target, 16385 - len(original))
                    if not chunk:
                        break
                    original.extend(chunk)
                after = os.fstat(target)
                if len(original) > 16384 or before.st_ino != after.st_ino or before.st_mtime_ns != after.st_mtime_ns:
                    return {'status': 'changed'}
                current_hash = hashlib.sha256(original).hexdigest()
                if inspect:
                    return {'status': 'present', 'sha256': current_hash}
                if current_hash != data['expected']:
                    return {'status': 'changed'}
            finally:
                os.close(target)
            temp_name = '.ai-nexus-' + uuid.uuid4().hex + '.tmp'
            tmp = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            try:
                os.fchmod(tmp, stat.S_IMODE(before.st_mode) & 0o700)
                position = 0
                while position < len(replacement):
                    position += os.write(tmp, replacement[position:])
                os.fsync(tmp)
            finally:
                os.close(tmp)
            try:
                current = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                if current.st_ino != before.st_ino or current.st_dev != before.st_dev or current.st_mtime_ns != before.st_mtime_ns:
                    return {'status': 'changed'}
                os.replace(temp_name, parts[-1], src_dir_fd=parent, dst_dir_fd=parent)
                os.fsync(parent)
                temp_name = None
                return {'status': 'applied', 'sha256': hashlib.sha256(replacement).hexdigest()}
            finally:
                if temp_name:
                    os.unlink(temp_name, dir_fd=parent)
        finally:
            os.close(parent)
    finally:
        os.close(root)


try:
    print(json.dumps(write_one(json.loads(sys.stdin.read(50000)))))
except Exception:
    print(json.dumps({'status': 'failed'}))
