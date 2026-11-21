# Security policy

AI Nexus v0.1.0 is a macOS-first Public Beta. Security fixes focus on the current beta; this is not a promise of hosted-service support or a response-time service level. Start the normal web service on `127.0.0.1` only. Do not expose port 4173 directly to a LAN or the Internet. The optional phone gateway needs a separate, device-specific security review.

## Report privately

If the repository offers **Report a vulnerability** in its Security tab, use that private GitHub channel. If it is not available, open a public issue **only to request a private contact route**. Do not include the exploit, affected private data, secrets, screenshots of credentials, or reproduction files in that issue. The maintainer should confirm a working private channel before asking you for sensitive details.

Please allow time to investigate and coordinate a fix before public disclosure. The project currently makes no guaranteed response-time commitment.

For data flow, credential handling, and local permission boundaries, see [Privacy & security](PRIVACY_SECURITY.md).
