---
title: Assembly Production Dashboard
emoji: 📊
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---
Production Data Analysis website, Assembly Production Department. Sign-in required.

## Configuration (secrets)

The website does not start without an administrator. There are no built-in accounts or passwords.
Set these as **Secrets** in the hosting provider's settings, never in the code or in a chat:

| Secret | Purpose |
|---|---|
| `PDA_ADMIN_USER` | Administrator user name |
| `PDA_ADMIN_PIN` | Administrator password, at least 8 characters |
| `HF_TOKEN` | Hugging Face token with write access to the private dataset |
| `HF_DATA_REPO` | Private dataset that holds the database, original uploads and private translations, e.g. `user/assembly-data` |

Everything confidential (database, uploaded Excel files, the private translation table `translations-ar.json`)
lives only in the private dataset. Do not commit real plant data to this repository.

On a PC: `PDA_ADMIN_USER=... PDA_ADMIN_PIN=... npm run demo` (demo data, guests may view) or `npm start`.
Tests: `npm test`.
