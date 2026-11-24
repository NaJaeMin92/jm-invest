# Frontend releases

The owner wants the local app and GitHub Pages kept in sync on each site update. Both serve the same frontend. A stock hash only selects the instrument.

For each requested frontend release, update the versioned URLs of changed entry points and modules, test the local app, and commit the intended changes on `main`. Run `python3 scripts/publish-site.py check-local` against the running local server and `python3 scripts/publish-site.py publish` to push that commit and check the public files. Report a pending deployment if Pages has not served the release. The Mac's release retry job resumes the queued commit when it has access.
