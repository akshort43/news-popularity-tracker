// UI controller for the blackjack trainer.

const STATE = {
  mode: 'play',                 // 'play' | 'drill' | 'chart'
  round: null,
  drill: null,                  // { playerCards, dealerRank, optimal }
  showHint: false,
  dasAllowed: true,
  decks: 6,
  countingOn: false,
  bet: 10,
  bankroll: 1000,
  stats: loadStats(),
  weights: loadWeights(),       // per-situation miss counts for adaptive drill
  awaitingNext: false,          // true after a drill action, waiting for next
  anim: { dealerN: 0, dealerHidden: false, handsN: [] },
};

// localStorage can throw in Safari (private browsing, blocked cookies),
// so all access goes through these guards; the app then runs in-memory only.
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function loadStats() {
  try {
    const s = JSON.parse(storageGet('bj-stats') || 'null');
    if (s && typeof s.decisions === 'number') return s;
  } catch {}
  return { decisions: 0, correct: 0, hands: 0, net: 0, streak: 0, bestStreak: 0,
           byAction: { H:{c:0,t:0}, S:{c:0,t:0}, D:{c:0,t:0}, P:{c:0,t:0} } };
}
function saveStats() { storageSet('bj-stats', JSON.stringify(STATE.stats)); }
function loadWeights() {
  try { return JSON.parse(storageGet('bj-weights') || '{}'); } catch { return {}; }
}
function saveWeights() { storageSet('bj-weights', JSON.stringify(STATE.weights)); }

// ---------- Card rendering ----------

function suitColor(suit) { return (suit === '♥' || suit === '♦') ? 'red' : 'black'; }

function cardEl(card, faceDown = false) {
  const div = document.createElement('div');
  div.className = 'card' + (faceDown ? ' face-down' : '');
  if (faceDown) return div;
  div.classList.add(suitColor(card.suit));
  div.innerHTML =
    `<div class="corner top">${card.rank}<br>${card.suit}</div>` +
    `<div class="pip">${card.suit}</div>` +
    `<div class="corner bot">${card.rank}<br>${card.suit}</div>`;
  return div;
}

// Render a hand, animating only cards that are new since the previous render.
// `justRevealed` flips the former hole card instead of dealing it in.
function renderHandCards(container, cards, hideIndex, prevN, justRevealed) {
  container.innerHTML = '';
  cards.forEach((c, i) => {
    const el = cardEl(c, i === hideIndex);
    if (i >= prevN) {
      el.classList.add('deal-in');
      el.style.animationDelay = `${(i - prevN) * 140}ms`;
    } else if (justRevealed && i === 1) {
      el.classList.add('flip-in');
    }
    container.appendChild(el);
  });
}

function fmtHand(cards) {
  const { total, soft } = handValue(cards);
  if (total > 21) return `${total} — bust`;
  if (cards.length === 2 && total === 21) return 'Blackjack!';
  return soft ? `${total - 10} / ${total}` : `${total}`;
}

function setText(id, txt) { document.getElementById(id).textContent = txt; }

// ---------- Coach panel ----------

const RING_C = 2 * Math.PI * 52;

function renderStats() {
  const s = STATE.stats;
  const acc = s.decisions ? Math.round((s.correct / s.decisions) * 100) : 0;
  setText('stat-acc', s.decisions ? `${acc}%` : '—');
  setText('stat-decisions', `${s.correct}/${s.decisions}`);
  setText('stat-hands', s.hands);

  const ring = document.getElementById('ring-fg');
  ring.style.strokeDashoffset = s.decisions ? RING_C * (1 - acc / 100) : RING_C;
  ring.style.stroke = !s.decisions ? 'var(--gold)'
    : acc >= 90 ? 'var(--good)' : acc >= 70 ? 'var(--gold)' : 'var(--bad)';

  const netEl = document.getElementById('stat-net');
  netEl.textContent = (s.net >= 0 ? '+' : '−') + Math.abs(s.net).toFixed(1);
  netEl.className = 'v ' + (s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : '');

  const streakEl = document.getElementById('stat-streak');
  streakEl.innerHTML = `${s.streak}${s.streak >= 10 ? ' 🔥' : ''} <small>best ${s.bestStreak}</small>`;

  setText('stat-bankroll', STATE.bankroll.toLocaleString('en-US', { maximumFractionDigits: 0 }));

  const byA = document.getElementById('stat-by-action');
  byA.innerHTML = '';
  for (const a of ['H','S','D','P']) {
    const { c, t } = s.byAction[a];
    const pct = t ? Math.round(c / t * 100) : 0;
    const bar = document.createElement('div');
    bar.className = `abar a-${a}`;
    bar.innerHTML =
      `<span class="nm">${actionLabel(a)}</span>` +
      `<div class="track"><div class="fill" style="width:${t ? pct : 0}%"></div></div>` +
      `<span class="ct">${c}/${t}</span>`;
    byA.appendChild(bar);
  }

  renderWeakSpots();
}

