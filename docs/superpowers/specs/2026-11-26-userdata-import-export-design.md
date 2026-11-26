# userdata import/export

## intent

Progress lives only in one browser's `localStorage`. This adds a way to move it to another browser or device, or keep a backup, as a string that can be copied and pasted.

## goals

- export all userdata as one compressed Base64 string
- import that string on any device and continue where the other left off
- reject bad input without touching existing progress

## non-goals

- sync, accounts, or anything needing a backend
- merging two devices' progress (import replaces)
- file download/upload
- exporting the password cookie

## anti-goals

- an import that silently wipes progress, or leaves state half-written after a bad paste
- adding a dependency or build step

## constraints

- static site, plain ES5-style `app.js` in one IIFE, no dependencies
- userdata is the single object saved under `tnmotoprep.v1`: `{ v, cards, day, newDone, newPerDay }`

## approaches

1. **Built-in `CompressionStream('deflate-raw')` then Base64 (picked).** No dependencies, about 30 lines, same spirit as the existing `crypto.subtle` use. Needs a 2023+ browser.
2. Vendored library (lz-string). Works everywhere, but adds a dependency and a non-standard format.
3. Hand-packed binary then Base64. Shortest string, most code, breaks whenever the card shape changes.

Picked 1: the string is pasted, not typed, so length matters little, and the project stays dependency-free.

## design

### format

    tnm1:<base64 of deflate-raw of JSON.stringify(state)>

- `tnm1:` identifies the string and versions the format, separate from the state's own `v`
- standard Base64 (`btoa`/`atob`)
- on import, surrounding and embedded whitespace is stripped before decoding, so a string wrapped by a chat app or email still works

### export

A plain `export` button in the settings row on the home screen, beside `reset`. It opens a dialog with the string in a read-only textarea (selected) and a `copy` button that uses `navigator.clipboard.writeText`. The textarea is the fallback when the clipboard is unavailable.

### import

A plain `import` button beside it. It opens a dialog with an empty textarea and an `import` button. On submit:

1. strip whitespace, check the `tnm1:` prefix
2. Base64-decode, inflate, `JSON.parse`
3. validate: object, `v === 1`, `cards` and `newDone` are objects, `day` is a number; `newPerDay` goes through the existing `perDay()`
4. if this device has any progress (`state.cards` not empty), `confirm('replace progress on this device?')`
5. `state = imported`, clear `undo` and `pinned`, `save()`, close, `render()`

Any failure in 1–3 shows one line in the dialog ("that isn't a valid export") and changes nothing. Existing `rollover()` handles an imported `day` that is stale.

Cards in the import that aren't in the current decks are kept as-is; the app already ignores unknown ids.

### unsupported browsers

If `CompressionStream` is missing, the two buttons are not shown.

## my calls (not discussed)

- replace on import, with a confirm only when there is progress to lose
- dialogs with a textarea rather than clipboard-only, so it works when clipboard access is blocked
- hide the buttons on unsupported browsers instead of showing an error
- dialog styling reuses the intro modal's

## left to the builder

- exact wording and layout of the dialogs
- function names and placement within `app.js`
- one README line describing the feature

## verification

No test setup exists. Check by hand in a browser: export, reset, import restores counts; a mangled string, an empty string and a string without the prefix are each rejected with progress intact.
