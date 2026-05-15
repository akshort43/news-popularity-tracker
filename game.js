const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function newShoe(decks = 6) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ rank: r, suit: s });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function hiLoCount(card) {
  const v = cardValue(card.rank);
  if (v >= 2 && v <= 6) return +1;
  if (v >= 10 || card.rank === 'A') return -1;
  return 0;
}

class Round {
  constructor(opts = {}) {
    this.decks = opts.decks ?? 6;
    this.dasAllowed = opts.dasAllowed ?? true;
    this.bet = opts.bet ?? 1;
    this.shoe = opts.shoe ?? newShoe(this.decks);
    this.runningCount = opts.runningCount ?? 0;
    this.dealer = [];
    this.hands = [];
    this.active = 0;
    this.phase = 'deal';
  }

  draw() {
    const c = this.shoe.pop();
    this.runningCount += hiLoCount(c);
    return c;
  }

  // Draw the dealer hole card without affecting the running count yet;
  // the count is applied when it's revealed during dealer play / settle.
  drawHidden() {
    return this.shoe.pop();
  }

  reveal(card) {
    this.runningCount += hiLoCount(card);
  }

  deal() {
    this.hands = [{
      cards: [], bet: this.bet, doubled: false, finished: false,
      fromSplit: false, splitAces: false,
    }];
    this.hands[0].cards.push(this.draw());
    this.dealer.push(this.draw());
    this.hands[0].cards.push(this.draw());
    this.dealer.push(this.drawHidden()); // hole card

    const pVal = handValue(this.hands[0].cards).total;
    const dVal = handValue(this.dealer).total;
    if (pVal === 21 || dVal === 21) {
      this.reveal(this.dealer[1]);
      this.phase = 'settle';
    } else {
      this.phase = 'player';
    }
  }

  currentHand() { return this.hands[this.active]; }

  canDouble() {
    const h = this.currentHand();
    if (!h || h.cards.length !== 2) return false;
    if (h.splitAces) return false;
    if (h.fromSplit && !this.dasAllowed) return false;
    return true;
  }

  canSplit() {
    const h = this.currentHand();
    if (!h || h.cards.length !== 2) return false;
    if (!isPair(h.cards)) return false;
    if (this.hands.length >= 4) return false;
    return true;
  }

  hit() {
    const h = this.currentHand();
    h.cards.push(this.draw());
    if (handValue(h.cards).total >= 21) {
      h.finished = true;
      this.advance();
    }
  }

  stand() {
    this.currentHand().finished = true;
    this.advance();
  }

  double() {
    const h = this.currentHand();
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(this.draw());
    h.finished = true;
    this.advance();
  }

  split() {
    const h = this.currentHand();
    const c2 = h.cards.pop();
    const splitAces = h.cards[0].rank === 'A';
    const newHand = {
      cards: [c2], bet: this.bet, doubled: false, finished: false,
      fromSplit: true, splitAces,
    };
    h.fromSplit = true;
    h.splitAces = splitAces;
    h.cards.push(this.draw());
    newHand.cards.push(this.draw());
    this.hands.splice(this.active + 1, 0, newHand);

    if (splitAces) {
      h.finished = true;
      newHand.finished = true;
      this.advance();
    } else if (handValue(h.cards).total === 21) {
      h.finished = true;
      this.advance();
    }
  }

  advance() {
    while (this.active < this.hands.length && this.hands[this.active].finished) {
      this.active++;
    }
    if (this.active >= this.hands.length) {
      this.phase = 'dealer';
    }
  }

  playDealer() {
    // Reveal hole card
    this.reveal(this.dealer[1]);
    const anyAlive = this.hands.some(h => handValue(h.cards).total <= 21);
    if (anyAlive) {
      while (handValue(this.dealer).total < 17) {
        this.dealer.push(this.draw());
      }
    }
    this.phase = 'settle';
  }

