// Renders the basic strategy reference charts from the tables in strategy.js.

const DEALER_HEADERS = ['2','3','4','5','6','7','8','9','10','A'];

function chartTable(title, rows) {
  // rows: [{ label, cells: ['H','S',...] }]
  const card = document.createElement('div');
  card.className = 'chart-card';

  const h = document.createElement('h3');
  h.textContent = title;
  card.appendChild(h);

  const table = document.createElement('table');
  table.className = 'strategy';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(document.createElement('th'));
  for (const d of DEALER_HEADERS) {
    const th = document.createElement('th');
    th.textContent = d;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.className = 'rowhead';
    th.textContent = row.label;
    tr.appendChild(th);
    for (const code of row.cells) {
      const td = document.createElement('td');
      td.className = `c-${code}`;
      td.textContent = code;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
  return card;
}

function renderStrategyCharts(container) {
  container.innerHTML = '';

  const hardRows = [{ label: '8 or less', cells: HARD[8] }];
  for (let t = 9; t <= 16; t++) hardRows.push({ label: String(t), cells: HARD[t] });
  hardRows.push({ label: '17+', cells: HARD[17] });
  container.appendChild(chartTable('Hard totals', hardRows));

  const softRows = [];
  for (let t = 13; t <= 20; t++) {
    softRows.push({ label: `A,${t - 11}`, cells: SOFT[t] });
  }
  container.appendChild(chartTable('Soft totals', softRows));

  const pairRows = [];
  for (const v of [2,3,4,5,6,7,8,9,10]) {
    pairRows.push({ label: `${v},${v}`, cells: PAIRS[`${v},${v}`] });
  }
  pairRows.push({ label: 'A,A', cells: PAIRS['A,A'] });
  container.appendChild(chartTable('Pairs', pairRows));
}
