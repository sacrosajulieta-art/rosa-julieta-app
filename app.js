// ==================== CONFIG ====================
// Substitua pela URL e chave do SEU projeto Supabase (Settings > API Keys)
const SUPABASE_URL = 'https://hiqsjbxxvirdxcegtkfl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JfxpEAafLngstJeouuaepA_RHqRUFOT';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORIAS_SAIDA = {
  'Custos fixos': [
    'Aluguel', 'Funcionários — salário', 'Funcionários — encargos/benefícios',
    'Pró-labore', 'Água', 'Energia', 'Internet/Telefone', 'Contador',
    'Softwares/Assinaturas', 'Manutenção de máquinas',
  ],
  'Custos variáveis': [
    'Tecido', 'Aviamento', 'Corte e costura (terceirizado)', 'Embalagem',
    'Frete/Logística', 'Taxas de marketplace', 'Ads/Marketing',
    'Impostos sobre venda', 'Etiquetas/Tags', 'Reposição de estoque',
  ],
};
const NATUREZA_POR_CATEGORIA = (() => {
  const map = {};
  Object.entries(CATEGORIAS_SAIDA).forEach(([grupo, itens]) => {
    const nat = grupo === 'Custos fixos' ? 'fixo' : 'variavel';
    itens.forEach((c) => (map[c] = nat));
  });
  return map;
})();

