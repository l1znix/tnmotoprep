(function () {
  'use strict';

  var KEY = 'tnmotoprep.v1';
  var MIN = 60000;
  var DAY = 86400000;
  var STEPS = [1, 10]; // learning steps, minutes
  var RELEARN = [10];
  var IVL_MOD = 0.6; // scales good/easy review intervals
  var EASY_IVL = 2; // days, graduating with easy
  var GRADES = ['again', 'hard', 'good', 'easy'];
  var COOKIE = 'tnmotoprep_pw';
  var ITERATIONS = 250000; // keep in sync with tools/build.js
  var DECKS = null; // set once data.js is decrypted

  var app = document.getElementById('app');
  var fresh = false; // nothing saved on this device yet
  var state = load();
  var current = null;
  var shown = false;
  var undo = null;

  // ---- storage ----

  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!s || s.v !== 1) {
      fresh = true;
      s = { v: 1, cards: {}, day: 0, newDone: {}, newPerDay: 20 };
    }
    return s;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- password ----
  // data.js is base64(salt[16] | iv[12] | aes-256-gcm ciphertext + tag)

  function decrypt(password) {
    var raw = Uint8Array.from(atob(window.DATA), function (ch) { return ch.charCodeAt(0); });
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: raw.subarray(0, 16), iterations: ITERATIONS, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(16, 28) }, key, raw.subarray(28));
      })
      .then(function (buf) {
        DECKS = JSON.parse(new TextDecoder().decode(buf));
      });
  }

  function getCookie() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // re-set on every successful load so the year keeps rolling
  function setCookie(password) {
    document.cookie = COOKIE + '=' + encodeURIComponent(password) + '; max-age=31536000; samesite=strict' +
      (location.protocol === 'https:' ? '; secure' : '');
  }

  function unlock(password) {
    return decrypt(password).then(function () {
      setCookie(password);
      render();
      if (fresh) intro();
    });
  }

  function lock(failed) {
    app.textContent = '';
    app.className = '';
    var form = el('form', 'lock');
    var input = el('input');
    input.type = 'password';
    input.placeholder = 'password';
    input.autocomplete = 'current-password';
    input.setAttribute('aria-label', 'password');
    var open = el('button', null, 'open');
    form.append(input, open);
    if (failed) form.append(el('p', 'error', 'wrong password'));
    form.onsubmit = function (e) {
      e.preventDefault();
      if (!input.value) return;
      open.disabled = true;
      unlock(input.value).catch(function () { lock(true); });
    };
    app.append(form);
    input.focus();
  }

  // ---- scheduling (sm-2, anki defaults) ----
  // card: { s: 'learn' | 'review', due, ivl, ease, step, re }
  // due is a ms timestamp while learning and a day number in review.

  // days roll over at 4am local
  function today(now) {
    var d = new Date(now - 4 * 3600000);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }

  function rollover() {
    var t = today(Date.now());
    if (state.day !== t) {
      state.day = t;
      state.newDone = {};
      undo = null;
    }
  }

  function answer(card, grade, now) {
    var c = card ? Object.assign({}, card) : { s: 'learn', step: 0, ease: 2.5, ivl: 0 };
    var day = today(now);

    if (c.s === 'review') {
      if (grade === 0) {
        c.ease = Math.max(1.3, c.ease - 0.2);
        c.ivl = 1;
        c.s = 'learn';
        c.re = 1;
        c.step = 0;
        c.due = now + RELEARN[0] * MIN;
        return c;
      }
      // good never lands before hard, easy at least a day past good
      var hard = Math.max(c.ivl + 1, Math.round(c.ivl * 1.2));
      var good = Math.max(hard, Math.round(c.ivl * c.ease * IVL_MOD));
      var easy = Math.max(good + 1, Math.round(c.ivl * c.ease * 1.3 * IVL_MOD));
      if (grade === 1) c.ease = Math.max(1.3, c.ease - 0.15);
      if (grade === 3) c.ease += 0.15;
      c.ivl = grade === 1 ? hard : grade === 2 ? good : easy;
      c.due = day + c.ivl;
      return c;
    }

    var steps = c.re ? RELEARN : STEPS;
    if (grade === 0) {
      c.step = 0;
      c.due = now + steps[0] * MIN;
    } else if (grade === 1) {
      var delay = steps[c.step];
      if (c.step === 0) delay = steps.length > 1 ? (steps[0] + steps[1]) / 2 : delay * 1.5;
      c.due = now + delay * MIN;
    } else if (grade === 2 && c.step + 1 < steps.length) {
      c.step++;
      c.due = now + steps[c.step] * MIN;
    } else {
      if (!c.re) c.ivl = grade === 3 ? EASY_IVL : 1;
      c.s = 'review';
      delete c.re;
      delete c.step;
      c.due = day + c.ivl;
    }
    return c;
  }

  function queue(deck, now) {
    var day = today(now);
    var q = { fresh: [], learn: [], review: [] };
    DECKS[deck].forEach(function (card) {
      var c = state.cards[card.id];
      if (!c) q.fresh.push(card);
      else if (c.s === 'learn') q.learn.push(card);
      else if (c.due <= day) q.review.push(card);
    });
    var byDue = function (a, b) { return state.cards[a.id].due - state.cards[b.id].due; };
    q.learn.sort(byDue);
    q.review.sort(byDue);
    q.fresh = q.fresh.slice(0, Math.max(0, state.newPerDay - (state.newDone[deck] || 0)));
    return q;
  }

  // learning cards that are due, then reviews, then new, then learning cards early
  function pick(q, now) {
    if (q.learn.length && state.cards[q.learn[0].id].due <= now) return q.learn[0];
    return q.review[0] || q.fresh[0] || q.learn[0] || null;
  }

  function interval(c, now) {
    var ms = c.s === 'review' ? c.ivl * DAY : c.due - now;
    if (ms < MIN) return '<1m';
    if (ms < 60 * MIN) return Math.round(ms / MIN) + 'm';
    if (ms < DAY) return Math.round(ms / (60 * MIN)) + 'h';
    var days = ms / DAY;
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return (days / 30).toFixed(1) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  // ---- view ----

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function counts(q) {
    var span = el('span', 'counts');
    span.append(
      el('span', 'new', q.fresh.length), ' ',
      el('span', 'learn', q.learn.length), ' ',
      el('span', 'due', q.review.length)
    );
    return span;
  }

  function deckName() {
    var name = decodeURIComponent(location.hash.slice(1));
    return DECKS && Object.prototype.hasOwnProperty.call(DECKS, name) ? name : null;
  }

  function render() {
    if (!DECKS) return;
    rollover();
    var deck = deckName();
    app.textContent = '';
    app.className = '';
    if (deck) study(deck);
    else if (location.hash === '#all') all();
    else home();
  }

  function all() {
    current = null;
    app.className = 'long';
    var bar = el('nav', 'bar');
    var back = el('a', null, 'decks');
    back.href = '#';
    bar.append(back);
    app.append(bar);

    Object.keys(DECKS).forEach(function (deck) {
      app.append(el('h1', null, deck));
      var list = el('ol', DECKS[deck][0] && DECKS[deck][0].img ? 'all tiles' : 'all');
      DECKS[deck].forEach(function (card) {
        var item = el('li');
        if (card.img) {
          var img = el('img');
          img.src = card.img;
          img.alt = '';
          img.loading = 'lazy';
          img.width = img.height = 96;
          item.append(img);
        } else {
          item.append(el('p', 'front', card.front));
        }
        item.append(el('p', 'back', card.back), el('p', 'note', card.note));
        list.append(item);
      });
      app.append(list);
    });
  }

  // shown once, until the first save
  function intro() {
    var box = el('dialog', 'intro');
    box.append(
      el('h1', null, 'how this works'),
      el('p', null, 'each card shows a question or a sign. answer it in your head, tap show, then grade how well you knew it:')
    );
    var grades = el('ul');
    [
      "didn't know it. it comes back in a few minutes",
      'got there, but it was a struggle',
      'knew it',
      'knew it instantly'
    ].forEach(function (text, grade) {
      var item = el('li');
      item.append(el('b', GRADES[grade], GRADES[grade]), ' ' + text);
      grades.append(item);
    });
    box.append(grades);
    box.append(el('p', null, 'the time over each button is how long until you see that card again. cards you know drift further apart, cards you miss come back sooner.'));
    var legend = el('p');
    legend.append(
      'each deck counts ', el('b', 'new', 'new'), ' cards you have not seen, cards you are still ',
      el('b', 'learn', 'learn'), 'ing, and reviews that are ', el('b', 'due', 'due'), ' today.'
    );
    box.append(legend);
    box.append(el('p', null, 'a short session every day beats one long one. clear what is due and the schedule does the rest.'));
    var start = el('button', null, 'start');
    start.onclick = function () { box.close(); };
    box.append(start);
    box.onclose = function () {
      fresh = false;
      save();
      box.remove();
    };
    document.body.append(box);
    box.showModal();
    // focus lands on start, which scrolls a short screen to the bottom
    box.scrollTop = 0;
  }

  function stat(name, n) {
    var s = el('span', 'stat');
    s.append(el('b', name, n), name);
    return s;
  }

  function home() {
    current = null;
    var now = Date.now();
    app.className = 'home';
    app.append(el('h1', null, 'tn moto prep'));

    var decks = el('div', 'decks');
    var total = 0;
    Object.keys(DECKS).forEach(function (deck) {
      var q = queue(deck, now);
      total += DECKS[deck].length;
      var card = el('a', 'deck');
      card.href = '#' + deck;
      var stats = el('span', 'stats');
      stats.append(stat('new', q.fresh.length), stat('learn', q.learn.length), stat('due', q.review.length));
      card.append(el('span', 'name', deck), el('span', 'sub', DECKS[deck].length + ' cards'), stats);
      decks.append(card);
    });
    var browse = el('a', 'deck');
    browse.href = '#all';
    browse.append(
      el('span', 'name', 'all cards'),
      el('span', 'sub', total + ' cards'),
      el('span', 'more', 'every question and sign, with answers')
    );
    decks.append(browse);
    app.append(decks);

    var settings = el('div', 'settings');
    var label = el('label', null, 'new per day');
    var input = el('input');
    input.type = 'number';
    input.min = 0;
    input.max = 999;
    input.inputMode = 'numeric';
    input.id = 'new-per-day';
    input.value = state.newPerDay;
    label.htmlFor = input.id;
    input.onchange = function () {
      var n = Math.round(Number(input.value));
      state.newPerDay = n >= 0 ? Math.min(n, 999) : 20;
      save();
      render();
    };
    var reset = el('button', 'plain', 'reset');
    reset.onclick = function () {
      if (!confirm('erase all progress?')) return;
      state.cards = {};
      state.newDone = {};
      undo = null;
      save();
      render();
    };
    settings.append(label, input, reset);
    app.append(settings);
  }

  function study(deck) {
    var now = Date.now();
    var q = queue(deck, now);
    var card = pick(q, now);
    if (!current || current.id !== (card && card.id)) shown = false;
    current = card;
    app.className = 'study';

    var bar = el('nav', 'bar');
    var back = el('a', null, 'decks');
    back.href = '#';
    bar.append(back);
    if (undo && undo.deck === deck) {
      var u = el('button', 'plain', 'undo');
      u.onclick = undoLast;
      bar.append(u);
    }
    bar.append(counts(q));
    app.append(bar);

    var sheet = el('article', 'sheet');
    app.append(sheet);
    if (!card) {
      sheet.append(el('p', 'done', 'done for today'));
      return;
    }

    if (card.img) {
      var img = el('img', 'front');
      img.src = card.img;
      img.alt = '';
      sheet.append(img);
    } else {
      sheet.append(el('p', 'front', card.front));
    }
    if (shown) {
      sheet.append(el('hr'), el('p', 'back', card.back), el('p', 'note', card.note));
    } else {
      sheet.onclick = reveal;
    }

    var actions = el('div', 'actions');
    if (shown) {
      GRADES.forEach(function (name, grade) {
        var b = el('button', name);
        b.append(el('small', null, interval(answer(state.cards[card.id], grade, now), now)), name);
        b.onclick = function () { grade_(deck, grade); };
        actions.append(b);
      });
    } else {
      var show = el('button', null, 'show');
      show.onclick = reveal;
      actions.append(show);
    }
    app.append(actions);
  }

  function reveal() {
    if (!current || shown) return;
    shown = true;
    render();
  }

  function grade_(deck, grade) {
    if (!current || !shown) return;
    var id = current.id;
    var prev = state.cards[id];
    undo = { deck: deck, id: id, card: prev };
    if (!prev) state.newDone[deck] = (state.newDone[deck] || 0) + 1;
    state.cards[id] = answer(prev, grade, Date.now());
    save();
    current = null;
    render();
  }

  function undoLast() {
    if (!undo) return;
    if (undo.card) {
      state.cards[undo.id] = undo.card;
    } else {
      delete state.cards[undo.id];
      state.newDone[undo.deck] = Math.max(0, (state.newDone[undo.deck] || 0) - 1);
    }
    undo = null;
    save();
    current = null;
    render();
  }

  document.addEventListener('keydown', function (e) {
    var deck = deckName();
    if (!deck || !current || fresh || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (shown) grade_(deck, 2); else reveal();
    } else if (shown && e.key >= '1' && e.key <= '4') {
      grade_(deck, Number(e.key) - 1);
    }
  });

  window.addEventListener('hashchange', render);
  // pick up day rollover and newly due cards when the tab comes back
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !shown) render();
  });

  var saved = getCookie();
  if (saved) unlock(saved).catch(function () { lock(false); });
  else lock(false);
})();
