# TEF Uploads

User-supplied TablEdit (`.tef`) files kept for conversion to OTF tablature.
There is no upload endpoint yet; the three files in `uploads/` are all there is.

- `uploads/` is gitignored (root `.gitignore`). The existing files are tracked
  because they predate that rule; a new `.tef` needs `git add -f`.
- `parsed/` does not exist. Create it before writing output.

Convert one file with the Banjo Hangout parser (`convert-file` takes any
stringed instrument and needs no catalog):

```bash
mkdir -p sources/tef-uploads/parsed
uv run python sources/banjo-hangout/src/batch_import.py convert-file \
  sources/tef-uploads/uploads/FILE.tef sources/tef-uploads/parsed/FILE.otf.json
```

Parser details and V3 status: `sources/banjo-hangout/CLAUDE.md` and
`.claude/skills/tab-debug/SKILL.md`.