// ==================== HELPERS ====================
const fmt = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => d.slice(0, 7);
const esc = (s) => (s ?? '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function parseBRNumber(str) {
  if (typeof str !== 'string') return Number(str) || 0;
  const cleaned = str.replace(/[^\d,.-]/g, '');
  if (cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  return parseFloat(cleaned.replace(/,/g, '')) || 0;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const splitLine = (line) => {
    const delim = line.includes(';') && !line.includes(',') ? ';' : ',';
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === delim && !inQ) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}
function guessValueField(row) {
  // prioriza valores por item de linha (evita duplicar o total do pedido quando há várias variações)
  const candidates = ['subtotal do produto', 'valor total', 'valor', 'total', 'preço total', 'preco total', 'valor do produto', 'receita'];
  for (const c of candidates) if (row[c]) return row[c];
  return null;
}
function guessDescricaoField(row, fallback) {
  const candidates = ['nome do produto', 'produto', 'título', 'titulo', 'descrição', 'descricao'];
  for (const c of candidates) if (row[c]) return String(row[c]);
  return fallback;
}

async function parseXLSX(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  // normaliza chaves pra minúsculo, igual o parseCSV
  return json.map((row) => {
    const norm = {};
    Object.entries(row).forEach(([k, v]) => { norm[String(k).toLowerCase().trim()] = v; });
    return norm;
  });
}

function exportCSV(txMes, monthLabel) {
  if (!txMes.length) { alert('Não há lançamentos neste mês pra exportar.'); return; }
  const rows = [['Data', 'Tipo', 'Categoria', 'Natureza', 'Descrição', 'Valor']];
  [...txMes].sort((a, b) => a.data.localeCompare(b.data)).forEach((t) => {
    rows.push([
      t.data,
      t.tipo === 'entrada' ? 'Entrada' : 'Saída',
      t.categoria,
      t.natureza === 'fixo' ? 'Fixo' : t.natureza === 'variavel' ? 'Variável' : '',
      t.descricao || '',
      t.valor.toFixed(2).replace('.', ','),
    ]);
  });
  const csvContent = rows.map((r) =>
    r.map((cell) => {
      const s = String(cell);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')
  ).join('\r\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rosa-julieta-financeiro-${monthLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==================== STATE ====================
const state = {
  tab: 'dashboard',
  tx: [],
  produtos: [],
  selectedMonth: todayStr().slice(0, 7),
  loading: true,
  showTxForm: false,
  showUpload: false,
  showProdutoForm: false,
  entradaOpenId: null,
  editingTxId: null,
  editingProdutoId: null,
  selectMode: false,
  selectedTxIds: new Set(),
};

// ==================== DATA LAYER ====================
async function loadData() {
  const [{ data: tx, error: e1 }, { data: produtos, error: e2 }] = await Promise.all([
    sb.from('transacoes').select('*').order('data', { ascending: false }),
    sb.from('produtos').select('*').order('created_at', { ascending: false }),
  ]);
  if (e1) console.error(e1);
  if (e2) console.error(e2);
  state.tx = (tx || []).map(mapTxFromDb);
  state.produtos = (produtos || []).map(mapProdutoFromDb);
  state.loading = false;
  render();
}

function mapTxFromDb(row) {
  return { id: row.id, tipo: row.tipo, valor: Number(row.valor), categoria: row.categoria, natureza: row.natureza, descricao: row.descricao, data: row.data };
}
function mapProdutoFromDb(row) {
  return { id: row.id, nome: row.nome, sku: row.sku, estoqueAtual: row.estoque_atual, estoqueMinimo: row.estoque_minimo, custoUnitario: Number(row.custo_unitario) };
}

async function addTx(tx) {
  const { error } = await sb.from('transacoes').insert({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data,
  });
  if (error) alert('Erro ao salvar: ' + error.message);
}
async function addTxBatch(rows) {
  const { error } = await sb.from('transacoes').insert(rows.map((tx) => ({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data,
  })));
  if (error) alert('Erro ao importar: ' + error.message);
}
async function removeTx(id) {
  const { error } = await sb.from('transacoes').delete().eq('id', id);
  if (error) alert('Erro ao remover: ' + error.message);
}
async function removeTxBatch(ids) {
  const { error } = await sb.from('transacoes').delete().in('id', ids);
  if (error) alert('Erro ao remover lançamentos: ' + error.message);
}
async function updateTx(id, tx) {
  const { error } = await sb.from('transacoes').update({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar: ' + error.message);
}

async function addProduto(p) {
  const { error } = await sb.from('produtos').insert({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario,
  });
  if (error) alert('Erro ao salvar produto: ' + error.message);
}
async function updateProdutoEstoque(id, novoEstoque) {
  const { error } = await sb.from('produtos').update({ estoque_atual: novoEstoque }).eq('id', id);
  if (error) alert('Erro ao atualizar estoque: ' + error.message);
}
async function removeProduto(id) {
  const { error } = await sb.from('produtos').delete().eq('id', id);
  if (error) alert('Erro ao remover produto: ' + error.message);
}
async function updateProduto(id, p) {
  const { error } = await sb.from('produtos').update({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar produto: ' + error.message);
}

function setupRealtime() {
  sb.channel('rj-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transacoes' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, loadData)
    .subscribe();
}

// ==================== COMPUTED ====================
function getComputed() {
  const saldoTotal = state.tx.reduce((acc, t) => acc + (t.tipo === 'entrada' ? t.valor : -t.valor), 0);
  const txMes = state.tx.filter((t) => monthKey(t.data) === state.selectedMonth);
  const entradasMes = txMes.filter((t) => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
  const saidasMes = txMes.filter((t) => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);
  const custoFixo = txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'fixo').reduce((a, t) => a + t.valor, 0);
  const custoVariavel = txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'variavel').reduce((a, t) => a + t.valor, 0);

  const produtosStatus = state.produtos.map((p) => {
    const precisaRepor = p.estoqueAtual <= p.estoqueMinimo;
    const qtdSugerida = Math.max(p.estoqueMinimo * 2 - p.estoqueAtual, p.estoqueMinimo || 1);
    const custoRepor = qtdSugerida * p.custoUnitario;
    let status = 'ok';
    if (p.estoqueAtual <= 0) status = 'critico';
    else if (precisaRepor) status = saldoTotal >= custoRepor ? 'pode-cortar' : 'aguarde';
    return { ...p, precisaRepor, qtdSugerida, custoRepor, status };
  });

  return { saldoTotal, txMes, entradasMes, saidasMes, custoFixo, custoVariavel, produtosStatus };
}

// ==================== RENDER ====================
function render() {
  const app = document.getElementById('app');
  if (state.loading) {
    app.innerHTML = `<div class="loading-wrap"><div class="spinner"></div></div>`;
    return;
  }
  const c = getComputed();
  const positivo = c.saldoTotal >= 0;

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="brand-row"><div class="brand-dot"></div><span class="brand-name">ROSA JULIETA</span></div>
        <div class="brand-sub"><span class="sync-dot"></span>Painel de Gestão</div>
      </div>
      <div class="saldo-box">
        <div class="saldo-label">Saldo disponível</div>
        <div class="saldo-value" style="color:${positivo ? 'var(--teal)' : 'var(--red)'}">${fmt(c.saldoTotal)}</div>
      </div>
    </div>
    <div class="tabs-wrap">
      ${tabBtn('dashboard', 'Dashboard', c.produtosStatus.filter(p => p.status !== 'ok').length)}
      ${tabBtn('financeiro', 'Financeiro')}
      ${tabBtn('estoque', 'Estoque')}
    </div>
    <div class="content" id="tabContent"></div>
  `;

  const contentEl = document.getElementById('tabContent');
  if (state.tab === 'dashboard') contentEl.innerHTML = renderDashboard(c);
  else if (state.tab === 'financeiro') contentEl.innerHTML = renderFinanceiro(c);
  else if (state.tab === 'estoque') contentEl.innerHTML = renderEstoque(c);

  attachHandlers(c);
}

function tabBtn(id, label, badge) {
  const active = state.tab === id ? 'active' : '';
  const badgeHtml = badge ? `<span class="tab-badge">${badge}</span>` : '';
  return `<button class="tab-btn ${active}" data-tab="${id}">${label}${badgeHtml}</button>`;
}

// ---- Financeiro ----
function categoriaOptionsHtml(selected) {
  return Object.entries(CATEGORIAS_SAIDA).map(([grupo, itens]) => `
    <optgroup label="${grupo}">
      ${itens.map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </optgroup>
  `).join('') + `<option value="Outro" ${selected === 'Outro' ? 'selected' : ''}>Outro</option>`;
}

function renderFinanceiro(c) {
  const tipo = window.__txFormTipo || 'saida';
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Financeiro</div><div class="section-subtitle">Lançamentos e importação de vendas</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="icon-btn-ghost" id="toggleSelect">${state.selectMode ? '✕ Cancelar' : '☑️ Selecionar'}</button>
        <button class="icon-btn-ghost" id="exportCsv">💾 Exportar</button>
        <button class="icon-btn-ghost" id="toggleUpload">📤 CSV</button>
        <button class="icon-btn" id="toggleTxForm">＋ Lançar</button>
      </div>
    </div>

    <input type="month" class="month-input" id="monthSelect" value="${state.selectedMonth}" />

    ${state.showUpload ? `
      <div class="form-card">
        <div class="form-hint">Suba o relatório de vendas exportado (CSV ou Excel) do Shopee, Mercado Livre, Amazon ou TikTok Shop. O sistema procura a coluna de valor automaticamente e lança como entrada.</div>
        <label class="file-label">📤 Escolher arquivo CSV ou Excel<input type="file" accept=".csv,.xlsx,.xls" id="csvInput" style="display:none" /></label>
      </div>
    ` : ''}

    ${state.showTxForm ? `
      <div class="form-card">
        <div class="form-row">
          <button class="toggle-btn ${tipo === 'entrada' ? 'active-teal' : ''}" data-tipo="entrada">Entrada</button>
          <button class="toggle-btn ${tipo === 'saida' ? 'active-pink' : ''}" data-tipo="saida">Saída</button>
        </div>
        <input type="text" id="txValor" placeholder="Valor (ex: 250,00)" />
        ${tipo === 'saida'
          ? `<select id="txCategoria"><option value="">Selecione a categoria</option>${categoriaOptionsHtml()}</select>`
          : `<input type="text" id="txCategoria" placeholder="Categoria (ex: Venda marketplace)" />`}
        <input type="text" id="txDescricao" placeholder="Descrição (opcional, ex: nome do funcionário)" />
        <input type="date" id="txData" value="${todayStr()}" />
        <button class="confirm-btn" id="salvarTx">Salvar lançamento</button>
      </div>
    ` : ''}

    ${state.selectMode ? `
      <div class="select-bar">
        <button class="icon-btn-ghost" id="selectAllTx">${c.txMes.length > 0 && c.txMes.every(t => state.selectedTxIds.has(t.id)) ? 'Desmarcar todos' : 'Selecionar todos'}</button>
        <button class="icon-btn" id="deleteSelectedTx" ${state.selectedTxIds.size === 0 ? 'disabled' : ''}>🗑 Excluir (${state.selectedTxIds.size})</button>
      </div>
    ` : ''}

    ${c.txMes.length === 0 ? `<div class="empty-state">Nenhum lançamento neste mês ainda.</div>` : `
      <div class="tx-list">
        ${c.txMes.map((t) => {
          if (state.editingTxId === t.id) {
            const editTipo = window.__editTxTipo || t.tipo;
            return `
              <div class="form-card">
                <div class="form-row">
                  <button class="toggle-btn ${editTipo === 'entrada' ? 'active-teal' : ''}" data-edit-tipo="entrada">Entrada</button>
                  <button class="toggle-btn ${editTipo === 'saida' ? 'active-pink' : ''}" data-edit-tipo="saida">Saída</button>
                </div>
                <input type="text" id="editTxValor-${t.id}" placeholder="Valor" value="${t.valor.toFixed(2).replace('.', ',')}" />
                ${editTipo === 'saida'
                  ? `<select id="editTxCategoria-${t.id}"><option value="">Selecione a categoria</option>${categoriaOptionsHtml(t.categoria)}</select>`
                  : `<input type="text" id="editTxCategoria-${t.id}" placeholder="Categoria" value="${esc(t.categoria)}" />`}
                <input type="text" id="editTxDescricao-${t.id}" placeholder="Descrição (opcional)" value="${esc(t.descricao || '')}" />
                <input type="date" id="editTxData-${t.id}" value="${t.data}" />
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-tx="${t.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-tx="${t.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          const checked = state.selectedTxIds.has(t.id);
          return `
          <div class="tx-row">
            ${state.selectMode ? `<input type="checkbox" class="tx-checkbox" data-select-tx="${t.id}" ${checked ? 'checked' : ''} />` : `<div class="tx-dot" style="background:${t.tipo === 'entrada' ? 'var(--teal)' : 'var(--pink)'}"></div>`}
            <div style="flex:1">
              <div class="tx-categoria">${esc(t.categoria)}</div>
              ${t.descricao ? `<div class="tx-desc">${esc(t.descricao)}</div>` : ''}
              <div class="tx-date">${t.data}</div>
            </div>
            <div class="tx-valor" style="color:${t.tipo === 'entrada' ? 'var(--teal)' : 'var(--pink)'}">${t.tipo === 'entrada' ? '+' : '-'}${fmt(t.valor)}</div>
            ${!state.selectMode ? `
              <button class="trash-btn" data-edit-tx="${t.id}">✏️</button>
              <button class="trash-btn" data-remove-tx="${t.id}">🗑</button>
            ` : ''}
          </div>
        `;
        }).join('')}
      </div>
    `}
  `;
}

// ---- Estoque ----
function renderEstoque(c) {
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Estoque</div><div class="section-subtitle">Cadastre seus SKUs pra ativar o semáforo de reposição</div></div>
      <button class="icon-btn" id="toggleProdutoForm">＋ Produto</button>
    </div>

    ${state.showProdutoForm ? `
      <div class="form-card">
        <input type="text" id="pNome" placeholder="Nome do produto" />
        <input type="text" id="pSku" placeholder="SKU (opcional)" />
        <div class="form-row">
          <input type="text" id="pEstoqueAtual" placeholder="Estoque atual" />
          <input type="text" id="pEstoqueMinimo" placeholder="Estoque mínimo" />
        </div>
        <input type="text" id="pCusto" placeholder="Custo de produção por unidade (ex: 18,50)" />
        <button class="confirm-btn" id="salvarProduto">Salvar produto</button>
      </div>
    ` : ''}

    ${c.produtosStatus.length === 0 ? `<div class="empty-state">Nenhum produto cadastrado ainda.</div>` : `
      <div class="produto-list">
        ${c.produtosStatus.map((p) => {
          const statusColor = { critico: 'var(--red)', aguarde: 'var(--amber)', 'pode-cortar': 'var(--teal)', ok: 'var(--border)' }[p.status];
          const entradaOpen = state.entradaOpenId === p.id;

          if (state.editingProdutoId === p.id) {
            return `
              <div class="form-card">
                <input type="text" id="editPNome-${p.id}" placeholder="Nome do produto" value="${esc(p.nome)}" />
                <input type="text" id="editPSku-${p.id}" placeholder="SKU (opcional)" value="${esc(p.sku || '')}" />
                <div class="form-row">
                  <input type="text" id="editPEstoqueAtual-${p.id}" placeholder="Estoque atual" value="${p.estoqueAtual}" />
                  <input type="text" id="editPEstoqueMinimo-${p.id}" placeholder="Estoque mínimo" value="${p.estoqueMinimo}" />
                </div>
                <input type="text" id="editPCusto-${p.id}" placeholder="Custo por unidade" value="${p.custoUnitario.toFixed(2).replace('.', ',')}" />
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-produto="${p.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-produto="${p.id}">Cancelar</button>
                </div>
              </div>
            `;
          }

          return `
            <div class="produto-card" style="border-color:${statusColor}55">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(p.nome)}</div>
                  ${p.sku ? `<div class="produto-sku">${esc(p.sku)}</div>` : ''}
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-edit-produto="${p.id}">✏️</button>
                  <button class="trash-btn" data-remove-produto="${p.id}">🗑</button>
                </div>
              </div>
              <div class="produto-stock-row">
                <button class="step-btn" data-step="-1" data-produto="${p.id}" data-atual="${p.estoqueAtual}">-</button>
                <div class="stock-value">${p.estoqueAtual} <span class="stock-unit">un</span></div>
                <button class="step-btn" data-step="1" data-produto="${p.id}" data-atual="${p.estoqueAtual}">+</button>
                <div class="produto-meta">mín. ${p.estoqueMinimo} · ${fmt(p.custoUnitario)}/un</div>
              </div>
              ${entradaOpen ? `
                <div class="entrada-box">
                  <div class="form-hint">Peças recebidas do corte/costura. O custo é lançado automaticamente como saída no financeiro.</div>
                  <div class="form-row">
                    <input type="text" id="entradaQtd-${p.id}" placeholder="Quantidade recebida" />
                    <input type="text" id="entradaCusto-${p.id}" placeholder="Custo total (padrão ${fmt(p.custoUnitario)}/un)" />
                  </div>
                  <div class="form-row">
                    <button class="confirm-btn" data-confirmar-entrada="${p.id}" data-custo-unit="${p.custoUnitario}">Confirmar entrada</button>
                    <button class="toggle-btn" data-cancelar-entrada="${p.id}">Cancelar</button>
                  </div>
                </div>
              ` : `<button class="entrada-btn" data-abrir-entrada="${p.id}">📦 Registrar entrada de mercadoria</button>`}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}
const SEMAFORO = {
  critico: { color: 'var(--red)', label: '🔴 Crítico — estoque zerado' },
  aguarde: { color: 'var(--amber)', label: '🟡 Aguarde — sem saldo pra repor' },
  'pode-cortar': { color: 'var(--teal)', label: '🟢 Pode cortar' },
};

function renderDashboard(c) {
  const custoTotal = c.custoFixo + c.custoVariavel || 1;
  const pctFixo = Math.round((c.custoFixo / custoTotal) * 100);
  const pctVariavel = 100 - pctFixo;
  const alertList = c.produtosStatus
    .filter((p) => p.status !== 'ok')
    .sort((a, b) => ({ critico: 0, aguarde: 1, 'pode-cortar': 2 }[a.status] - { critico: 0, aguarde: 1, 'pode-cortar': 2 }[b.status]));

  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.1)">📈</div>
        <div class="stat-label">Entradas do mês</div>
        <div class="stat-value">${fmt(c.entradasMes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,46,126,0.1)">📉</div>
        <div class="stat-label">Saídas do mês</div>
        <div class="stat-value">${fmt(c.saidasMes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:${c.saldoTotal >= 0 ? 'rgba(0,212,160,0.1)' : 'rgba(255,71,87,0.1)'}">💰</div>
        <div class="stat-label">Saldo total</div>
        <div class="stat-value">${fmt(c.saldoTotal)}</div>
      </div>
    </div>

    <div class="section-title-wrap">
      <div><div class="section-title">Custos fixos x variáveis</div><div class="section-subtitle">Baseado nos lançamentos deste mês</div></div>
    </div>
    ${c.custoFixo + c.custoVariavel === 0 ? `<div class="empty-state">Nenhuma saída lançada neste mês ainda.</div>` : `
      <div class="custo-box">
        <div class="custo-bar"><div class="custo-bar-fill" style="width:${pctFixo}%"></div></div>
        <div class="custo-legend">
          <div class="custo-legend-item"><span class="legend-dot" style="background:var(--pink)"></span>Fixos — ${fmt(c.custoFixo)} (${pctFixo}%)</div>
          <div class="custo-legend-item"><span class="legend-dot" style="background:var(--surface2);border:1px solid var(--border)"></span>Variáveis — ${fmt(c.custoVariavel)} (${pctVariavel}%)</div>
        </div>
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Semáforo de reposição</div><div class="section-subtitle">Cruza estoque baixo com saldo disponível</div></div>
    </div>
    ${alertList.length === 0 ? `<div class="empty-state">Nenhum alerta no momento. Cadastre produtos na aba Estoque pra ativar o semáforo.</div>` : `
      <div class="alert-list">
        ${alertList.map((p) => `
          <div class="alert-card" style="border-color:${SEMAFORO[p.status].color}55">
            <div class="alert-card-row">
              <div class="alert-dot" style="background:${SEMAFORO[p.status].color}"></div>
              <div style="flex:1">
                <div class="alert-name">${esc(p.nome)}</div>
                <div class="alert-status" style="color:${SEMAFORO[p.status].color}">${SEMAFORO[p.status].label}</div>
                <div class="alert-meta">Estoque: ${p.estoqueAtual} / mín. ${p.estoqueMinimo} · Repor ${p.qtdSugerida} un · custo ${fmt(p.custoRepor)}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

// ==================== EVENT HANDLERS ====================
function attachHandlers(c) {
  // tabs
  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      state.tab = el.dataset.tab;
      state.showTxForm = false;
      state.showUpload = false;
      state.showProdutoForm = false;
      state.entradaOpenId = null;
      state.editingTxId = null;
      state.editingProdutoId = null;
      state.selectMode = false;
      state.selectedTxIds = new Set();
      render();
    });
  });

  if (state.tab === 'financeiro') attachFinanceiroHandlers(c);
  if (state.tab === 'estoque') attachEstoqueHandlers(c);
}

function attachFinanceiroHandlers(c) {
  const monthSelect = document.getElementById('monthSelect');
  if (monthSelect) monthSelect.addEventListener('change', (e) => { state.selectedMonth = e.target.value; render(); });

  const exportBtn = document.getElementById('exportCsv');
  if (exportBtn) exportBtn.addEventListener('click', () => exportCSV(c.txMes, state.selectedMonth));

  const toggleSelect = document.getElementById('toggleSelect');
  if (toggleSelect) toggleSelect.addEventListener('click', () => {
    state.selectMode = !state.selectMode;
    state.selectedTxIds = new Set();
    render();
  });

  const selectAllBtn = document.getElementById('selectAllTx');
  if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
    const allSelected = c.txMes.length > 0 && c.txMes.every((t) => state.selectedTxIds.has(t.id));
    state.selectedTxIds = allSelected ? new Set() : new Set(c.txMes.map((t) => t.id));
    render();
  });

  document.querySelectorAll('[data-select-tx]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.selectTx;
      if (cb.checked) state.selectedTxIds.add(id);
      else state.selectedTxIds.delete(id);
      render();
    });
  });

  const deleteSelectedBtn = document.getElementById('deleteSelectedTx');
  if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', async () => {
    const ids = [...state.selectedTxIds];
    if (!ids.length) return;
    if (!confirm(`Excluir ${ids.length} lançamento(s) selecionado(s)? Essa ação não pode ser desfeita.`)) return;
    await removeTxBatch(ids);
    state.selectedTxIds = new Set();
    state.selectMode = false;
    render();
  });

  const toggleUpload = document.getElementById('toggleUpload');
  if (toggleUpload) toggleUpload.addEventListener('click', () => { state.showUpload = !state.showUpload; render(); });

  const toggleTxForm = document.getElementById('toggleTxForm');
  if (toggleTxForm) toggleTxForm.addEventListener('click', () => { state.showTxForm = !state.showTxForm; render(); });

  document.querySelectorAll('[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__txFormTipo = btn.dataset.tipo; render(); });
  });

  const csvInput = document.getElementById('csvInput');
  if (csvInput) csvInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    let rows;
    try {
      rows = isExcel ? await parseXLSX(file) : parseCSV(await file.text());
    } catch (err) {
      alert('Não consegui ler esse arquivo. Confira se é um export válido do marketplace.');
      return;
    }
    const novos = [];
    rows.forEach((row) => {
      const raw = guessValueField(row);
      if (!raw) return;
      const valor = parseBRNumber(String(raw));
      if (!valor) return;
      novos.push({
        tipo: 'entrada', valor, categoria: 'Venda marketplace',
        descricao: guessDescricaoField(row, file.name),
        data: todayStr(),
      });
    });
    if (novos.length) {
      await addTxBatch(novos);
    } else {
      alert('Não encontrei nenhuma coluna de valor reconhecível nesse arquivo. Me manda o nome das colunas que eu ajusto.');
    }
    state.showUpload = false;
    render();
  });

  const salvarTx = document.getElementById('salvarTx');
  if (salvarTx) salvarTx.addEventListener('click', async () => {
    const tipo = window.__txFormTipo || 'saida';
    const valor = parseBRNumber(document.getElementById('txValor').value);
    const categoria = document.getElementById('txCategoria').value;
    const descricao = document.getElementById('txDescricao').value;
    const data = document.getElementById('txData').value || todayStr();
    if (!valor || !categoria) { alert('Preencha valor e categoria.'); return; }
    const natureza = tipo === 'saida' ? (NATUREZA_POR_CATEGORIA[categoria] || 'variavel') : null;
    await addTx({ tipo, valor, categoria, natureza, descricao, data });
    state.showTxForm = false;
    window.__txFormTipo = 'saida';
    render();
  });

  document.querySelectorAll('[data-remove-tx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removeTx(btn.dataset.removeTx);
    });
  });

  document.querySelectorAll('[data-edit-tx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.editingTxId = btn.dataset.editTx;
      window.__editTxTipo = null;
      render();
    });
  });
  document.querySelectorAll('[data-cancelar-edit-tx]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingTxId = null; render(); });
  });
  document.querySelectorAll('[data-edit-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__editTxTipo = btn.dataset.editTipo; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-tx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditTx;
      const original = state.tx.find((t) => t.id === id);
      const tipo = window.__editTxTipo || original.tipo;
      const valor = parseBRNumber(document.getElementById(`editTxValor-${id}`).value);
      const categoria = document.getElementById(`editTxCategoria-${id}`).value;
      const descricao = document.getElementById(`editTxDescricao-${id}`).value;
      const data = document.getElementById(`editTxData-${id}`).value || todayStr();
      if (!valor || !categoria) { alert('Preencha valor e categoria.'); return; }
      const natureza = tipo === 'saida' ? (NATUREZA_POR_CATEGORIA[categoria] || 'variavel') : null;
      await updateTx(id, { tipo, valor, categoria, natureza, descricao, data });
      state.editingTxId = null;
      window.__editTxTipo = null;
      render();
    });
  });
}