function describeKey(key) {
  const [lhs, dealer] = key.split('|');
  const [kind, val] = lhs.split(':');
  let hand, cards, canSplit = false;
  if (kind === 'P') {
    const r = val.split(',')[0];
    hand = `Pair of ${r}s`;
    cards = [{ rank: r }, { rank: r }];
    canSplit = true;
  } else if (kind === 'S') {
    const t = parseInt(val, 10);
    hand = `Soft ${t}`;
    cards = [{ rank: 'A' }, { rank: String(t - 11) }];
  } else {
    const t = parseInt(val, 10);
    hand = `Hard ${t}`;
    const a = t <= 11 ? 2 : t - 10;
    const b = t <= 11 ? t - 2 : 10;
    cards = [{ rank: String(a) }, { rank: b === 10 ? '10' : String(b) }];
  }
  const { action } = getOptimalAction(cards, dealer, {
    canDouble: true, canSplit, dasAllowed: STATE.dasAllowed,
  });
  return { text: `${hand} vs ${dealer}`, answer: actionLabel(action) };
}

function renderWeakSpots() {
  const el = document.getElementById('weak-spots');
  const spots = Object.entries(STATE.weights)
    .filter(([, w]) => w >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  el.innerHTML = '';
  if (!spots.length) {
    el.innerHTML = '<span class="muted">No misses yet — keep playing.</span>';
    return;
  }
  for (const [key] of spots) {
    const { text, answer } = describeKey(key);
    const row = document.createElement('div');
    row.className = 'weak-spot';
    row.innerHTML = `<span>${text}</span><span class="ans">${answer}</span>`;
    el.appendChild(row);
  }
}

// ---------- Shared UI ----------

function setActionButtons({ hit, stand, dbl, split }) {
  document.getElementById('btn-hit').disabled = !hit;
  document.getElementById('btn-stand').disabled = !stand;
  document.getElementById('btn-double').disabled = !dbl;
  document.getElementById('btn-split').disabled = !split;
}

function setChipsEnabled(on) {
  document.querySelectorAll('.chip').forEach(c => { c.disabled = !on; });
}

function showFeedback(correct, optimalAction, playerCards, dealerRank, chosen) {
  const fb = document.getElementById('feedback');
  fb.classList.remove('correct', 'wrong');
  const why = explainAction(playerCards, dealerRank, optimalAction);
  if (correct) {
    fb.classList.add('correct');
    fb.innerHTML = `✓ ${actionLabel(optimalAction)} — correct.<span class="why">${why}</span>`;
  } else {
    fb.classList.add('wrong');
    fb.innerHTML = `✗ You chose ${actionLabel(chosen)} — optimal is <strong>${actionLabel(optimalAction)}</strong>.` +
                   `<span class="why">${why}</span>`;
  }
}

function clearFeedback() {
  const fb = document.getElementById('feedback');
  fb.classList.remove('correct','wrong');
  fb.textContent = '';
}

function showHint(round) {
  const hintEl = document.getElementById('hint');
  if (!STATE.showHint || !round || round.phase !== 'player') {
    hintEl.textContent = '';
    return;
  }
  const h = round.currentHand();
  const { action } = getOptimalAction(h.cards, round.dealer[0].rank, {
    canDouble: round.canDouble(),
    canSplit: round.canSplit(),
    dasAllowed: round.dasAllowed,
  });
  hintEl.textContent = `Hint: ${actionLabel(action)}`;
}

function showCount(round) {
  const el = document.getElementById('count');
  if (!STATE.countingOn || !round || STATE.mode !== 'play') {
    el.textContent = '';
    return;
  }
  const decksLeft = Math.max(round.shoe.length / 52, 0.5);
  const trueCount = round.runningCount / decksLeft;
  el.textContent = `Running ${round.runningCount >= 0 ? '+' : ''}${round.runningCount} · ` +
                   `True ${trueCount >= 0 ? '+' : ''}${trueCount.toFixed(1)}`;
}

function recordDecision(action, correct, key) {
  const s = STATE.stats;
  s.decisions++;
  s.byAction[action].t++;
  if (correct) {
    s.correct++;
    s.byAction[action].c++;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    // Decay weight slightly on success
    if (STATE.weights[key]) {
      STATE.weights[key] = Math.max(1, STATE.weights[key] - 0.5);
    }
  } else {
    s.streak = 0;
    STATE.weights[key] = (STATE.weights[key] ?? 1) + 4;
  }
  saveStats();
  saveWeights();
  renderStats();
}

// ---------- Play mode ----------

function startRound() {
  clearFeedback();
  STATE.anim = { dealerN: 0, dealerHidden: false, handsN: [] };
  STATE.round = new Round({ decks: STATE.decks, dasAllowed: STATE.dasAllowed, bet: STATE.bet,
                            shoe: STATE.round?.shoe?.length > 20 ? STATE.round.shoe : undefined,
                            runningCount: STATE.round?.shoe?.length > 20 ? STATE.round.runningCount : 0 });
  STATE.round.deal();
  document.getElementById('btn-deal').disabled = true;
  setChipsEnabled(false);
  renderRound();
  if (STATE.round.phase === 'settle') finishRound();
}

function renderRound() {
  const r = STATE.round;
  if (!r) return;

  const inPlay = r.phase === 'player';
  const hideIdx = inPlay ? 1 : -1;
  const dealerCards = document.getElementById('dealer-cards');
  const justRevealed = STATE.anim.dealerHidden && hideIdx === -1;
  renderHandCards(dealerCards, r.dealer, hideIdx, STATE.anim.dealerN, justRevealed);
  STATE.anim.dealerN = r.dealer.length;
  STATE.anim.dealerHidden = hideIdx === 1;

  document.getElementById('dealer-total').textContent = inPlay
    ? `Showing ${cardValue(r.dealer[0].rank)}`
    : fmtHand(r.dealer);

  const playerArea = document.getElementById('player-area');
  playerArea.innerHTML = '';
  r.hands.forEach((h, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'player-hand' + (i === r.active && inPlay ? ' active' : '');
    const lbl = document.createElement('div');
    lbl.className = 'hand-label';
    const tags = [h.doubled && 'doubled', h.fromSplit && 'split'].filter(Boolean).join(', ');
    lbl.textContent = `${r.hands.length > 1 ? `Hand ${i+1} · ` : ''}${tags ? tags + ' · ' : ''}bet ${h.bet}`;
    wrap.appendChild(lbl);
    const cardsRow = document.createElement('div');
    cardsRow.className = 'cards-row';
    wrap.appendChild(cardsRow);
    renderHandCards(cardsRow, h.cards, -1, STATE.anim.handsN[i] ?? 0, false);
    STATE.anim.handsN[i] = h.cards.length;
    const tot = document.createElement('div');
    tot.className = 'hand-total';
    tot.textContent = fmtHand(h.cards);
    wrap.appendChild(tot);
    playerArea.appendChild(wrap);
  });

  if (inPlay) {
    setActionButtons({ hit: true, stand: true, dbl: r.canDouble(), split: r.canSplit() });
  } else {
    setActionButtons({ hit: false, stand: false, dbl: false, split: false });
  }
  showHint(r);
  showCount(r);
}

function playerAction(action) {
  const r = STATE.round;
  if (!r || r.phase !== 'player') return;

  const h = r.currentHand();
  const dealerRank = r.dealer[0].rank;
  const { action: optimal } = getOptimalAction(h.cards, dealerRank, {
    canDouble: r.canDouble(),
    canSplit: r.canSplit(),
    dasAllowed: r.dasAllowed,
  });
  const key = situationKey(h.cards, dealerRank);
  const correct = action === optimal;
  recordDecision(action, correct, key);
  showFeedback(correct, optimal, [...h.cards], dealerRank, action);

  if (action === 'H') r.hit();
  else if (action === 'S') r.stand();
  else if (action === 'D' && r.canDouble()) r.double();
  else if (action === 'P' && r.canSplit()) r.split();
  else {
    // Illegal action selection: treat as hit (button should have been disabled)
    r.hit();
  }

  renderRound();

  if (r.phase === 'dealer') {
    setTimeout(() => {
      r.playDealer();
      renderRound();
      finishRound();
    }, 500);
  }
}

function finishRound() {
  const r = STATE.round;
  const { results, net } = r.settle();
  STATE.bankroll += net;
  STATE.stats.hands += r.hands.length;
  STATE.stats.net += net;
  saveStats();

  const playerArea = document.getElementById('player-area');
  Array.from(playerArea.children).forEach((el, i) => {
    const res = results[i];
    const tag = document.createElement('div');
    tag.className = 'result-tag ' + (res === 'W' || res === 'BJ' ? 'win' : res === 'L' ? 'lose' : 'push');
    tag.textContent = res === 'BJ' ? 'BLACKJACK +' + (r.hands[i].bet * 1.5).toFixed(1)
                    : res === 'W' ? 'WIN +' + r.hands[i].bet
                    : res === 'L' ? 'LOSE −' + r.hands[i].bet
                    : 'PUSH';
    el.appendChild(tag);
  });

  setActionButtons({ hit: false, stand: false, dbl: false, split: false });
  const deal = document.getElementById('btn-deal');
  deal.disabled = false;
  deal.innerHTML = 'Next hand <span class="key">⏎</span>';
  setChipsEnabled(true);
  renderStats();
}

// ---------- Drill mode ----------

function nextDrill() {
  clearFeedback();
  STATE.awaitingNext = false;
  STATE.anim = { dealerN: 0, dealerHidden: false, handsN: [] };
  const sit = randomDrillSituation(STATE.weights);
  const { action: optimal } = getOptimalAction(sit.playerCards, sit.dealerRank, {
    canDouble: true, canSplit: true, dasAllowed: STATE.dasAllowed,
  });
  STATE.drill = { ...sit, optimal };
  renderDrill();
}

function renderDrill() {
  const d = STATE.drill;
  if (!d) return;
  const dealerCards = document.getElementById('dealer-cards');
  renderHandCards(dealerCards, [{ rank: d.dealerRank, suit: '♠' }], -1, 0, false);
  document.getElementById('dealer-total').textContent = `Upcard: ${d.dealerRank}`;

  const playerArea = document.getElementById('player-area');
  playerArea.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'player-hand active';
  const row = document.createElement('div');
  row.className = 'cards-row';
  wrap.appendChild(row);
  renderHandCards(row, d.playerCards, -1, 0, false);
  const tot = document.createElement('div');
  tot.className = 'hand-total';
  tot.textContent = fmtHand(d.playerCards);
  wrap.appendChild(tot);
  playerArea.appendChild(wrap);

  const canSplit = isPair(d.playerCards);
  setActionButtons({ hit: true, stand: true, dbl: true, split: canSplit });

  document.getElementById('hint').textContent =
    STATE.showHint ? `Hint: ${actionLabel(d.optimal)}` : '';
}

function drillAction(action) {
  const d = STATE.drill;
  if (!d || STATE.awaitingNext) return;
  if (action === 'P' && !isPair(d.playerCards)) return;
  const key = situationKey(d.playerCards, d.dealerRank);
  const correct = action === d.optimal;
  recordDecision(action, correct, key);
  showFeedback(correct, d.optimal, d.playerCards, d.dealerRank, action);
  STATE.awaitingNext = true;
  // Auto-advance after a short pause
  setTimeout(() => { if (STATE.mode === 'drill') nextDrill(); }, correct ? 800 : 2200);
}

// ---------- Mode/UI wiring ----------

function setMode(mode) {
  STATE.mode = mode;
  clearFeedback();
  for (const m of ['play','drill','chart']) {
    document.getElementById(`btn-mode-${m}`).classList.toggle('active', mode === m);
  }
  document.getElementById('view-game').hidden = mode === 'chart';
  document.getElementById('view-chart').hidden = mode !== 'chart';
  if (mode === 'chart') return;

  document.getElementById('play-controls').style.display = mode === 'play' ? '' : 'none';

  if (mode === 'play') {
    STATE.round = null;
    const deal = document.getElementById('btn-deal');
    deal.disabled = false;
    deal.innerHTML = 'Deal <span class="key">⏎</span>';
    setChipsEnabled(true);
    setActionButtons({ hit: false, stand: false, dbl: false, split: false });
    document.getElementById('player-area').innerHTML =
      '<div class="empty-felt">Press <strong>Deal</strong> to start a hand</div>';
    document.getElementById('dealer-cards').innerHTML = '';
    document.getElementById('dealer-total').textContent = '';
    document.getElementById('hint').textContent = '';
    document.getElementById('count').textContent = '';
  } else {
    nextDrill();
  }
}

function resetStats() {
  STATE.stats = { decisions: 0, correct: 0, hands: 0, net: 0, streak: 0, bestStreak: 0,
                  byAction: { H:{c:0,t:0}, S:{c:0,t:0}, D:{c:0,t:0}, P:{c:0,t:0} } };
  STATE.weights = {};
  STATE.bankroll = 1000;
  saveStats(); saveWeights();
  renderStats();
}

function wireUp() {
  document.getElementById('btn-hit').addEventListener('click', () => {
    STATE.mode === 'play' ? playerAction('H') : drillAction('H');
  });
  document.getElementById('btn-stand').addEventListener('click', () => {
    STATE.mode === 'play' ? playerAction('S') : drillAction('S');
  });
  document.getElementById('btn-double').addEventListener('click', () => {
    STATE.mode === 'play' ? playerAction('D') : drillAction('D');
  });
  document.getElementById('btn-split').addEventListener('click', () => {
    STATE.mode === 'play' ? playerAction('P') : drillAction('P');
  });
  document.getElementById('btn-deal').addEventListener('click', startRound);

  document.getElementById('btn-mode-play').addEventListener('click', () => setMode('play'));
  document.getElementById('btn-mode-drill').addEventListener('click', () => setMode('drill'));
  document.getElementById('btn-mode-chart').addEventListener('click', () => setMode('chart'));

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      STATE.bet = parseInt(chip.dataset.bet, 10);
      document.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c === chip));
    });
  });

  document.getElementById('chk-hint').addEventListener('change', e => {
    STATE.showHint = e.target.checked;
    if (STATE.mode === 'play') showHint(STATE.round);
    else if (STATE.mode === 'drill') renderDrill();
  });
  document.getElementById('chk-das').addEventListener('change', e => {
    STATE.dasAllowed = e.target.checked;
  });
  document.getElementById('chk-count').addEventListener('change', e => {
    STATE.countingOn = e.target.checked;
    showCount(STATE.round);
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Reset all stats and weights?')) resetStats();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'h') document.getElementById('btn-hit').click();
    else if (k === 's') document.getElementById('btn-stand').click();
    else if (k === 'd') document.getElementById('btn-double').click();
    else if (k === 'p') document.getElementById('btn-split').click();
    else if (k === 'enter' || k === ' ') {
      if (STATE.mode !== 'play') return;
      const deal = document.getElementById('btn-deal');
      if (!deal.disabled) deal.click();
      e.preventDefault();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  wireUp();
  renderStrategyCharts(document.getElementById('charts'));
  renderStats();
  setMode('play');
});
