# TEF Uploads Source

User-uploaded TEF (TablEdit) files for conversion to OTF tablature.

## Structure

```
tef-uploads/
├── uploads/     # Raw TEF files (checked into git)
├── parsed/      # Converted OTF files (gitignored)
└── CLAUDE.md    # This file
```

## Current Files

| File | Description | Source |
|------|-------------|--------|
| `mandolin_foggy_mountain_breakdown.tef` | Mandolin break | Joe Carr's Magical Mandolin Method (1978) |
| `shuck_the_corn.tef` | Ensemble arrangement | Unknown |
| `shuck_the_corn_banjo_only.tef` | Banjo-only version | Unknown |

## Converting TEF to OTF

Use the banjo-hangout TEF parser (it works for any stringed instrument):

```bash
cd sources/banjo-hangout/src && uv run python -c "
from tef_parser import TEFReader, tef_to_otf
import json

tef_path = '../../../sources/tef-uploads/uploads/YOUR_FILE.tef'
reader = TEFReader(tef_path)
tef = reader.parse()

otf = tef_to_otf(tef)
otf_dict = otf.to_dict()

# Save result
with open('../../../sources/tef-uploads/parsed/YOUR_FILE.otf.json', 'w') as f:
    json.dump(otf_dict, f, indent=2)
"
```

## Future: Upload Endpoint

This directory will eventually be wired to an upload endpoint where users can:

1. Upload TEF files directly
2. Auto-convert to OTF
3. Preview the tablature
4. Submit for inclusion in the songbook

## Notes

- TEF files are proprietary TablEdit binary format
- Parser supports V2 format; some V3 files may not work
- Multi-instrument files produce multiple tracks in the OTF
- Check `sources/banjo-hangout/CLAUDE.md` for parser details
