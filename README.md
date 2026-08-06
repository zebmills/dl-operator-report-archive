# DL Operator Report Archive

Encrypted static archive for daily DL operator reports and the read-only
operator dashboard.

- Production URL: `https://zebmills.github.io/dl-operator-report-archive/`
- Current dated route: `/2026-07-15/`
- Dashboard route prepared: `/dashboard/` after the approved publish run
- GitHub repo: `zebmills/dl-operator-report-archive`

The source report HTML and dashboard HTML in `source/` are already encrypted by
`operator_stack_web_archive.py` and `operator_stack_dashboard.py`. Do not commit
plaintext report/dashboard content.

Build locally:

```bash
npm run build
```

Deployments are handled by `.github/workflows/pages.yml` on pushes to `main`.
