// Basic strategy: 4-8 decks, dealer stands on soft 17 (S17),
// double after split allowed (DAS), no surrender.
// Codes: H=hit, S=stand, D=double-else-hit, Ds=double-else-stand,
// P=split, Ph=split-if-DAS-else-hit.
// Columns: dealer upcard 2,3,4,5,6,7,8,9,10,A.

const HARD = {
  5:  ['H','H','H','H','H','H','H','H','H','H'],
  6:  ['H','H','H','H','H','H','H','H','H','H'],
  7:  ['H','H','H','H','H','H','H','H','H','H'],
  8:  ['H','H','H','H','H','H','H','H','H','H'],
  9:  ['H','D','D','D','D','H','H','H','H','H'],
  10: ['D','D','D','D','D','D','D','D','H','H'],
  11: ['D','D','D','D','D','D','D','D','D','D'],
  12: ['H','H','S','S','S','H','H','H','H','H'],
  13: ['S','S','S','S','S','H','H','H','H','H'],
  14: ['S','S','S','S','S','H','H','H','H','H'],
  15: ['S','S','S','S','S','H','H','H','H','H'],
  16: ['S','S','S','S','S','H','H','H','H','H'],
  17: ['S','S','S','S','S','S','S','S','S','S'],
  18: ['S','S','S','S','S','S','S','S','S','S'],
  19: ['S','S','S','S','S','S','S','S','S','S'],
  20: ['S','S','S','S','S','S','S','S','S','S'],
  21: ['S','S','S','S','S','S','S','S','S','S'],
};

const SOFT = {
  13: ['H','H','H','D','D','H','H','H','H','H'],     // A,2
  14: ['H','H','H','D','D','H','H','H','H','H'],     // A,3
  15: ['H','H','D','D','D','H','H','H','H','H'],     // A,4
  16: ['H','H','D','D','D','H','H','H','H','H'],     // A,5
  17: ['H','D','D','D','D','H','H','H','H','H'],     // A,6
  18: ['S','Ds','Ds','Ds','Ds','S','S','H','H','H'], // A,7
  19: ['S','S','S','S','S','S','S','S','S','S'],     // A,8
  20: ['S','S','S','S','S','S','S','S','S','S'],     // A,9
};

const PAIRS = {
  '2,2':   ['P','P','P','P','P','P','H','H','H','H'],
  '3,3':   ['P','P','P','P','P','P','H','H','H','H'],
  '4,4':   ['H','H','H','Ph','Ph','H','H','H','H','H'],
  '5,5':   ['D','D','D','D','D','D','D','D','H','H'],
  '6,6':   ['Ph','P','P','P','P','H','H','H','H','H'],
  '7,7':   ['P','P','P','P','P','P','H','H','H','H'],
  '8,8':   ['P','P','P','P','P','P','P','P','P','P'],
  '9,9':   ['P','P','P','P','P','S','P','P','S','S'],
  '10,10': ['S','S','S','S','S','S','S','S','S','S'],
  'A,A':   ['P','P','P','P','P','P','P','P','P','P'],
};

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { total += 11; aces++; }
    else total += cardValue(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 && total <= 21 };
}

function isPair(cards) {
  if (cards.length !== 2) return false;
  return cardValue(cards[0].rank) === cardValue(cards[1].rank);
}

function pairKey(cards) {
  if (cards[0].rank === 'A') return 'A,A';
  const v = cardValue(cards[0].rank);
  return `${v},${v}`;
}

function dealerColIdx(rank) {
  if (rank === 'A') return 9;
  return cardValue(rank) - 2;
}

function getOptimalAction(playerCards, dealerUpcardRank, opts = {}) {
  const { canDouble = true, canSplit = true, dasAllowed = true } = opts;
  const col = dealerColIdx(dealerUpcardRank);
  let raw;

  if (canSplit && isPair(playerCards)) {
    raw = PAIRS[pairKey(playerCards)][col];
  } else {
    const { total, soft } = handValue(playerCards);
    if (soft && SOFT[total]) raw = SOFT[total][col];
    else {
      const t = Math.min(Math.max(total, 5), 21);
      raw = HARD[t][col];
    }
  }

  let action = raw;
  if (raw === 'D') action = canDouble ? 'D' : 'H';
  else if (raw === 'Ds') action = canDouble ? 'D' : 'S';
  else if (raw === 'Ph') action = dasAllowed ? 'P' : 'H';

  return { action, raw };
}

function explainAction(playerCards, dealerRank, action) {
  const dealerVal = cardValue(dealerRank);
  const { total, soft } = handValue(playerCards);
  const pair = isPair(playerCards);

  if (pair && action === 'P') {
    const v = cardValue(playerCards[0].rank);
    if (v === 11) return "Always split aces — two strong starts beat a soft 12.";
    if (v === 8)  return "Always split 8s — turns a losing 16 into two fresh hands.";
    if (v === 9)  return `Split 9s vs ${dealerRank}: two 9s beat standing on 18 here.`;
    return `Split ${playerCards[0].rank}s vs ${dealerRank} — positive expected value.`;
  }
  if (pair) {
    const v = cardValue(playerCards[0].rank);
    if (v === 10) return "Never split 10s — 20 is already one of the best totals.";
    if (v === 5)  return "Never split 5s — a hard 10 is a strong doubling hand.";
    if (v === 9 && (dealerVal === 7 || dealerVal === 10 || dealerRank === 'A')) {
      return `Stand on 18 vs ${dealerRank} — splitting here loses EV.`;
    }
    if (v === 4)  return "4s only split with DAS vs 5/6; otherwise hit (8 is a fine hitting total).";
  }

  if (soft) {
    if (action === 'D') return `Double soft ${total} — dealer ${dealerRank} is weak; you can't bust on one card.`;
    if (action === 'S') return `Stand on soft ${total} — strong enough vs ${dealerRank}.`;
    if (action === 'H') return `Hit soft ${total} — drawing is free (ace as 1 saves you); need a better total vs ${dealerRank}.`;
  }

  if (total >= 17) return `Stand on hard ${total} — any hit is too risky.`;
  if (total === 11) return "Double 11 — high chance of landing 10/face for 21.";
  if (total === 10) return `Double 10 vs ${dealerRank} — you start ahead of dealer's likely total.`;
  if (total === 9 && action === 'D') return "Double 9 vs 3–6 — leverage dealer's bust risk.";
  if (total >= 12 && total <= 16) {
    if (dealerVal >= 2 && dealerVal <= 6) return `Stand on hard ${total} — dealer's weak ${dealerRank} busts often.`;
    return `Hit hard ${total} — dealer ${dealerRank} is strong; standing loses too often.`;
  }
  if (total <= 8) return `Hit — ${total} can't bust and needs improvement.`;
  return "Follow basic strategy.";
}

function actionLabel(a) {
  return { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' }[a] || a;
}

function situationKey(playerCards, dealerRank) {
  if (isPair(playerCards)) return `P:${pairKey(playerCards)}|${dealerRank}`;
  const { total, soft } = handValue(playerCards);
  return `${soft ? 'S' : 'H'}:${total}|${dealerRank}`;
}
