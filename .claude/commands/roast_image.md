# Roast a complaint for the Bluegrass Standards Board

Process a screenshot of a complaint and add it to the Standards Board page.

## Arguments
- Screenshot path: $ARGUMENTS

## Process

1. **Find the next case number**: Check `docs/images/hatemail/` for existing `hate_N.png` files and determine the next number.

2. **Copy the screenshot**: Copy the provided screenshot to `docs/images/hatemail/hate_N.png` (use glob patterns to handle spaces in filenames).

3. **Analyze the complaint**: Read the image to identify:
   - Complainant username
   - Date filed
   - Venue/platform (r/bluegrass, Banjo Hangout, etc.)
   - The complaint text (key quote)
   - Any ironic details (post count, platform used, etc.)

4. **Review existing cases**: Read `docs/bluegrass-standards-board.html` to understand the format and existing cases.

5. **Propose roast angles**: Present 3-4 potential approaches for the Committee Addendum, each with:
   - A witty status badge text (e.g., "Returns Not Accepted", "341 Posts Exposed")
   - The dry, bureaucratic roast angle

   Ask the user which angle they prefer (or if they want to combine/modify).

6. **Add the case**: After user approval, add the new case to `docs/bluegrass-standards-board.html` following the exact HTML structure of existing cases:
   - Case number: BSB-YYYY-XXX (next in sequence)
   - Status badge with chosen text
   - Complainant info
   - Evidence image
   - Complaint quote
   - Committee Addendum with the approved roast

## Style Guidelines for Roasts

- **Tone**: Dry, bureaucratic humor - treat internet comments as formal legal complaints
- **Find the irony**: Look for self-contradictions (complaining about devices while posting online, etc.)
- **Use specifics**: Reference exact numbers, dates, or details from the complaint
- **Keep it witty but not mean**: The goal is clever observation, not personal attacks
- **Status badges**: Should hint at the punchline (e.g., "Submitted Via Internet" for someone complaining about technology)
