# ID card printing on the phone: design for review

Status: approved 2026-11-09 ("lets build"). The decisions below replace sections 3, 4 and 7
where they differ.

## 0. Agreed with the owner (2026-11-09)

1. A print icon next to Admit on Students, shown to whoever holds `id_card:print`. No default
   permission changes.
2. It prints what the Students list shows: the API takes the list's own view, search, filters
   and sort, finds every match (not only the loaded pages) through the roster's own conditions,
   and prints the ones with a class this year. The rest are named as left out. Order follows the
   list.
3. The template editor stays on the web. The phone picks a design that already exists.
4. Paper: A4 with cut lines, column and row gaps (default 4mm, 0 to 20mm) and a live cards per
   sheet count; or card-size pages, which can only be shared (an A4 printer would enlarge them).
   The phone remembers the last gaps on that phone.
5. The A4 grid is centred on the sheet so backs line up on duplex printers; the web print page
   gets the same fix.
6. The PDF is exact to the mm, never scaled to fit, with a 50mm check ruler in each sheet's
   margin. What the printer does after that is the printer's and the office's part; the app does
   not warn about printer settings.
7. Up to 200 cards per PDF. Photos are embedded in the HTML, shrunk on the server to print size,
   so the PDF never waits on bucket links.
8. Space Grotesk (the web's card font) is embedded in the HTML.
9. The QR keeps the staff web link, `<WEB_APP_URL>/students/<id>`; new optional env var
   `WEB_APP_URL`, and without it the QR slot prints empty.
10. Later, not now: the web print page reading the server HTML (one renderer).

Owner asks: staff print ID cards from the app. A print icon sits next to the Admit button on the
Students screen.

## 1. Actor, task, context

- **Who:** office staff, a class teacher, or the principal. Anyone with `id_card:print` (the web
  print page uses the same permission). People without it don't see the icon.
- **Task:** make a PDF of ID cards for one class-section, or for a few students, and either
  print it or send it on WhatsApp to the card vendor.
- **Context:** at the start of the year, when a student joins late, or when a card is lost.
  Often there's no A4 printer nearby, so sharing matters as much as printing.

## 2. How it works (same pattern as fee PDFs, ADR-059)

The API draws the cards as finished HTML with a page size. The phone turns it into a PDF with
`expo-print`, then opens the print screen or the share sheet. It reuses `lib/fee-print.ts`
(`printDocument` / `shareDocument`) and the `PrintSheet` behaviour: printing writes nothing, so
it can be retried freely.

**New on the API:** a card renderer in `packages/services/src/id-card-documents/`, ported from
the web's `card-canvas.tsx` and `template.ts`. Elements use the same percent geometry inside a
card sized in mm. Text bindings use the same `resolveBinding`. The photo and logo come from the
signed image links the card data already carries. The QR is made with `qrcode`, which is already
a services dependency.

**New route:** `idCard.document` (`staffProcedure("id_card:print")`).
- Input: `schoolId`, `templateId` (optional; default is the school's default template), the
  same `idCardDataRequestShape` as `cardData`, `paper`, and `flip` (when the card has a back).
- It calls `idCardService.cardData` with the caller's scope, so the tenancy and no-widening
  rules stay as they are.
- It returns `{ html, pageSize, fileName, cardCount, missingPhotoCount }`.

## 3. Journey and wireflow

```
Students header [🖨] [+ Admit]
   │ tap 🖨
   ▼
Print ID cards (pushed screen)
   ├─ Class-section chips ─► student list, all ticked
   ├─ Design row  (default template name · Landscape · 2-sided) ─► design sheet
   ├─ Paper row   (A4, 8 per sheet · cut lines)  ─► paper sheet
   └─ Bottom bar: [Share]  [Print 32 cards]
          │
          ▼  "Making 32 cards…" (blocks the screen, can't be cancelled)
      Android print screen  /  share sheet
```

- **Opening:** if the Students screen already has a class filter, the print screen opens on that
  class-section. Otherwise it opens on the first one the user can see.
- **Students:** each row shows a tick, a 32pt photo, the name, and the roll number, ordered by
  roll. A header row says "32 of 32 · Select none". A student with no photo gets a small
  "No photo" tag. Above the list, a line reads "3 have no photo · Add photos", which opens the
  existing Photos screen and comes back.
- **Design sheet:** lists the school's active templates (name, orientation, one- or two-sided),
  with the default marked. A phone preview is not in this first version (see Q2).
- **Paper sheet:**
  - **A4 with cut lines.** This is the default. The grid follows the web exactly: 10mm
    margins, 4mm gaps, so 2×4 for landscape cards and 3×3 for portrait.
  - **Card size.** One card per page at 86×54mm (or the template's own size), for vendors and
    PVC card printers.
  - If the template has a back: on A4, the backs go on separate pages, mirrored the way the web
    does it, with a choice of "Flip on long edge" or "Flip on short edge". On card size, each
    front page is followed by its back page.
- **Bottom bar:** the button counts the ticked students. It's turned off at 0 ticked.

## 4. Screen states

| State | What shows |
|---|---|
| Loading | Skeleton rows for the list; Design and Paper rows greyed out |
| No templates | "No ID card design yet." Staff with `id_card:manage` see "Set one up on the web for now". Others see "Ask the office to set one up". See Q3 |
| Empty section | "No students in 8-A" and the chips stay usable |
| No permission | The icon isn't shown. A deep link gets the usual no-access screen |
| Error / offline | The usual Notice with Retry. Ticks are kept |
| Making the PDF | A blocking sheet, "Making 32 cards…". On failure: a friendly error and Try again |
| Large batch | Up to 200 cards per PDF (see Q4). Over that: "Pick up to 200 at a time" |
| App resume | Ticks are kept. Image links are fetched again on Print (they expire after 6 hours) |

Accessibility: 44pt targets, a label on the print icon ("Print ID cards"), a tick state each
row reads out, and layouts that hold at text scale 1.3x.

## 5. Things to prove early

1. **Photos load before the PDF is made.** `expo-print` has to load signed bucket links for
   photos. Measure 40 cards with photos. If images come out missing, embed them as data URIs
   on the server (larger reply) or wait for them in the page script.
2. **Speed and size.** 40 cards, and 200 cards, on the emulator and on a cheap phone. ADR-059
   measured 18 notices in about 5 seconds.
3. **What the web prints and what the phone prints match.** Print the same template from both
   and compare. The fonts differ: the web uses its own sans font, the phone uses the system one.
4. **The QR target.** The web QR encodes `<web origin>/students/<id>`. The API has no web origin
   variable (only `CORS_ORIGIN` and `BETTER_AUTH_URL`), so this needs a new `WEB_APP_URL` env
   variable, or a different QR value (see Q5).
5. **Backs line up on a duplex A4 printer.** This can't be checked without a printer.

## 6. Build order

1. Services: card renderer and `idCard.document`, with template tests (geometry, bindings, back
   mirroring, missing photo or logo shows an empty slot). Integration: tenancy, sibling branch,
   no widening.
2. Mobile: print icon in the Students header, permission-gated.
3. Mobile: the Print ID cards screen, design and paper sheets, and the print or share run.
4. Device walk on the emulator; MOBILE_PLAN ledger (`/students/id-cards` partly done: print
   yes, designer no); TASKS.md; ADR-065, or a note under ADR-059.

## 7. Questions for the owner

- **Q1. One class-section at a time, or several?** Recommended: one at a time, plus "Pick
  students" search across the branch for a lost card. A whole-school run is rare and heavy.
- **Q2. Card preview on the phone before printing?** Recommended: not now. The Android print
  screen already shows the pages. A real preview needs either a WebView of the server HTML or a
  React Native renderer, and that would be a third copy of the renderer.
- **Q3. Template designer on the phone?** It's still open in MOBILE_PLAN slice 6. Recommended:
  web-only for now, as an explicit owner decision recorded in the ledger, since the designer is
  a drag-and-place canvas. Picking an existing design and setting the default could come to the
  phone later.
- **Q4. Batch cap?** Recommended: 200 cards per PDF, to be adjusted after the speed check.
- **Q5. What the QR holds?** Options: the staff web link, as today (needs `WEB_APP_URL`); the
  admission number as plain text (works offline, any scanner); or a future app deep link.
  Recommended: keep the web link, so web and phone cards stay the same.
- **Q6. Should the web print page switch to the server HTML later?** Then there would be one
  renderer instead of two. Recommended: yes, as a follow-up; not part of this slice.

## 8. Build record (2026-11-09, `feat/id-card-print`)

Built as section 0 says, with these specifics:

- **Phone:** a bottom sheet, not a pushed screen (`screens/students/id-card-print-sheet.tsx`), opened
  from an icon-only print button beside Admit. It shows the card count, who is left out, who has no
  photo (with a link to Photos), the design picker (default first), A4 or card size, the two gap
  steppers with a live "N cards per sheet · M sheets" line, the flip choice for two-sided designs, and
  Share and Print (card size: Share only). Gaps persist in AsyncStorage (`lib/id-card-prefs.ts`).
- **API:** `idCard.print.summary` and `idCard.print.document` (`staffProcedure("id_card:print")`,
  same branch rule as `cardData`). `studentService.listRosterIds` reads the list's matches;
  `idCardPrintService` narrows to printable students, renders, and refuses with wording for no one,
  over 200, or no design.
- **Renderer:** `id-card-documents/layout.ts` (grid, centring, back mirroring) and `render.ts`
  (HTML, the web's text rules, asset CSS written once). Font module generated from
  `@fontsource/space-grotesk` 5.2.8 (latin 400 and 700, about 26 KB).
- **Web:** `students/id-cards/page.tsx` and `print-preview.tsx` pad each sheet so the grid is centred.

**Checked:** see TASKS. **Not walked:** phone, printer, duplex, iOS, large batches.

**Margins (owner, 2026-11-09).** The 10mm margin was a leftover from the web page, so 5 rows of
landscape cards at a 2mm gap didn't fit (278mm needed, 277mm free). The margin is now the user's:
left and right and top and bottom set apart, default 8mm, 0 to 100mm, on the phone (steppers,
remembered per phone) and on the web print page (inputs, remembered per browser), with a live
"N cards per sheet" line on both. The grid stays centred, so backs still line up. The 50mm check
line moves into the space below the cards and is left out when there is less than 6mm.
