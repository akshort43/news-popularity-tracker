// UI controller for the blackjack trainer.

const STATE = {
  mode: 'play',                 // 'play' | 'drill'
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
};

function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem('bj-stats') || 'null');
    if (s && typeof s.decisions === 'number') return s;
  } catch {}
  return { decisions: 0, correct: 0, hands: 0, net: 0, streak: 0, bestStreak: 0,
           byAction: { H:{c:0,t:0}, S:{c:0,t:0}, D:{c:0,t:0}, P:{c:0,t:0} } };
}
function saveStats() { localStorage.setItem('bj-stats', JSON.stringify(STATE.stats)); }
function loadWeights() {
  try { return JSON.parse(localStorage.getItem('bj-weights') || '{}'); } catch { return {}; }
}
function saveWeights() { localStorage.setItem('bj-weights', JSON.stringify(STATE.weights)); }

// ---------- Rendering ----------

function suitColor(suit) { return (suit === '♥' || suit === '♦') ? 'red' : 'black'; }

function cardEl(card, faceDown = false) {
  const div = document.createElement('div');
  div.className = 'card' + (faceDown ? ' face-down' : '');
  if (faceDown) { div.textContent = ''; return div; }
  div.classList.add(suitColor(card.suit));
  div.innerHTML =
    `<div class="corner top">${card.rank}<br>${card.suit}</div>` +
    `<div class="pip">${card.suit}</div>` +
    `<div class="corner bot">${card.rank}<br>${card.suit}</div>`;
  return div;
}

function renderCards(container, cards, hideIndex = -1) {
  container.innerHTML = '';
  cards.forEach((c, i) => container.appendChild(cardEl(c, i === hideIndex)));
}

function fmtHand(cards) {
  const { total, soft } = handValue(cards);
  if (total > 21) return `${total} (bust)`;
  if (cards.length === 2 && total === 21) return 'Blackjack!';
  return soft ? `${total - 10}/${total}` : `${total}`;
}

function setText(id, txt) { document.getElementById(id).textContent = txt; }

function renderStats() {
  const s = STATE.stats;
  const acc = s.decisions ? Math.round((s.correct / s.decisions) * 100) : 0;
  setText('stat-acc', `${acc}%`);
  setText('stat-decisions', `${s.correct}/${s.decisions}`);
  setText('stat-hands', s.hands);
  setText('stat-net', (s.net >= 0 ? '+' : '') + s.net.toFixed(1));
  setText('stat-streak', `${s.streak} (best ${s.bestStreak})`);
  setText('stat-bankroll', STATE.bankroll.toFixed(0));

  const byA = document.getElementById('stat-by-action');
  byA.innerHTML = '';
  for (const a of ['H','S','D','P']) {
    const { c, t } = s.byAction[a];
    const pct = t ? Math.round(c/t*100) : 0;
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = `${actionLabel(a)} ${c}/${t} (${pct}%)`;
    byA.appendChild(span);
  }
}

function setActionButtons({ hit, stand, dbl, split }) {
  document.getElementById('btn-hit').disabled = !hit;
  document.getElementById('btn-stand').disabled = !stand;
  document.getElementById('btn-double').disabled = !dbl;
  document.getElementById('btn-split').disabled = !split;
}

function showFeedback(correct, optimalAction, playerCards, dealerRank, chosen) {
  const fb = document.getElementById('feedback');
  fb.classList.remove('correct', 'wrong');
  if (correct) {
    fb.classList.add('correct');
    fb.textContent = `✓ Correct — ${actionLabel(optimalAction)}.`;
  } else {
    fb.classList.add('wrong');
    const why = explainAction(playerCards, dealerRank, optimalAction);
    fb.textContent = `✗ You chose ${actionLabel(chosen)}. Optimal: ${actionLabel(optimalAction)}. ${why}`;
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
  STATE.round = new Round({ decks: STATE.decks, dasAllowed: STATE.dasAllowed, bet: STATE.bet,
                            shoe: STATE.round?.shoe?.length > 20 ? STATE.round.shoe : undefined,
                            runningCount: STATE.round?.shoe?.length > 20 ? STATE.round.runningCount : 0 });
  STATE.round.deal();
  renderRound();
  if (STATE.round.phase === 'settle') finishRound();
}

function renderRound() {
  const r = STATE.round;
  if (!r) return;

  const dealerCards = document.getElementById('dealer-cards');
  const inPlay = r.phase === 'player';
  renderCards(dealerCards, r.dealer, inPlay ? 1 : -1);
  document.getElementById('dealer-total').textContent = inPlay
    ? `${cardValue(r.dealer[0].rank === 'A' ? 'A' : r.dealer[0].rank)}` // showing only upcard value
    : fmtHand(r.dealer);

  const playerArea = document.getElementById('player-area');
  playerArea.innerHTML = '';
  r.hands.forEach((h, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'player-hand' + (i === r.active && r.phase === 'player' ? ' active' : '');
    const lbl = document.createElement('div');
    lbl.className = 'hand-label';
    lbl.textContent = `Hand ${i+1}${h.doubled ? ' (doubled)' : ''}${h.fromSplit ? ' (split)' : ''} — bet ${h.bet}`;
    wrap.appendChild(lbl);
    const cardsRow = document.createElement('div');
    cardsRow.className = 'cards-row';
    h.cards.forEach(c => cardsRow.appendChild(cardEl(c)));
    wrap.appendChild(cardsRow);
    const tot = document.createElement('div');
    tot.className = 'hand-total';
    tot.textContent = fmtHand(h.cards);
    wrap.appendChild(tot);
    playerArea.appendChild(wrap);
  });

  if (r.phase === 'player') {
    setActionButtons({ hit: true, stand: true, dbl: r.canDouble(), split: r.canSplit() });
    showHint(r);
  } else {
    setActionButtons({ hit: false, stand: false, dbl: false, split: false });
    document.getElementById('hint').textContent = '';
  }

  if (STATE.countingOn) {
    document.getElementById('count').textContent = `Running count: ${r.runningCount}`;
  } else {
    document.getElementById('count').textContent = '';
  }
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
    }, 350);
  }
}

