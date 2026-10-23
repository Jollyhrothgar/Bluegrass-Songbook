# Security Policy

## Maintainer

Bluegrass Songbook is maintained by Mike Beaumier
([@Jollyhrothgar](https://github.com/Jollyhrothgar)), who is responsible for
its security: receiving and fixing vulnerability reports, publishing
advisories, managing secrets, and keeping dependencies patched.

## Scope

- The live site, https://bluegrassbook.com
- The code in this repository, including the Supabase database policies and
  functions under `supabase/`
- The build and deploy workflows under `.github/workflows/`

Only the current `main` branch is supported. The site deploys from it, so
fixes ship there.

## Reporting a vulnerability

Please do not open a public issue.

Report it privately through GitHub: open this repository's **Security** tab
and choose **Report a vulnerability**. If you can't use GitHub, email
hello@bluegrassbook.com.

Include what you found, how to reproduce it, and what it lets an attacker do.
You'll get an acknowledgement within 7 days. Once a fix is deployed, the
report is published as a GitHub security advisory, crediting you unless you
ask not to be named.

## How the project handles security

- Secret scanning and push protection are on for this repository.
- Dependabot opens pull requests for vulnerable dependencies (npm and Python).
- `main` is protected: it can't be deleted or force-pushed.
- Deploys run only after CI passes.
- Secrets are never committed; they come from a password manager at run time.
