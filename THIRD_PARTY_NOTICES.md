# Third-party notices

AI Nexus bundles a local copy of `pypdf` 6.10.0 for text extraction from PDFs. Its BSD 3-Clause license text is retained at `vendor/pypdf-LICENSE`.

The bundled `vendor/typing_extensions.py` is byte-for-byte identical to the Python source in the official [typing-extensions 4.16.0 PyPI wheel](https://pypi.org/project/typing-extensions/4.16.0/) (wheel SHA-256 `481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8`). The retained `vendor/typing_extensions-LICENSE` also matches the wheel's LICENSE. Its PSF-2.0 license applies; it is not relicensed as MIT.

The Node.js application has no npm runtime dependencies in `package.json`; it uses Node built-ins. PDF extraction uses the bundled Python files above; the workspace helpers use Python standard-library modules. External AI tools (the ChatGPT desktop app's Codex binary and Claude Code CLI) and remote services (OpenAI, Anthropic, DeepSeek and optional Tavily) are **not bundled** with AI Nexus. Their own terms, licensing and usage limits apply when the user installs or connects them.

These files are third-party work and retain their own copyrights and licenses; they are **not** relicensed under the project's MIT license. AI Nexus's original project code and documentation are covered by `LICENSE` to the extent owned by the project. See `SOURCES_AND_LICENSES.md` for the source inventory and remaining provenance checks. Product names and trademarks belong to their respective owners.