function finishRound() {
  const r = STATE.round;
  const { results, net } = r.settle();
  STATE.bankroll += net;
  STATE.stats.hands += r.hands.length;
  STATE.stats.net += net;
  saveStats();

  // Render dealer fully and result strip
  renderCards(document.getElementById('dealer-cards'), r.dealer, -1);
  document.getElementById('dealer-total').textContent = fmtHand(r.dealer);

  const playerArea = document.getElementById('player-area');
  Array.from(playerArea.children).forEach((el, i) => {
    const res = results[i];
    const tag = document.createElement('div');
    tag.className = 'result-tag ' + (res === 'W' || res === 'BJ' ? 'win' : res === 'L' ? 'lose' : 'push');
    tag.textContent = res === 'BJ' ? 'BLACKJACK +' + (r.hands[i].bet * 1.5).toFixed(1)
                    : res === 'W' ? 'WIN +' + r.hands[i].bet
                    : res === 'L' ? 'LOSE -' + r.hands[i].bet
                    : 'PUSH';
    el.appendChild(tag);
  });

  setActionButtons({ hit: false, stand: false, dbl: false, split: false });
  document.getElementById('btn-deal').disabled = false;
  document.getElementById('btn-deal').textContent = 'Next hand';
  renderStats();
}

// ---------- Drill mode ----------

function nextDrill() {
  clearFeedback();
  STATE.awaitingNext = false;
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
  renderCards(dealerCards, [{ rank: d.dealerRank, suit: '♠' }]);
  document.getElementById('dealer-total').textContent = `Upcard: ${d.dealerRank}`;

  const playerArea = document.getElementById('player-area');
  playerArea.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'player-hand active';
  const row = document.createElement('div');
  row.className = 'cards-row';
  d.playerCards.forEach(c => row.appendChild(cardEl(c)));
  wrap.appendChild(row);
  const tot = document.createElement('div');
  tot.className = 'hand-total';
  tot.textContent = fmtHand(d.playerCards);
  wrap.appendChild(tot);
  playerArea.appendChild(wrap);

  const canSplit = isPair(d.playerCards);
  setActionButtons({ hit: true, stand: true, dbl: true, split: canSplit });

  if (STATE.showHint) {
    document.getElementById('hint').textContent = `Hint: ${actionLabel(d.optimal)}`;
  } else {
    document.getElementById('hint').textContent = '';
  }
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
  setTimeout(() => { if (STATE.mode === 'drill') nextDrill(); }, correct ? 700 : 1800);
}

// ---------- Mode/UI wiring ----------

function setMode(mode) {
  STATE.mode = mode;
  clearFeedback();
  document.getElementById('btn-mode-play').classList.toggle('active', mode === 'play');
  document.getElementById('btn-mode-drill').classList.toggle('active', mode === 'drill');
  document.getElementById('play-controls').style.display = mode === 'play' ? '' : 'none';
  document.getElementById('count').style.display = mode === 'play' ? '' : 'none';

  if (mode === 'play') {
    document.getElementById('btn-deal').disabled = false;
    document.getElementById('btn-deal').textContent = 'Deal';
    setActionButtons({ hit: false, stand: false, dbl: false, split: false });
    document.getElementById('player-area').innerHTML = '';
    document.getElementById('dealer-cards').innerHTML = '';
    document.getElementById('dealer-total').textContent = '';
  } else {
    document.getElementById('btn-deal').disabled = true;
    document.getElementById('btn-deal').textContent = '—';
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

  document.getElementById('chk-hint').addEventListener('change', e => {
    STATE.showHint = e.target.checked;
    if (STATE.mode === 'play') showHint(STATE.round);
    else renderDrill();
  });
  document.getElementById('chk-das').addEventListener('change', e => {
    STATE.dasAllowed = e.target.checked;
  });
  document.getElementById('chk-count').addEventListener('change', e => {
    STATE.countingOn = e.target.checked;
    if (STATE.round) renderRound();
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
      const deal = document.getElementById('btn-deal');
      if (!deal.disabled) deal.click();
      e.preventDefault();
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  wireUp();
  renderStats();
  setMode('play');
});
