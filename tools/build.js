#!/usr/bin/env node
// Turn the source dataset into an encrypted data.js and signs/*.png.
//
// usage: TNMOTO_PASSWORD=... node tools/build.js path/to/tennessee_motorcycle_qa.json
//
// data.js holds base64(salt[16] | iv[12] | aes-256-gcm ciphertext | tag[16]),
// keyed by pbkdf2-sha256 of the password. app.js decrypts it with webcrypto.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ITERATIONS = 250000; // keep in sync with app.js

const password = process.env.TNMOTO_PASSWORD;
const source = process.argv[2];
if (!password || !source) {
  console.error('usage: TNMOTO_PASSWORD=... node tools/build.js path/to/dataset.json');
  process.exit(1);
}

const src = JSON.parse(fs.readFileSync(source, 'utf8'));

const seen = new Set();
const questions = [];
for (const q of src.questions) {
  const key = q.question + '\n' + q.answer;
  if (seen.has(key)) continue;
  seen.add(key);
  questions.push({ id: 'q' + q.number, front: q.question, back: q.answer, note: q.explanation });
}

const signsDir = path.join(ROOT, 'signs');
fs.mkdirSync(signsDir, { recursive: true });
const signs = src.signs.map(function (s) {
  const name = String(s.number).padStart(3, '0') + '.png';
  fs.writeFileSync(path.join(signsDir, name), Buffer.from(s.image.base64, 'base64'));
  return { id: 's' + s.number, img: 'signs/' + name, back: s.name, note: s.description };
});

const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const plain = JSON.stringify({ questions: questions, signs: signs });
const data = Buffer.concat([salt, iv, cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);

fs.writeFileSync(path.join(ROOT, 'data.js'), 'window.DATA = "' + data.toString('base64') + '";\n');
console.log('questions: ' + questions.length + ', signs: ' + signs.length);
