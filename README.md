# tnmotoprep

flashcards for the tennessee motorcycle test.

the card text in `data.js` is encrypted (aes-256-gcm, pbkdf2). the site asks for the password once and keeps it in a cookie.

## develop

    python3 -m http.server

opening `index.html` directly also works, but browsers don't keep cookies for `file://`, so it asks for the password on every load.

## rebuild data

    TNMOTO_PASSWORD=... node tools/build.js path/to/tennessee_motorcycle_qa.json

writes `data.js` and `signs/*.png`. the sign images are not encrypted.

## deploy

push to github, then settings → pages → deploy from branch → `main`, `/ (root)`.

## move progress

export under the decks gives a string (`tnm1:` + base64 of the deflated state). import on another device pastes it in and replaces the progress there.

## keys

space/enter: show, then good. 1–4: again, hard, good, easy. z: undo.
