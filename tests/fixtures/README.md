# Static deployment fixtures

Keep ZIP fixtures small and focused. Cover these cases in tests:

- root `index.html`
- one nested `index.html` with Unicode filenames
- multiple nested `index.html` files
- no `index.html`
- traversal and absolute paths
- size and file-count limits

The user-provided sample archive is kept outside the repository and is exercised by `SAMPLE_SITE_ZIP` in the end-to-end test.