function attachEstoqueHandlers(c) {
  const toggleForm = document.getElementById('toggleProdutoForm');
  if (toggleForm) toggleForm.addEventListener('click', () => { state.showProdutoForm = !state.showProdutoForm; render(); });

  const salvarProduto = document.getElementById('salvarProduto');
  if (salvarProduto) salvarProduto.addEventListener('click', async () => {
    const nome = document.getElementById('pNome').value.trim();
    const sku = document.getElementById('pSku').value.trim();
    const estoqueAtual = Number(document.getElementById('pEstoqueAtual').value) || 0;
    const estoqueMinimo = Number(document.getElementById('pEstoqueMinimo').value) || 0;
    const custoUnitario = parseBRNumber(document.getElementById('pCusto').value);
    if (!nome) { alert('Informe o nome do produto.'); return; }
    await addProduto({ nome, sku, estoqueAtual, estoqueMinimo, custoUnitario });
    state.showProdutoForm = false;
    render();
  });

  document.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const delta = Number(btn.dataset.step);
      const atual = Number(btn.dataset.atual);
      const novo = Math.max(0, atual + delta);
      await updateProdutoEstoque(btn.dataset.produto, novo);
    });
  });

  document.querySelectorAll('[data-remove-produto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover este produto?')) await removeProduto(btn.dataset.removeProduto);
    });
  });

  document.querySelectorAll('[data-edit-produto]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingProdutoId = btn.dataset.editProduto; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-produto]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingProdutoId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-produto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditProduto;
      const nome = document.getElementById(`editPNome-${id}`).value.trim();
      const sku = document.getElementById(`editPSku-${id}`).value.trim();
      const estoqueAtual = Number(document.getElementById(`editPEstoqueAtual-${id}`).value) || 0;
      const estoqueMinimo = Number(document.getElementById(`editPEstoqueMinimo-${id}`).value) || 0;
      const custoUnitario = parseBRNumber(document.getElementById(`editPCusto-${id}`).value);
      if (!nome) { alert('Informe o nome do produto.'); return; }
      await updateProduto(id, { nome, sku, estoqueAtual, estoqueMinimo, custoUnitario });
      state.editingProdutoId = null;
      render();
    });
  });

  document.querySelectorAll('[data-abrir-entrada]').forEach((btn) => {
    btn.addEventListener('click', () => { state.entradaOpenId = btn.dataset.abrirEntrada; render(); });
  });
  document.querySelectorAll('[data-cancelar-entrada]').forEach((btn) => {
    btn.addEventListener('click', () => { state.entradaOpenId = null; render(); });
  });
  document.querySelectorAll('[data-confirmar-entrada]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.confirmarEntrada;
      const custoUnit = Number(btn.dataset.custoUnit);
      const qtdInput = document.getElementById(`entradaQtd-${id}`);
      const custoInput = document.getElementById(`entradaCusto-${id}`);
      const qtd = Number(qtdInput.value);
      if (!qtd || qtd <= 0) { alert('Informe a quantidade recebida.'); return; }
      const custo = custoInput.value ? parseBRNumber(custoInput.value) : qtd * custoUnit;
      const produto = state.produtos.find((p) => p.id === id);
      await updateProdutoEstoque(id, produto.estoqueAtual + qtd);
      await addTx({
        tipo: 'saida', valor: custo, categoria: 'Reposição de estoque', natureza: 'variavel',
        descricao: `${produto.nome} — ${qtd} un recebidas`, data: todayStr(),
      });
      state.entradaOpenId = null;
      render();
    });
  });
}

// ==================== PWA INSTALL PROMPT ====================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  if (document.getElementById('installBanner') || localStorage.getItem('installDismissed')) return;
  const banner = document.createElement('div');
  banner.className = 'install-banner';
  banner.id = 'installBanner';
  banner.innerHTML = `<span>Instalar o app na tela inicial?</span>
    <div style="display:flex;gap:8px">
      <button class="dismiss" id="dismissInstall">Agora não</button>
      <button id="doInstall">Instalar</button>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById('doInstall').addEventListener('click', async () => {
    banner.remove();
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  });
  document.getElementById('dismissInstall').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('installDismissed', '1');
  });
}

// ==================== INIT ====================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.error));
}

loadData();
setupRealtime();
