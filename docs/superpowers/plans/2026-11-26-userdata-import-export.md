# Userdata Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export all userdata as a compressed Base64 string and import it back, from the home screen.

**Architecture:** Two pure-ish helpers in `app.js` (`pack`, `unpack`) built on `CompressionStream`/`DecompressionStream`, and one dialog function (`transfer`) reached from two new buttons in the settings row. Styling reuses the `.intro` dialog.

**Tech Stack:** Plain browser JS inside the existing IIFE, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-userdata-import-export-design.md`

## Global Constraints

- format is exactly `tnm1:` + standard Base64 of `deflate-raw` of `JSON.stringify(state)`
- no dependencies, no build step, ES5 style matching `app.js`
- a failed import changes nothing; error copy is `that isn't a valid export`
- confirm copy is `replace progress on this device?`, shown only when `state.cards` is not empty
- buttons are not rendered when `CompressionStream` is missing
- password cookie is never exported

## Review Focus

- string with spaces or newlines inserted (wrapped by chat/email): imports normally
- truncated string or one with characters changed: rejected, progress intact
- valid Base64 of valid JSON that is not a state (`[]`, `null`, `{"v":2}`): rejected
- a card entry that isn't a well-formed card (missing numeric `due`): rejected, since `queue()` sorts on it
- typing or pasting in the import box on a deck page never triggers study shortcuts (dialogs only open from home, where `deckName()` is null)

---

### Task 1: pack / unpack

**Files:** Modify `app.js` (new `// ---- transfer ----` section after storage)

**Interfaces — Produces:**
- `pack() -> Promise<string>` of the current `state`
- `unpack(text: string) -> Promise<state>`; rejects on any invalid input; returns only the known keys `{ v, cards, day, newDone, newPerDay }` with `newPerDay` passed through `perDay()`

- [ ] Implement both. Validation: object, `v === 1`, `cards`/`newDone` plain objects, `day` a number, every card has `s` of `learn` or `review` and a numeric `due`.
- [ ] Verify in a browser console against the Review Focus inputs.

### Task 2: dialogs and buttons

**Files:** Modify `app.js` (`home()`, new `transfer(importing)`), `style.css`, `README.md`

**Interfaces — Consumes:** `pack`, `unpack`

- [ ] `export` and `import` plain buttons in the settings row before `reset`, only when `window.CompressionStream` exists.
- [ ] `transfer(false)`: dialog with read-only textarea holding the string, selected; `copy` button (label becomes `copied`); `close`.
- [ ] `transfer(true)`: dialog with empty textarea, `import` button, error line, `close`. On success: confirm if needed, replace `state`, clear `undo`/`pinned`, `fresh = false`, `save()`, close, `render()`.
- [ ] `style.css`: textarea shares the `button, input` base rule; `.intro textarea` full width; only the first settings `.plain` gets `margin-left: auto`.
- [ ] README: one line under a `## move progress` heading.
- [ ] Verify by hand: export, reset, import restores the deck counts; each Review Focus input behaves as listed.
- [ ] Commit.
