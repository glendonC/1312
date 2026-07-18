# Security Policy

## Supported versions

1321 has no versioned release line. Security fixes target the current `main` branch. Older commits,
forks, local modifications, and unpinned third-party services are not maintained versions.

## Report a vulnerability

Use [GitHub private vulnerability reporting][private-report]. Do not open a public issue or pull
request with vulnerability details.

Include:

- the affected commit SHA,
- the security boundary that can be crossed,
- a minimal reproduction or proof of concept,
- the expected and observed behavior,
- the practical impact,
- any disclosure constraints.

Do not attach secrets, private media, or third-party data you are not authorized to share. Use the
smallest safe reproduction.

The maintainer will assess reports as capacity allows, coordinate disclosure for confirmed issues,
and credit reporters who want attribution. This policy does not promise a response or remediation
deadline.

## Security scope

Security reports include credible ways to:

- expose credentials, private files, media, prompts, or runtime artifacts,
- bypass a sandbox, task grant, authorization check, or publication boundary,
- execute an ungranted tool or command,
- tamper with validated evidence while preserving apparent authority,
- cross task, run, or artifact boundaries,
- trigger a reachable dependency vulnerability with concrete impact.

Incorrect captions, translations, rankings, or model judgments are product-quality issues unless
they also cross a security or authorization boundary. Report non-sensitive defects through the
[public issue tracker][issues].

[private-report]: https://github.com/glendonC/1321/security/advisories/new
[issues]: https://github.com/glendonC/1321/issues
