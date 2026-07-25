// ==================== CONFIG ====================
// Substitua pela URL e chave do SEU projeto Supabase (Settings > API Keys)
const SUPABASE_URL = 'https://hiqsjbxxvirdxcegtkfl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JfxpEAafLngstJeouuaepA_RHqRUFOT';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Códigos de acesso simples — troque por códigos à sua escolha.
// Não é uma senha de segurança bancária, é só uma trava leve pra
// separar quem vê o app completo de quem só lança produção.
const CODIGO_DONO = 'ROSA2026';
const CODIGO_SUPERVISORA = 'EXPED2026';

const CATEGORIAS_SAIDA = {
  'Custos fixos': [
    'Aluguel', 'Funcionários — salário', 'Funcionários — encargos/benefícios',
    'Pró-labore', 'Água', 'Energia', 'Internet/Telefone', 'Contador',
    'Softwares/Assinaturas', 'Manutenção de máquinas',
  ],
  'Custos variáveis': [
    'Tecido', 'Aviamento', 'Corte e costura (terceirizado)', 'Embalagem',
    'Frete/Logística', 'Taxas de marketplace', 'Ads/Marketing',
    'Impostos sobre venda', 'Etiquetas/Tags', 'Reposição de estoque', 'Mão de obra — produção',
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
function addMonths(mKey, n) {
  const [y, m] = mKey.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function daysInMonth(mKey) {
  const [y, m] = mKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
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
  // detecta o delimitador UMA VEZ a partir do cabeçalho (evita confusão quando
  // os dados têm vírgula decimal, ex: "10,00", numa linha separada por ";")
  const delim = lines[0].includes(';') ? ';' : ',';
  const splitLine = (line) => {
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
  const candidates = ['subtotal do produto', 'valor total', 'pagamentos recebidos', 'valor de vendas válidas', 'valor total de vendas', 'valor da nota fiscal', 'valor', 'total', 'preço total', 'preco total', 'valor do produto', 'receita'];
  for (const c of candidates) if (row[c]) return row[c];
  return null;
}
function guessDataField(row) {
  const candidates = ['data', 'data de criação do pedido', 'data do pedido', 'date'];
  for (const c of candidates) {
    const v = row[c];
    if (v === undefined || v === '' || v === null) continue;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}
function guessDescricaoField(row, fallback) {
  const candidates = ['nome do produto', 'produtos', 'produto', 'título', 'titulo', 'descrição', 'descricao', 'destinatário', 'destinatario', 'cliente'];
  for (const c of candidates) if (row[c]) return String(row[c]);
  return fallback;
}
function guessSkuField(row) {
  const candidates = ['nº de referência do sku principal', 'sku principal', 'número de referência sku', 'sku', 'referência sku', 'referencia sku'];
  for (const c of candidates) if (row[c]) return String(row[c]).trim();
  return null;
}
function guessQuantidadeField(row) {
  const candidates = ['quantidade', 'unidades vendidas', 'qtd', 'quantity'];
  for (const c of candidates) if (row[c]) return Number(row[c]) || 1;
  return 1;
}
function guessDataFromFilename(fileName) {
  const m = fileName.match(/(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y1, mo1, d1, y2, mo2, d2] = m;
  // só usa se o relatório cobre um único dia (início = fim); em relatórios de
  // vários dias não dá pra saber em qual dia exato cada linha vendeu
  if (y1 === y2 && mo1 === mo2 && d1 === d2) return `${y1}-${mo1}-${d1}`;
  return null;
}
function guessPlataformaFromRow(row, plataformas) {
  const candidates = ['loja', 'plataforma', 'canal', 'marketplace'];
  let raw = null;
  for (const c of candidates) { if (row[c]) { raw = String(row[c]); break; } }
  if (!raw) return null;
  const rawLower = raw.toLowerCase();
  // compara só a primeira palavra do nome cadastrado (ex: "tiktok" de "TikTok Shop",
  // "mercado" de "Mercado Livre") — os relatórios costumam abreviar o nome da loja
  return plataformas.find((p) => rawLower.includes(p.nome.toLowerCase().split(' ')[0])) || null;
}
function guessTaxaRealField(row) {
  // tenta usar os valores REAIS de taxa que a própria plataforma calculou no relatório
  // (mais preciso que estimar por %, já que varia por cupom/ads/frete em cada pedido)
  const liquidaKeys = ['taxa de comissão líquida', 'taxa de serviço líquida'];
  const brutaKeys = ['taxa de comissão bruta', 'taxa de serviço bruta'];
  const extrasKeys = ['taxa de transação', 'taxa de envio reversa'];
  const temLiquida = liquidaKeys.some((k) => row[k] !== undefined && row[k] !== '');
  const principais = temLiquida ? liquidaKeys : brutaKeys;
  let total = 0; let achou = false;
  [...principais, ...extrasKeys].forEach((k) => {
    if (row[k] !== undefined && row[k] !== '') {
      total += parseBRNumber(String(row[k]));
      achou = true;
    }
  });
  return achou ? total : null;
}

async function parseXLSX(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
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
  plataformas: [],
  showTaxasForm: false,
  showNovaPlataforma: false,
  filtroTipo: 'todos',
  papel: localStorage.getItem('rj_papel') || null,
  costureiras: [],
  producoes: [],
  showCostureiraForm: false,
  showProducaoForm: false,
};

// ==================== DATA LAYER ====================
async function loadData() {
  const [{ data: tx, error: e1 }, { data: produtos, error: e2 }, { data: plataformas, error: e3 }, { data: costureiras, error: e4 }, { data: producoes, error: e5 }] = await Promise.all([
    sb.from('transacoes').select('*').order('data', { ascending: false }),
    sb.from('produtos').select('*').order('created_at', { ascending: false }),
    sb.from('plataformas').select('*').order('nome', { ascending: true }),
    sb.from('costureiras').select('*').order('nome', { ascending: true }),
    sb.from('producoes').select('*').order('data', { ascending: false }),
  ]);
  if (e1) console.error(e1);
  if (e2) console.error(e2);
  if (e3) console.error(e3);
  if (e4) console.error(e4);
  if (e5) console.error(e5);
  state.tx = (tx || []).map(mapTxFromDb);
  state.produtos = (produtos || []).map(mapProdutoFromDb);
  state.plataformas = (plataformas || []).map((p) => ({ id: p.id, nome: p.nome, taxaPercentual: Number(p.taxa_percentual), taxaFixa: Number(p.taxa_fixa || 0) }));
  state.costureiras = (costureiras || []).map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa }));
  state.producoes = (producoes || []).map((p) => ({ id: p.id, costureiraId: p.costureira_id, produtoId: p.produto_id, quantidade: p.quantidade, data: p.data, pago: p.pago }));
  state.loading = false;
  render();
}

function mapTxFromDb(row) {
  return { id: row.id, tipo: row.tipo, valor: Number(row.valor), categoria: row.categoria, natureza: row.natureza, descricao: row.descricao, data: row.data, recorrente: !!row.recorrente, recorrenteOrigemId: row.recorrente_origem_id || null };
}
function mapProdutoFromDb(row) {
  return { id: row.id, nome: row.nome, sku: row.sku, estoqueAtual: row.estoque_atual, estoqueMinimo: row.estoque_minimo, custoUnitario: Number(row.custo_unitario), totalVendido: row.total_vendido || 0, ultimaVenda: row.ultima_venda || null, valorMaoObra: Number(row.valor_mao_obra || 0) };
}

async function addTx(tx) {
  const { error } = await sb.from('transacoes').insert({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, recorrente: !!tx.recorrente,
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
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, recorrente: !!tx.recorrente,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar: ' + error.message);
}

async function addProduto(p) {
  const { error } = await sb.from('produtos').insert({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, valor_mao_obra: p.valorMaoObra || 0,
  });
  if (error) alert('Erro ao salvar produto: ' + error.message);
}
async function updateProdutoEstoque(id, novoEstoque) {
  const { error } = await sb.from('produtos').update({ estoque_atual: novoEstoque }).eq('id', id);
  if (error) alert('Erro ao atualizar estoque: ' + error.message);
}
async function registrarVendaProduto(id, novoEstoque, novoTotalVendido, dataVenda) {
  const { error } = await sb.from('produtos').update({ estoque_atual: novoEstoque, total_vendido: novoTotalVendido, ultima_venda: dataVenda }).eq('id', id);
  if (error) alert('Erro ao registrar venda: ' + error.message);
}
async function removeProduto(id) {
  const { error } = await sb.from('produtos').delete().eq('id', id);
  if (error) alert('Erro ao remover produto: ' + error.message);
}
async function updateProduto(id, p) {
  const { error } = await sb.from('produtos').update({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, valor_mao_obra: p.valorMaoObra || 0,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar produto: ' + error.message);
}

async function updatePlataformaTaxa(id, taxaPercentual, taxaFixa) {
  const { error } = await sb.from('plataformas').update({ taxa_percentual: taxaPercentual, taxa_fixa: taxaFixa }).eq('id', id);
  if (error) alert('Erro ao salvar taxa: ' + error.message);
}
async function addPlataforma(nome, taxaPercentual, taxaFixa) {
  const { error } = await sb.from('plataformas').insert({ nome, taxa_percentual: taxaPercentual, taxa_fixa: taxaFixa });
  if (error) alert('Erro ao adicionar plataforma: ' + error.message);
}
async function removePlataforma(id) {
  const { error } = await sb.from('plataformas').delete().eq('id', id);
  if (error) alert('Erro ao remover plataforma: ' + error.message);
}

// ---- Costureiras & Produção ----
async function addCostureira(nome) {
  const { error } = await sb.from('costureiras').insert({ nome, ativa: true });
  if (error) alert('Erro ao adicionar costureira: ' + error.message);
}
async function removeCostureira(id) {
  const { error } = await sb.from('costureiras').delete().eq('id', id);
  if (error) alert('Erro ao remover costureira: ' + error.message);
}
async function registrarProducao(costureiraId, produtoId, quantidade, data) {
  const { error } = await sb.from('producoes').insert({ costureira_id: costureiraId, produto_id: produtoId, quantidade, data, pago: false });
  if (error) { alert('Erro ao registrar produção: ' + error.message); return; }
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (produto) await updateProdutoEstoque(produtoId, produto.estoqueAtual + quantidade);
}
async function marcarProducaoPaga(ids) {
  const { error } = await sb.from('producoes').update({ pago: true }).in('id', ids);
  if (error) alert('Erro ao marcar produção como paga: ' + error.message);
}

async function garantirRecorrentes() {
  const hojeMonth = todayStr().slice(0, 7);
  const templates = state.tx.filter((t) => t.recorrente);
  for (const t of templates) {
    const dia = Number(t.data.slice(8, 10));
    let cursor = addMonths(monthKey(t.data), 1);
    let iter = 0;
    while (cursor <= hojeMonth && iter < 36) {
      const jaExiste = state.tx.some((x) => x.recorrenteOrigemId === t.id && monthKey(x.data) === cursor);
      if (!jaExiste) {
        const diaFinal = Math.min(dia, daysInMonth(cursor));
        const novaData = `${cursor}-${String(diaFinal).padStart(2, '0')}`;
        await sb.from('transacoes').insert({
          tipo: t.tipo, valor: t.valor, categoria: t.categoria, natureza: t.natureza || null, descricao: t.descricao || null,
          data: novaData, recorrente: false, recorrente_origem_id: t.id,
        });
      }
      cursor = addMonths(cursor, 1);
      iter++;
    }
  }
}

function setupRealtime() {
  sb.channel('rj-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transacoes' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plataformas' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'costureiras' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'producoes' }, loadData)
    .subscribe();
}

// ==================== COMPUTED ====================
function getComputed() {
  // saldo real de caixa: só conta o que já aconteceu até hoje, não despesas/receitas
  // futuras já cadastradas adiantado (ex: aluguel do mês que vem lançado hoje)
  const saldoTotal = state.tx.filter((t) => t.data <= todayStr()).reduce((acc, t) => acc + (t.tipo === 'entrada' ? t.valor : -t.valor), 0);
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
    const diasSemVender = p.ultimaVenda ? Math.floor((Date.now() - new Date(p.ultimaVenda + 'T00:00:00').getTime()) / 86400000) : null;
    return { ...p, precisaRepor, qtdSugerida, custoRepor, status, diasSemVender };
  });

  const PARADO_DIAS = 30;
  const produtosParados = produtosStatus
    .filter((p) => p.estoqueAtual > 0 && (p.diasSemVender === null || p.diasSemVender >= PARADO_DIAS))
    .sort((a, b) => (b.diasSemVender ?? 99999) - (a.diasSemVender ?? 99999));

  // contas a vencer: saídas com data futura (ainda não contam no saldo atual),
  // dentro dos próximos 7 dias, pra você se antecipar
  const hoje = todayStr();
  const JANELA_VENCIMENTO = 7;
  const contasAVencer = state.tx
    .filter((t) => t.tipo === 'saida' && t.data > hoje)
    .map((t) => ({ ...t, diasParaVencer: Math.round((new Date(t.data + 'T00:00:00') - new Date(hoje + 'T00:00:00')) / 86400000) }))
    .filter((t) => t.diasParaVencer <= JANELA_VENCIMENTO)
    .sort((a, b) => a.diasParaVencer - b.diasParaVencer);

  return { saldoTotal, txMes, entradasMes, saidasMes, custoFixo, custoVariavel, produtosStatus, produtosParados, contasAVencer };
}

// ==================== RENDER ====================
// ---- Produção (visão do dono) ----
function renderProducaoDono(c) {
  const naoPagas = state.producoes.filter((p) => !p.pago);
  const porCostureira = {};
  naoPagas.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const valorUnit = produto ? produto.valorMaoObra : 0;
    if (!porCostureira[p.costureiraId]) porCostureira[p.costureiraId] = { qtd: 0, valor: 0, ids: [] };
    porCostureira[p.costureiraId].qtd += p.quantidade;
    porCostureira[p.costureiraId].valor += p.quantidade * valorUnit;
    porCostureira[p.costureiraId].ids.push(p.id);
  });

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Costureiras</div><div class="section-subtitle">Cadastre quem produz pra você</div></div>
      <button class="icon-btn" id="toggleCostureiraForm">＋ Costureira</button>
    </div>

    ${state.showCostureiraForm ? `
      <div class="form-card">
        <input type="text" id="novaCostureiraNome" placeholder="Nome da costureira" />
        <button class="confirm-btn" id="salvarCostureira">Adicionar</button>
      </div>
    ` : ''}

    ${state.costureiras.length === 0 ? `<div class="empty-state">Nenhuma costureira cadastrada ainda.</div>` : `
      <div class="tx-list" style="margin-bottom:28px">
        ${state.costureiras.map((cost) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:${cost.ativa ? 'var(--teal)' : 'var(--text-muted)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(cost.nome)}</div></div>
            <button class="trash-btn" data-remover-costureira="${cost.id}">🗑</button>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Pagamento pendente</div><div class="section-subtitle">Produção ainda não paga, por costureira</div></div>
    </div>

    ${Object.keys(porCostureira).length === 0 ? `<div class="empty-state">Nenhuma produção pendente de pagamento 🎉</div>` : `
      <div class="produto-list">
        ${Object.entries(porCostureira).map(([costureiraId, info]) => {
          const costureira = state.costureiras.find((c) => c.id === costureiraId);
          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(costureira?.nome || 'Costureira removida')}</div>
                  <div class="produto-sku">${info.qtd} peças produzidas</div>
                </div>
                <div class="dre-td-num dre-positivo" style="font-size:16px">${fmt(info.valor)}</div>
              </div>
              <button class="confirm-btn" style="margin-top:10px" data-pagar-costureira="${costureiraId}" data-ids="${info.ids.join(',')}" data-valor="${info.valor}" data-nome="${esc(costureira?.nome || '')}">✅ Pagar ${fmt(info.valor)}</button>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

// ---- Modo Supervisora (lançamento de produção) ----
function renderModoSupervisora(app) {
  const costureirasAtivas = state.costureiras.filter((c) => c.ativa);
  const hoje = todayStr();
  const producoesRecentes = [...state.producoes]
    .sort((a, b) => (b.data + b.id).localeCompare(a.data + a.id))
    .slice(0, 15);

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="brand-row"><div class="brand-dot"></div><span class="brand-name">ROSA JULIETA</span></div>
        <div class="brand-sub">Lançar produção</div>
      </div>
      <button class="icon-btn-ghost" id="sairModo">Sair</button>
    </div>
    <div class="content">
      ${costureirasAtivas.length === 0 ? `
        <div class="empty-state">Nenhuma costureira cadastrada ainda. Peça pro administrador cadastrar em "Produção".</div>
      ` : state.produtos.length === 0 ? `
        <div class="empty-state">Nenhum produto cadastrado ainda no Estoque.</div>
      ` : `
        <div class="form-card">
          <select id="prodCostureira">
            <option value="">Selecione a costureira</option>
            ${costureirasAtivas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}
          </select>
          <select id="prodProduto">
            <option value="">Selecione o produto</option>
            ${state.produtos.map((p) => `<option value="${p.id}">${esc(p.nome)}${p.sku ? ' — ' + esc(p.sku) : ''}</option>`).join('')}
          </select>
          <input type="text" id="prodQuantidade" placeholder="Quantidade de peças" inputmode="numeric" />
          <input type="date" id="prodData" value="${hoje}" />
          <button class="confirm-btn" id="salvarProducao">Registrar produção</button>
        </div>
      `}

      <div class="section-title-wrap"><div><div class="section-title">Lançamentos recentes</div></div></div>
      ${producoesRecentes.length === 0 ? `<div class="empty-state">Nenhum lançamento ainda.</div>` : `
        <div class="tx-list">
          ${producoesRecentes.map((p) => {
            const costureira = state.costureiras.find((c) => c.id === p.costureiraId);
            const produto = state.produtos.find((x) => x.id === p.produtoId);
            return `
              <div class="tx-row">
                <div class="tx-dot" style="background:${p.pago ? 'var(--teal)' : 'var(--amber)'}"></div>
                <div style="flex:1">
                  <div class="tx-categoria">${esc(costureira?.nome || '—')}</div>
                  <div class="tx-desc">${esc(produto?.nome || '—')} · ${p.quantidade} peças</div>
                  <div class="tx-date">${p.data}${p.pago ? ' · pago' : ''}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('sairModo').addEventListener('click', () => {
    localStorage.removeItem('rj_papel');
    state.papel = null;
    render();
  });

  const salvarBtn = document.getElementById('salvarProducao');
  if (salvarBtn) salvarBtn.addEventListener('click', async () => {
    const costureiraId = document.getElementById('prodCostureira').value;
    const produtoId = document.getElementById('prodProduto').value;
    const quantidade = Number(document.getElementById('prodQuantidade').value);
    const data = document.getElementById('prodData').value || hoje;
    if (!costureiraId || !produtoId || !quantidade || quantidade <= 0) {
      alert('Selecione a costureira, o produto e informe a quantidade.');
      return;
    }
    await registrarProducao(costureiraId, produtoId, quantidade, data);
    render();
  });
}

// ---- Gate de acesso ----
function renderGate(app) {
  app.innerHTML = `
    <div class="gate-wrap">
      <div class="brand-row" style="justify-content:center;margin-bottom:24px">
        <div class="brand-dot"></div><span class="brand-name">ROSA JULIETA</span>
      </div>
      <div class="gate-card">
        <div class="section-title" style="margin-bottom:4px">Código de acesso</div>
        <div class="section-subtitle" style="margin-bottom:16px">Digite o código que você recebeu</div>
        <input type="password" id="gateCodigo" placeholder="Código" />
        <button class="confirm-btn" id="gateEntrar" style="margin-top:10px">Entrar</button>
        <div id="gateErro" style="color:var(--red);font-size:12px;margin-top:8px;display:none">Código inválido, tente de novo.</div>
      </div>
    </div>
  `;
  const tentar = () => {
    const valor = document.getElementById('gateCodigo').value.trim();
    let papel = null;
    if (valor === CODIGO_DONO) papel = 'dono';
    else if (valor === CODIGO_SUPERVISORA) papel = 'supervisora';
    if (papel) {
      localStorage.setItem('rj_papel', papel);
      state.papel = papel;
      render();
    } else {
      document.getElementById('gateErro').style.display = 'block';
    }
  };
  document.getElementById('gateEntrar').addEventListener('click', tentar);
  document.getElementById('gateCodigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') tentar(); });
}

function render() {
  const app = document.getElementById('app');
  if (state.loading) {
    app.innerHTML = `<div class="loading-wrap"><div class="spinner"></div></div>`;
    return;
  }
  if (!state.papel) {
    renderGate(app);
    return;
  }
  if (state.papel === 'supervisora') {
    renderModoSupervisora(app);
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
        <button class="sair-link" id="sairApp">Trocar código</button>
      </div>
    </div>
    <div class="tabs-wrap">
      ${tabBtn('dashboard', 'Dashboard', c.produtosStatus.filter(p => p.status !== 'ok').length)}
      ${tabBtn('financeiro', 'Financeiro')}
      ${tabBtn('estoque', 'Estoque')}
      ${tabBtn('producao', 'Produção')}
      ${tabBtn('dre', 'DRE')}
    </div>
    <div class="content" id="tabContent"></div>
  `;

  const contentEl = document.getElementById('tabContent');
  if (state.tab === 'dashboard') contentEl.innerHTML = renderDashboard(c);
  else if (state.tab === 'financeiro') contentEl.innerHTML = renderFinanceiro(c);
  else if (state.tab === 'estoque') contentEl.innerHTML = renderEstoque(c);
  else if (state.tab === 'producao') contentEl.innerHTML = renderProducaoDono(c);
  else if (state.tab === 'dre') contentEl.innerHTML = renderDRE(c);

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
  const txFiltrado = state.filtroTipo === 'todos' ? c.txMes : c.txMes.filter((t) => t.tipo === state.filtroTipo);
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Financeiro</div><div class="section-subtitle">Lançamentos e importação de vendas</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="icon-btn-ghost" id="toggleTaxas">⚙️ Taxas</button>
        <button class="icon-btn-ghost" id="toggleSelect">${state.selectMode ? '✕ Cancelar' : '☑️ Selecionar'}</button>
        <button class="icon-btn-ghost" id="exportCsv">💾 Exportar</button>
        <button class="icon-btn-ghost" id="toggleUpload">📤 CSV</button>
        <button class="icon-btn" id="toggleTxForm">＋ Lançar</button>
      </div>
    </div>

    <input type="month" class="month-input" id="monthSelect" value="${state.selectedMonth}" />

    <div class="filtro-tipo-bar">
      <button class="filtro-tipo-btn ${state.filtroTipo === 'todos' ? 'active' : ''}" data-filtro="todos">Tudo</button>
      <button class="filtro-tipo-btn ${state.filtroTipo === 'entrada' ? 'active-teal' : ''}" data-filtro="entrada">Entradas</button>
      <button class="filtro-tipo-btn ${state.filtroTipo === 'saida' ? 'active-pink' : ''}" data-filtro="saida">Saídas</button>
    </div>

    ${state.showTaxasForm ? `
      <div class="form-card">
        <div class="form-hint">Defina a taxa de cada plataforma: % sobre o valor da venda e/ou um valor fixo em R$ por transação (ex: Shopee costuma cobrar um fixo além da %). Usadas só como estimativa quando o relatório importado não trouxer o valor real da taxa.</div>
        ${state.plataformas.map((p) => `
          <div class="taxa-row">
            <div class="taxa-row-nome">${esc(p.nome)}</div>
            <div class="taxa-row-inputs">
              <div class="taxa-input-group">
                <input type="text" id="taxaPctInput-${p.id}" value="${p.taxaPercentual}" placeholder="0" />
                <span>%</span>
              </div>
              <div class="taxa-input-group">
                <span>R$</span>
                <input type="text" id="taxaFixaInput-${p.id}" value="${p.taxaFixa}" placeholder="0" />
              </div>
              <button class="trash-btn" data-remover-plataforma="${p.id}">🗑</button>
            </div>
          </div>
        `).join('')}
        <button class="confirm-btn" id="salvarTaxas">Salvar taxas</button>

        <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
          ${state.showNovaPlataforma ? `
            <input type="text" id="novaPlataformaNome" placeholder="Nome da plataforma (ex: Amazon)" style="margin-bottom:6px" />
            <div class="form-row">
              <input type="text" id="novaPlataformaPct" placeholder="% " />
              <input type="text" id="novaPlataformaFixa" placeholder="R$ fixo" />
            </div>
            <div class="form-row" style="margin-top:6px">
              <button class="confirm-btn" id="confirmarNovaPlataforma">Adicionar</button>
              <button class="toggle-btn" id="cancelarNovaPlataforma">Cancelar</button>
            </div>
          ` : `<button class="entrada-btn" id="abrirNovaPlataforma">＋ Nova plataforma</button>`}
        </div>
      </div>
    ` : ''}

    ${state.showUpload ? `
      <div class="form-card">
        <div class="form-hint">Suba o relatório de vendas exportado (CSV ou Excel) do Shopee, Mercado Livre, Amazon ou TikTok Shop. Se o arquivo já identificar a plataforma por linha (ex: relatórios do Upseller), o sistema detecta sozinho. Senão, usa a opção selecionada abaixo pra tudo.</div>
        <select id="uploadPlataforma">
          <option value="">Nenhuma taxa (importar valor bruto)</option>
          ${state.plataformas.map((p) => `<option value="${p.id}">${esc(p.nome)}${p.taxaPercentual > 0 || p.taxaFixa > 0 ? ` (${p.taxaPercentual}% + ${fmt(p.taxaFixa)})` : ''}</option>`).join('')}
        </select>
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
        <label class="checkbox-label"><input type="checkbox" id="txRecorrente" /> 🔁 Repetir todos os meses</label>
        <button class="confirm-btn" id="salvarTx">Salvar lançamento</button>
      </div>
    ` : ''}

    ${state.selectMode ? `
      <div class="select-bar">
        <button class="icon-btn-ghost" id="selectAllTx">${txFiltrado.length > 0 && txFiltrado.every(t => state.selectedTxIds.has(t.id)) ? 'Desmarcar todos' : 'Selecionar todos'}</button>
        <button class="icon-btn" id="deleteSelectedTx" ${state.selectedTxIds.size === 0 ? 'disabled' : ''}>🗑 Excluir (${state.selectedTxIds.size})</button>
      </div>
    ` : ''}

    ${txFiltrado.length === 0 ? `<div class="empty-state">Nenhum lançamento ${state.filtroTipo === 'entrada' ? 'de entrada' : state.filtroTipo === 'saida' ? 'de saída' : ''} neste mês ainda.</div>` : `
      <div class="tx-list">
        ${txFiltrado.map((t) => {
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
                <label class="checkbox-label"><input type="checkbox" id="editTxRecorrente-${t.id}" ${t.recorrente ? 'checked' : ''} /> 🔁 Repetir todos os meses</label>
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
              <div class="tx-categoria">${esc(t.categoria)}${(t.recorrente || t.recorrenteOrigemId) ? ' 🔁' : ''}</div>
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

// ---- DRE ----
function renderDRE(c) {
  const txMes = c.txMes;
  const receitaBruta = txMes.filter((t) => t.tipo === 'entrada').reduce((a, t) => a + t.valor, 0);
  const taxasMkt = txMes.filter((t) => t.tipo === 'saida' && t.categoria === 'Taxas de marketplace').reduce((a, t) => a + t.valor, 0);
  const receitaLiquida = receitaBruta - taxasMkt;
  const custosVariaveis = txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'variavel' && t.categoria !== 'Taxas de marketplace').reduce((a, t) => a + t.valor, 0);
  const margemContribuicao = receitaLiquida - custosVariaveis;
  const custosFixos = txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'fixo').reduce((a, t) => a + t.valor, 0);
  const resultado = margemContribuicao - custosFixos;
  const pctMC = receitaBruta > 0 ? (margemContribuicao / receitaBruta) * 100 : 0;
  const pctResultado = receitaBruta > 0 ? (resultado / receitaBruta) * 100 : 0;

  const porCategoria = (filterFn) => {
    const map = {};
    txMes.filter(filterFn).forEach((t) => { map[t.categoria] = (map[t.categoria] || 0) + t.valor; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };
  const receitaPorCategoria = porCategoria((t) => t.tipo === 'entrada');
  const variavelPorCategoria = porCategoria((t) => t.tipo === 'saida' && t.natureza === 'variavel' && t.categoria !== 'Taxas de marketplace');
  const fixoPorCategoria = porCategoria((t) => t.tipo === 'saida' && t.natureza === 'fixo');

  const linhaSub = (nome, val) => `<tr class="dre-tr-sub"><td>${esc(nome)}</td><td class="dre-td-num">${fmt(val)}</td></tr>`;
  const subLinhas = (itens) => itens.map(([nome, val]) => linhaSub(nome, val)).join('');

  const vazio = receitaBruta === 0 && custosFixos === 0 && custosVariaveis === 0;

  return `
    <input type="month" class="month-input" id="dreMonthSelect" value="${state.selectedMonth}" />

    ${vazio ? `<div class="empty-state">Sem lançamentos neste mês ainda pra montar o DRE.</div>` : `
    <table class="dre-table">
      <tr class="dre-tr-item">
        <td>Receita Bruta de Vendas</td>
        <td class="dre-td-num dre-positivo">${fmt(receitaBruta)}</td>
      </tr>
      ${subLinhas(receitaPorCategoria)}

      <tr class="dre-tr-item">
        <td>(–) Taxas de Marketplace</td>
        <td class="dre-td-num dre-negativo">${fmt(taxasMkt)}</td>
      </tr>

      <tr class="dre-tr-subtotal">
        <td>= Receita Líquida</td>
        <td class="dre-td-num">${fmt(receitaLiquida)}</td>
      </tr>

      <tr class="dre-tr-item">
        <td>(–) Custos Variáveis</td>
        <td class="dre-td-num dre-negativo">${fmt(custosVariaveis)}</td>
      </tr>
      ${subLinhas(variavelPorCategoria)}

      <tr class="dre-tr-subtotal">
        <td>= Margem de Contribuição <span class="dre-pct">(${pctMC.toFixed(1)}%)</span></td>
        <td class="dre-td-num ${margemContribuicao >= 0 ? 'dre-positivo' : 'dre-negativo'}">${fmt(margemContribuicao)}</td>
      </tr>

      <tr class="dre-tr-item">
        <td>(–) Custos Fixos</td>
        <td class="dre-td-num dre-negativo">${fmt(custosFixos)}</td>
      </tr>
      ${subLinhas(fixoPorCategoria)}

      <tr class="dre-tr-final">
        <td>= Resultado do Período <span class="dre-pct">(${pctResultado.toFixed(1)}%)</span></td>
        <td class="dre-td-num ${resultado >= 0 ? 'dre-positivo' : 'dre-negativo'}">${fmt(resultado)}</td>
      </tr>
    </table>
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
        <input type="text" id="pSku" placeholder="SKU (opcional) — vários separados por vírgula" />
        <div class="form-row">
          <input type="text" id="pEstoqueAtual" placeholder="Estoque atual" />
          <input type="text" id="pEstoqueMinimo" placeholder="Estoque mínimo" />
        </div>
        <input type="text" id="pCusto" placeholder="Custo de produção por unidade (ex: 18,50)" />
        <input type="text" id="pMaoObra" placeholder="Valor de mão de obra por peça (ex: 5,00)" />
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
                <input type="text" id="editPSku-${p.id}" placeholder="SKU (opcional) — vários separados por vírgula" value="${esc(p.sku || '')}" />
                <div class="form-row">
                  <input type="text" id="editPEstoqueAtual-${p.id}" placeholder="Estoque atual" value="${p.estoqueAtual}" />
                  <input type="text" id="editPEstoqueMinimo-${p.id}" placeholder="Estoque mínimo" value="${p.estoqueMinimo}" />
                </div>
                <input type="text" id="editPCusto-${p.id}" placeholder="Custo por unidade" value="${p.custoUnitario.toFixed(2).replace('.', ',')}" />
                <input type="text" id="editPMaoObra-${p.id}" placeholder="Valor de mão de obra por peça" value="${(p.valorMaoObra || 0).toFixed(2).replace('.', ',')}" />
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
              ${p.totalVendido > 0 ? `<div class="produto-vendido">🏷️ ${p.totalVendido} un vendidas no total</div>` : ''}
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
    <input type="month" class="month-input" id="dashboardMonthSelect" value="${state.selectedMonth}" />

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
      <div><div class="section-title">Contas a vencer</div><div class="section-subtitle">Próximos 7 dias — ainda não descontadas do saldo</div></div>
    </div>
    ${c.contasAVencer.length === 0 ? `<div class="empty-state">Nenhuma conta vencendo nos próximos 7 dias.</div>` : `
      <div class="alert-list">
        ${c.contasAVencer.map((t) => `
          <div class="alert-card" style="border-color:var(--pink)55">
            <div class="alert-card-row">
              <div class="alert-dot" style="background:var(--pink)"></div>
              <div style="flex:1">
                <div class="alert-name">${esc(t.categoria)}</div>
                ${t.descricao ? `<div class="alert-meta" style="margin-top:0">${esc(t.descricao)}</div>` : ''}
                <div class="alert-status" style="color:var(--pink)">${t.diasParaVencer === 0 ? '📅 Vence hoje' : t.diasParaVencer === 1 ? '📅 Vence amanhã' : `📅 Vence em ${t.diasParaVencer} dias`} — ${fmt(t.valor)}</div>
              </div>
            </div>
            <button class="confirm-btn" style="background:var(--teal);margin-top:8px" data-marcar-pago="${t.id}">✅ Marcar como pago</button>
          </div>
        `).join('')}
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

    <div class="section-title-wrap">
      <div><div class="section-title">Produtos parados</div><div class="section-subtitle">Sem vender há 30 dias ou mais</div></div>
    </div>
    ${c.produtosParados.length === 0 ? `<div class="empty-state">Nenhum produto parado no momento 🎉</div>` : `
      <div class="alert-list">
        ${c.produtosParados.map((p) => `
          <div class="alert-card" style="border-color:var(--amber)55">
            <div class="alert-card-row">
              <div class="alert-dot" style="background:var(--amber)"></div>
              <div style="flex:1">
                <div class="alert-name">${esc(p.nome)}</div>
                <div class="alert-status" style="color:var(--amber)">${p.diasSemVender === null ? '⏸️ Nunca vendeu' : `⏸️ ${p.diasSemVender} dias sem vender`}</div>
                <div class="alert-meta">Estoque: ${p.estoqueAtual} un · ${fmt(p.custoUnitario)}/un parado</div>
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
  const sairBtn = document.getElementById('sairApp');
  if (sairBtn) sairBtn.addEventListener('click', () => {
    if (confirm('Sair e pedir o código de acesso de novo?')) {
      localStorage.removeItem('rj_papel');
      state.papel = null;
      render();
    }
  });

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
      state.showTaxasForm = false;
      state.showNovaPlataforma = false;
      state.showCostureiraForm = false;
      render();
    });
  });

  if (state.tab === 'dashboard') {
    const dashboardMonthSelect = document.getElementById('dashboardMonthSelect');
    if (dashboardMonthSelect) dashboardMonthSelect.addEventListener('change', (e) => { state.selectedMonth = e.target.value; render(); });

    document.querySelectorAll('[data-marcar-pago]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.marcarPago;
        const t = state.tx.find((x) => x.id === id);
        if (!t) return;
        await updateTx(id, { tipo: t.tipo, valor: t.valor, categoria: t.categoria, natureza: t.natureza, descricao: t.descricao, data: todayStr(), recorrente: t.recorrente });
        await loadData();
      });
    });
  }
  if (state.tab === 'financeiro') attachFinanceiroHandlers(c);
  if (state.tab === 'estoque') attachEstoqueHandlers(c);
  if (state.tab === 'producao') attachProducaoHandlers(c);
  if (state.tab === 'dre') {
    const dreMonthSelect = document.getElementById('dreMonthSelect');
    if (dreMonthSelect) dreMonthSelect.addEventListener('change', (e) => { state.selectedMonth = e.target.value; render(); });
  }
}

function attachFinanceiroHandlers(c) {
  const monthSelect = document.getElementById('monthSelect');
  if (monthSelect) monthSelect.addEventListener('change', (e) => { state.selectedMonth = e.target.value; render(); });

  document.querySelectorAll('[data-filtro]').forEach((btn) => {
    btn.addEventListener('click', () => { state.filtroTipo = btn.dataset.filtro; render(); });
  });

  const exportBtn = document.getElementById('exportCsv');
  if (exportBtn) exportBtn.addEventListener('click', () => exportCSV(c.txMes, state.selectedMonth));

  const toggleSelect = document.getElementById('toggleSelect');
  if (toggleSelect) toggleSelect.addEventListener('click', () => {
    state.selectMode = !state.selectMode;
    state.selectedTxIds = new Set();
    render();
  });

  const toggleTaxas = document.getElementById('toggleTaxas');
  if (toggleTaxas) toggleTaxas.addEventListener('click', () => { state.showTaxasForm = !state.showTaxasForm; state.showNovaPlataforma = false; render(); });

  const salvarTaxas = document.getElementById('salvarTaxas');
  if (salvarTaxas) salvarTaxas.addEventListener('click', async () => {
    for (const p of state.plataformas) {
      const pctInput = document.getElementById(`taxaPctInput-${p.id}`);
      const fixaInput = document.getElementById(`taxaFixaInput-${p.id}`);
      const novaPct = parseBRNumber(pctInput.value);
      const novaFixa = parseBRNumber(fixaInput.value);
      if (novaPct !== p.taxaPercentual || novaFixa !== p.taxaFixa) await updatePlataformaTaxa(p.id, novaPct, novaFixa);
    }
    state.showTaxasForm = false;
    render();
  });

  const abrirNovaPlataforma = document.getElementById('abrirNovaPlataforma');
  if (abrirNovaPlataforma) abrirNovaPlataforma.addEventListener('click', () => { state.showNovaPlataforma = true; render(); });

  const cancelarNovaPlataforma = document.getElementById('cancelarNovaPlataforma');
  if (cancelarNovaPlataforma) cancelarNovaPlataforma.addEventListener('click', () => { state.showNovaPlataforma = false; render(); });

  const confirmarNovaPlataforma = document.getElementById('confirmarNovaPlataforma');
  if (confirmarNovaPlataforma) confirmarNovaPlataforma.addEventListener('click', async () => {
    const nome = document.getElementById('novaPlataformaNome').value.trim();
    if (!nome) { alert('Informe o nome da plataforma.'); return; }
    const pct = parseBRNumber(document.getElementById('novaPlataformaPct').value);
    const fixa = parseBRNumber(document.getElementById('novaPlataformaFixa').value);
    await addPlataforma(nome, pct, fixa);
    state.showNovaPlataforma = false;
    render();
  });

  document.querySelectorAll('[data-remover-plataforma]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover essa plataforma da lista de taxas?')) await removePlataforma(btn.dataset.removerPlataforma);
    });
  });

  const selectAllBtn = document.getElementById('selectAllTx');
  if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
    const txFiltrado = state.filtroTipo === 'todos' ? c.txMes : c.txMes.filter((t) => t.tipo === state.filtroTipo);
    const allSelected = txFiltrado.length > 0 && txFiltrado.every((t) => state.selectedTxIds.has(t.id));
    state.selectedTxIds = allSelected ? new Set() : new Set(txFiltrado.map((t) => t.id));
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

    const plataformaId = document.getElementById('uploadPlataforma')?.value || '';
    const plataforma = state.plataformas.find((p) => p.id === plataformaId);
    const dataArquivo = guessDataFromFilename(file.name);

    // mapa de SKU (minúsculo, sem espaço nas pontas) -> produto
    // cada produto pode ter vários SKUs separados por vírgula (ex: "TOP-JACK, TOP-JACKK")
    const skuMap = new Map();
    state.produtos.forEach((p) => {
      if (!p.sku) return;
      p.sku.split(',').forEach((s) => {
        const key = s.trim().toLowerCase();
        if (key) skuMap.set(key, p);
      });
    });

    const novos = [];
    const deducoes = new Map(); // produtoId -> { qtd, ultimaData }
    const skusNaoEncontrados = new Set();
    let temSku = false;
    let totalTaxas = 0;
    let totalTaxasReais = 0;
    let totalTaxasEstimadas = 0;

    rows.forEach((row) => {
      const raw = guessValueField(row);
      if (!raw) return;
      const valor = parseBRNumber(String(raw));
      if (!valor) return;

      const descricaoItem = guessDescricaoField(row, file.name);
      const dataLinha = guessDataField(row) || dataArquivo || todayStr();
      const plataformaLinha = guessPlataformaFromRow(row, state.plataformas) || plataforma;
      const taxaPctLinha = plataformaLinha ? plataformaLinha.taxaPercentual : 0;
      const taxaFixaLinha = plataformaLinha ? plataformaLinha.taxaFixa : 0;

      novos.push({
        tipo: 'entrada', valor,
        categoria: plataformaLinha ? `Venda ${plataformaLinha.nome}` : 'Venda marketplace',
        descricao: descricaoItem,
        data: dataLinha,
      });

      const taxaReal = guessTaxaRealField(row);
      if (taxaReal !== null && taxaReal > 0) {
        totalTaxas += taxaReal;
        totalTaxasReais++;
        novos.push({
          tipo: 'saida', valor: Math.round(taxaReal * 100) / 100, categoria: 'Taxas de marketplace', natureza: 'variavel',
          descricao: `Taxa real${plataformaLinha ? ' ' + plataformaLinha.nome : ''} — ${descricaoItem}`,
          data: dataLinha,
        });
      } else if (taxaPctLinha > 0 || taxaFixaLinha > 0) {
        const taxaValor = Math.round((valor * (taxaPctLinha / 100) + taxaFixaLinha) * 100) / 100;
        totalTaxas += taxaValor;
        totalTaxasEstimadas++;
        novos.push({
          tipo: 'saida', valor: taxaValor, categoria: 'Taxas de marketplace', natureza: 'variavel',
          descricao: `Taxa estimada ${plataformaLinha.nome} (${taxaPctLinha}% + ${fmt(taxaFixaLinha)}) — ${descricaoItem}`,
          data: dataLinha,
        });
      }

      const sku = guessSkuField(row);
      if (sku) {
        temSku = true;
        const produto = skuMap.get(sku.trim().toLowerCase());
        const qtd = guessQuantidadeField(row);
        if (produto) {
          const atual = deducoes.get(produto.id) || { qtd: 0, ultimaData: dataLinha };
          atual.qtd += qtd;
          if (dataLinha > atual.ultimaData) atual.ultimaData = dataLinha;
          deducoes.set(produto.id, atual);
        } else {
          skusNaoEncontrados.add(sku);
        }
      }
    });

    if (!novos.length) {
      alert('Não encontrei nenhuma coluna de valor reconhecível nesse arquivo. Me manda o nome das colunas que eu ajusto.');
      state.showUpload = false;
      render();
      return;
    }

    await addTxBatch(novos);

    // aplica baixa de estoque + soma no total vendido
    for (const [produtoId, info] of deducoes.entries()) {
      const produto = state.produtos.find((p) => p.id === produtoId);
      if (produto) {
        const novoEstoque = Math.max(0, produto.estoqueAtual - info.qtd);
        const novoTotalVendido = (produto.totalVendido || 0) + info.qtd;
        await registrarVendaProduto(produtoId, novoEstoque, novoTotalVendido, info.ultimaData);
      }
    }

    state.showUpload = false;
    render();

    const qtdVendas = novos.filter((n) => n.tipo === 'entrada').length;
    let resumo = `${qtdVendas} venda(s) importada(s).`;
    if (totalTaxas > 0) {
      resumo += `\nTaxas descontadas: ${fmt(totalTaxas)}`;
      const partes = [];
      if (totalTaxasReais > 0) partes.push(`${totalTaxasReais} com valor real do relatório`);
      if (totalTaxasEstimadas > 0) partes.push(`${totalTaxasEstimadas} estimada(s) por %`);
      if (partes.length) resumo += ` (${partes.join(', ')}).`;
    }
    if (temSku) {
      resumo += `\n${deducoes.size} produto(s) com estoque baixado automaticamente.`;
      if (skusNaoEncontrados.size) {
        resumo += `\n\nSKUs não encontrados no cadastro (${skusNaoEncontrados.size}), estoque não foi baixado pra eles:\n` + [...skusNaoEncontrados].slice(0, 15).join(', ');
      }
    } else {
      resumo += `\n(Nenhuma coluna de SKU foi encontrada, então o estoque não foi ajustado.)`;
    }
    alert(resumo);
  });

  const salvarTx = document.getElementById('salvarTx');
  if (salvarTx) salvarTx.addEventListener('click', async () => {
    const tipo = window.__txFormTipo || 'saida';
    const valor = parseBRNumber(document.getElementById('txValor').value);
    const categoria = document.getElementById('txCategoria').value;
    const descricao = document.getElementById('txDescricao').value;
    const data = document.getElementById('txData').value || todayStr();
    const recorrente = document.getElementById('txRecorrente')?.checked || false;
    if (!valor || !categoria) { alert('Preencha valor e categoria.'); return; }
    const natureza = tipo === 'saida' ? (NATUREZA_POR_CATEGORIA[categoria] || 'variavel') : null;
    await addTx({ tipo, valor, categoria, natureza, descricao, data, recorrente });
    if (recorrente) { await loadData(); await garantirRecorrentes(); }
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
      const recorrente = document.getElementById(`editTxRecorrente-${id}`)?.checked || false;
      if (!valor || !categoria) { alert('Preencha valor e categoria.'); return; }
      const natureza = tipo === 'saida' ? (NATUREZA_POR_CATEGORIA[categoria] || 'variavel') : null;
      await updateTx(id, { tipo, valor, categoria, natureza, descricao, data, recorrente });
      if (recorrente) { await loadData(); await garantirRecorrentes(); }
      state.editingTxId = null;
      window.__editTxTipo = null;
      render();
    });
  });
}

function attachProducaoHandlers(c) {
  const toggleForm = document.getElementById('toggleCostureiraForm');
  if (toggleForm) toggleForm.addEventListener('click', () => { state.showCostureiraForm = !state.showCostureiraForm; render(); });

  const salvarCostureira = document.getElementById('salvarCostureira');
  if (salvarCostureira) salvarCostureira.addEventListener('click', async () => {
    const nome = document.getElementById('novaCostureiraNome').value.trim();
    if (!nome) { alert('Informe o nome da costureira.'); return; }
    await addCostureira(nome);
    state.showCostureiraForm = false;
    render();
  });

  document.querySelectorAll('[data-remover-costureira]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover essa costureira? O histórico de produção dela será apagado também.')) {
        await removeCostureira(btn.dataset.removerCostureira);
      }
    });
  });

  document.querySelectorAll('[data-pagar-costureira]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ids = btn.dataset.ids.split(',');
      const valor = Number(btn.dataset.valor);
      const nome = btn.dataset.nome;
      if (!confirm(`Confirmar pagamento de ${fmt(valor)} pra ${nome}?`)) return;
      await marcarProducaoPaga(ids);
      await addTx({
        tipo: 'saida', valor, categoria: 'Mão de obra — produção', natureza: 'variavel',
        descricao: `Produção — ${nome}`, data: todayStr(),
      });
      await loadData();
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
    const valorMaoObra = parseBRNumber(document.getElementById('pMaoObra').value);
    if (!nome) { alert('Informe o nome do produto.'); return; }
    await addProduto({ nome, sku, estoqueAtual, estoqueMinimo, custoUnitario, valorMaoObra });
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
      const valorMaoObra = parseBRNumber(document.getElementById(`editPMaoObra-${id}`).value);
      if (!nome) { alert('Informe o nome do produto.'); return; }
      await updateProduto(id, { nome, sku, estoqueAtual, estoqueMinimo, custoUnitario, valorMaoObra });
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

(async () => {
  await loadData();
  await garantirRecorrentes();
})();
setupRealtime();
