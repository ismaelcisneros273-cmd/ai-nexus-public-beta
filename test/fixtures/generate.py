"""Regenerate small, synthetic attachment fixtures without personal content.

Run on macOS: python3 test/fixtures/generate.py
For WebP, add --webp with Pillow 11.2.1 available on PYTHONPATH.
The Pillow wheel used for this fixture came from PyPI, SHA-256:
8b02d8f9cb83c52578a0b4beadba92e37d83a4ef11570a8688bbf43f4ca50909
Generation itself makes no network request and uses no personal input.
"""
from pathlib import Path
import struct
import subprocess
import sys
import zlib


HERE = Path(__file__).resolve().parent


def pdf(pages):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", None]
    kids = []
    font_id = 3 + len(pages) * 2
    for number, text in enumerate(pages):
        page_id = 3 + number * 2
        stream_id = page_id + 1
        kids.append(f"{page_id} 0 R")
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
            f"/Contents {stream_id} 0 R >>".encode("ascii")
        )
        content = (f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET" if text else "q Q").encode("ascii")
        objects.append(
            f"<< /Length {len(content)} >>\nstream\n".encode("ascii")
            + content + b"\nendstream"
        )
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>".encode("ascii")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, item in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{number} 0 obj\n".encode("ascii") + item + b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    result.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    )
    return bytes(result)


def png_chunk(kind, payload):
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def png():
    width, height = 2, 2
    rgba = bytes((165, 150, 173, 255)) * width
    rows = (b"\x00" + rgba) * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(rows))
        + png_chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    (HERE / "text.pdf").write_bytes(pdf(["Synthetic page one", "Synthetic page two"]))
    (HERE / "scanned.pdf").write_bytes(pdf([""]))
    (HERE / "tiny.png").write_bytes(png())
    subprocess.run(
        ["/usr/bin/sips", "-s", "format", "jpeg", str(HERE / "tiny.png"),
         "--out", str(HERE / "tiny.jpg")],
        check=True, stdout=subprocess.DEVNULL,
    )
    if "--webp" in sys.argv:
        from PIL import Image, features

        if not features.check("webp"):
            raise RuntimeError("Pillow was built without WebP support")
        Image.new("RGB", (2, 2), (165, 150, 173)).save(
            HERE / "tiny.webp", format="WEBP", lossless=True, method=0
        )
