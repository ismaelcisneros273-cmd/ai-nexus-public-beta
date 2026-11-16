# Third-party notices

AI Nexus bundles a local copy of `pypdf` 6.10.0 for text extraction from PDFs. Its BSD 3-Clause license text is retained at `vendor/pypdf-LICENSE`.

Several files within that upstream copy contain additional material. Their original notices remain in the corresponding source files:

- `vendor/pypdf/_utils.py`: a class adapted from Django, with the Django BSD notice.
- `vendor/pypdf/_codecs/_codecs.py`: LZW decoding adapted from PDFsharp, with empira Software's MIT notice.
- `vendor/pypdf/_codecs/adobe_glyphs.py`: Adobe Glyph List BSD-style notice and data from glyphNameFormatter. Its BSD 3-Clause copyright and permission notice is retained in that source file and at `vendor/glyphNameFormatter-LICENSE`.
- `vendor/pypdf/_codecs/symbol.py` and `zapfding.py`: data converted from Unicode's Adobe mapping files. Their original Unicode copyright and permission notices are attached to each converted source file.
- `vendor/pypdf/_codecs/core_font_metrics.py`: data based on Adobe Core 14 AFM files. The original AFM permission paragraph and Adobe per-font notices remain in the source.

These notices do not make the upstream material AI Nexus original code or relicense it under the project's MIT license.

The bundled `vendor/typing_extensions.py` is byte-for-byte identical to the Python source in the official [typing-extensions 4.16.0 PyPI wheel](https://pypi.org/project/typing-extensions/4.16.0/) (wheel SHA-256 `481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8`). The retained `vendor/typing_extensions-LICENSE` also matches the wheel's LICENSE. Its PSF-2.0 license applies; it is not relicensed as MIT.

The Node.js application has no npm runtime dependencies in `package.json`; it uses Node built-ins. PDF extraction uses the bundled Python files above; the workspace helpers use Python standard-library modules. External AI tools (the ChatGPT desktop app's Codex binary and Claude Code CLI) and remote services (OpenAI, Anthropic, DeepSeek and optional Tavily) are **not bundled** with AI Nexus. Their own terms, licensing and usage limits apply when the user installs or connects them.

These files are third-party work and retain their own copyrights and licenses; they are **not** relicensed under the project's MIT license. AI Nexus's original project code and documentation are covered by `LICENSE` to the extent owned by the project. See `SOURCES_AND_LICENSES.md` for the source inventory and remaining provenance checks. Product names and trademarks belong to their respective owners.