  settle() {
    const dVal = handValue(this.dealer).total;
    const dealerBust = dVal > 21;
    const dealerBJ = this.dealer.length === 2 && dVal === 21;
    const results = [];
    let net = 0;

    for (const h of this.hands) {
      const pVal = handValue(h.cards).total;
      const pBust = pVal > 21;
      const pBJ = !h.fromSplit && h.cards.length === 2 && pVal === 21;

      if (pBust)                         { results.push('L'); net -= h.bet; continue; }
      if (pBJ && !dealerBJ)              { results.push('BJ'); net += h.bet * 1.5; continue; }
      if (dealerBJ && !pBJ)              { results.push('L'); net -= h.bet; continue; }
      if (dealerBJ && pBJ)               { results.push('P'); continue; }
      if (dealerBust)                    { results.push('W'); net += h.bet; continue; }
      if (pVal > dVal)                   { results.push('W'); net += h.bet; continue; }
      if (pVal < dVal)                   { results.push('L'); net -= h.bet; continue; }
      results.push('P');
    }

    return { results, net };
  }
}

// Pre-computed list of valid drill situations.
const DRILL_SITUATIONS = (() => {
  const out = [];
  // Pairs
  for (const v of [2,3,4,5,6,7,8,9,10,11]) {
    const rank = v === 11 ? 'A' : String(v);
    out.push({ type: 'pair', cards: [{rank,suit:'♠'},{rank,suit:'♥'}] });
  }
  // Soft (A,2 .. A,9)
  for (const v of [2,3,4,5,6,7,8,9]) {
    out.push({ type: 'soft', cards: [{rank:'A',suit:'♠'},{rank:String(v),suit:'♥'}] });
  }
  // Hard 5-19 from non-pair two-card combos
  const hardCombos = {
    5:[[2,3]], 6:[[2,4]], 7:[[2,5],[3,4]], 8:[[2,6],[3,5]],
    9:[[2,7],[3,6],[4,5]], 10:[[2,8],[3,7],[4,6]],
    11:[[2,9],[3,8],[4,7],[5,6]], 12:[[2,10],[3,9],[4,8],[5,7]],
    13:[[3,10],[4,9],[5,8],[6,7]], 14:[[4,10],[5,9],[6,8]],
    15:[[5,10],[6,9],[7,8]], 16:[[6,10],[7,9]],
    17:[[7,10],[8,9]], 18:[[8,10]], 19:[[9,10]],
  };
  for (const [t, combos] of Object.entries(hardCombos)) {
    for (const [a,b] of combos) {
      const ra = String(a), rb = String(b);
      out.push({ type: 'hard', total: Number(t), cards: [{rank:ra,suit:'♠'},{rank:rb,suit:'♥'}] });
    }
  }
  return out;
})();

const DEALER_RANKS = ['2','3','4','5','6','7','8','9','10','A'];

function randomDrillSituation(weights = null) {
  // weights: optional map of situationKey -> weight (>=1)
  // Generate (player situation, dealer rank) weighted toward weaker spots.
  if (!weights) {
    const sit = DRILL_SITUATIONS[Math.floor(Math.random() * DRILL_SITUATIONS.length)];
    const dr = DEALER_RANKS[Math.floor(Math.random() * 10)];
    return { playerCards: sit.cards.map(c => ({...c})), dealerRank: dr };
  }
  // Build weighted list
  const entries = [];
  let totalW = 0;
  for (const sit of DRILL_SITUATIONS) {
    for (const dr of DEALER_RANKS) {
      const key = situationKey(sit.cards, dr);
      const w = weights[key] ?? 1;
      entries.push({ sit, dr, w });
      totalW += w;
    }
  }
  let r = Math.random() * totalW;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return { playerCards: e.sit.cards.map(c => ({...c})), dealerRank: e.dr };
  }
  const last = entries[entries.length - 1];
  return { playerCards: last.sit.cards.map(c => ({...c})), dealerRank: last.dr };
}
