# Bins Card Redesign Design

**Date:** 2026-03-07

**Scope:** Redesign the bins card so multiple same-day services fit on a Samsung 1024x768 tablet, and correct staged kerbside handling so `put out from` does not render as `collection today`.

## Goals

- Replace the single oversized bins headline with a row-based summary that remains legible in the narrow bottom-card slot.
- Show multiple services on the same day on the first page.
- Auto-page only when there is more information than the first page can show comfortably.
- Normalize long Brisbane City Council service names into short dashboard labels.
- Represent kerbside as a staged event with distinct statuses such as `PUT OUT` and `MON`, rather than forcing it into the same `TODAY` logic as standard bin collections.

## Non-Goals

- Reworking the overall dashboard grid.
- Adding manual pagination controls.
- Building a generalized calendar component for unrelated cards.

## Current Problems

- The backend chooses one "best" bin candidate and drops other same-day services.
- The frontend card renders a single `binsType` headline plus one subtitle line, which is incompatible with multiple events.
- Belmont kerbside data is being interpreted as `today` when the official schedule distinguishes between the placement date and the collection week starting date.

## Proposed UX

### Summary Page

The card becomes a compact schedule board with up to three fixed-height rows. Each row contains:

- an icon
- a short normalized label such as `Recycle` or `Kerbside`
- an optional micro-detail line such as `Mon 9 Mar`
- a right-aligned status tag such as `TODAY`, `PUT OUT`, or `MON`

The first page always attempts to show all relevant current and near-term rows at once. This is the primary tablet view and should remain static when the content fits.

### Focus Pages

If there are more items or more detail than the summary page can show, the card auto-pages. The first page remains the all-items summary. Subsequent pages show one item at a time in a larger focus treatment using the same label, tag, and optional detail line. Paging should happen only when needed.

### Copy Rules

- Keep labels short and normalized.
- Prefer status tags over full phrases.
- Use the detail line only when it adds essential information.
- Avoid wrapping whenever possible.

## Data Model Changes

The bins payload should move from a single selected event to a normalized list of display items. The frontend should no longer infer complex presentation from `nextType` and `nextDate` alone.

Suggested shape:

```json
{
  "summaryLabel": "Bins",
  "items": [
    {
      "kind": "recycle",
      "label": "Recycle",
      "tag": "TODAY",
      "detail": null,
      "icon": "♻",
      "tone": "yellow",
      "priority": 0
    },
    {
      "kind": "kerbside",
      "label": "Kerbside",
      "tag": "PUT OUT",
      "detail": "Mon 9 Mar",
      "icon": "📦",
      "tone": "neutral",
      "priority": 1
    }
  ],
  "pages": [
    { "type": "summary", "items": ["recycle", "kerbside"] },
    { "type": "focus", "item": "recycle" },
    { "type": "focus", "item": "kerbside" }
  ],
  "error": null
}
```

Backward compatibility can be maintained briefly while the client migrates, but the new `items` list should be the source of truth.

## Parsing Rules

- Standard bin services continue to use collection date semantics.
- Kerbside must be treated as a staged service:
  - before placement window: upcoming weekday tag such as `MON`
  - during placement window before collection day: `PUT OUT`
  - on collection day or start day: `TODAY`
- Long labels from Brisbane waste data must map to compact display labels.
- Same-day services must all survive parsing and ordering.

## Frontend Layout Rules

- Replace the giant background-text composition with a row list and optional pager.
- Use fixed row heights and conservative font sizes at the 1024x768 landscape breakpoint.
- Keep the card static unless pagination is actually needed.
- Animate page transitions as short stepped slides or fades, not continuous scrolling.

## Error Handling

- If bins parsing fails, show a single fallback row such as `Bins` with tag `CHECK`.
- If only one malformed item exists among otherwise valid items, drop the bad item and render the rest.
- If there are no upcoming items, show a neutral fallback such as `No bins` with a muted tag.

## Testing Strategy

- Parser tests for multiple same-day services.
- Parser tests for staged kerbside states using Belmont dates:
  - `2026-03-07` should produce kerbside `PUT OUT` with `Mon 9 Mar`
  - `2026-03-09` should produce kerbside `TODAY`
- UI tests for the new row-based markup and conditional paging behavior.
- UI tests for tablet breakpoint sizing so rows do not overflow the 1024x768 layout.

## Risks

- Existing consumers may rely on `nextType` and `nextDate`.
- Brisbane payload shapes may vary, especially for kerbside-specific fields.
- Over-animating the card will reduce legibility on a wall-mounted display.

## Recommendation

Implement the redesign in two layers:

1. Fix parsing so the state model returns a normalized list of display items and preserves multiple same-day services.
2. Replace the bins card UI with a summary-first pager that stays static when the summary fits.
