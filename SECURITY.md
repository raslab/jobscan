# Security Policy

## Supported versions

Security fixes are handled on the default branch until formal releases exist.

## Reporting a vulnerability

Please do not open a public issue for sensitive vulnerabilities. Instead, contact the repository owner privately through GitHub or the contact channel listed on the GitHub profile.

Include:

- affected package (`jobscan` or `jobscan-mcp`)
- vulnerable endpoint or file path
- reproduction steps
- impact
- suggested fix, if known

## Deployment cautions

JobScan is a self-hosted tool that can:

- fetch configured career-page URLs from the server
- store scraped job descriptions and CRM notes
- trigger network-heavy sync jobs
- call the configured Gemini API for CRM processing

For remote deployments:

- put JobScan behind oauth2-proxy, another authenticated reverse proxy, or equivalent access control
- use TLS at the proxy/load-balancer layer
- do not expose the app container port directly to the internet
- keep `.env`, `emails.txt`, `htpasswd`, databases, and logs private
- rotate any credential that was committed or shared accidentally
