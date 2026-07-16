# DL Operator Report Archive

Encrypted static archive for daily DL operator reports.

- Production URL: `https://zebmills.github.io/dl-operator-report-archive/`
- Current dated route: `/2026-07-15/`
- GitHub repo: `zebmills/dl-operator-report-archive`

The source report HTML in `source/` is already encrypted by
`operator_stack_web_archive.py`. Do not commit plaintext daily report content.

Build locally:

```bash
npm run build
```

Deployments are handled by `.github/workflows/pages.yml` on pushes to `main`.
