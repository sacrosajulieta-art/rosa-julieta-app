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
function inicioDaSemana(dataStr) {
  const d = new Date(dataStr + 'T00:00:00');
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
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
function guessIdPedidoField(row) {
  const candidates = ['id do pedido', 'número do pedido', 'numero do pedido', 'order id', 'nº do pedido'];
  for (const c of candidates) if (row[c]) return String(row[c]).trim();
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
  costureiraDetalheId: null,
  showValoresPecaForm: false,
  editingProducaoId: null,
  prodFiltroStatus: 'todos',
  prodFiltroInicio: null,
  prodFiltroFim: null,
  prodFiltroCostureiraId: null,
  showConciliacao: false,
  showResumoFinanceiro: false,
  showProdutosParados: false,
  variantes: [],
  showVarianteForm: {},
  materiaPrima: [],
  ordensCorte: [],
  ordensCorteItens: [],
  showCompraTecidoForm: false,
  showOrdemCorteForm: false,
  ordemConcluindoId: null,
  insumos: [],
  showCompraInsumoForm: false,
  showBaixaInsumoId: null,
  distribuicoes: [],
  distribuindoOrdemId: null,
  editingMateriaPrimaId: null,
  editingOrdemCorteId: null,
  showTabOrderForm: false,
  showTotalDefeitos: false,
  estoqueBusca: '',
  estoqueOrdenar: 'recentes',
  editandoEmMaosChave: null,
  fichaTecnicaItens: [],
  editingFichaTecnicaId: null,
  showNovoKitForm: false,
};

// ==================== DATA LAYER ====================
async function loadData() {
  const [{ data: tx, error: e1 }, { data: produtos, error: e2 }, { data: plataformas, error: e3 }, { data: costureiras, error: e4 }, { data: producoes, error: e5 }, { data: variantes, error: e6 }, { data: materiaPrima, error: e7 }, { data: ordensCorte, error: e8 }, { data: ordensCorteItens, error: e9 }, { data: insumos, error: e10 }, { data: distribuicoes, error: e11 }, { data: fichaTecnicaItens, error: e12 }] = await Promise.all([
    sb.from('transacoes').select('*').order('data', { ascending: false }),
    sb.from('produtos').select('*').order('created_at', { ascending: false }),
    sb.from('plataformas').select('*').order('nome', { ascending: true }),
    sb.from('costureiras').select('*').order('nome', { ascending: true }),
    sb.from('producoes').select('*').order('data', { ascending: false }),
    sb.from('variantes').select('*').order('nome', { ascending: true }),
    sb.from('materia_prima').select('*').order('cor', { ascending: true }),
    sb.from('ordens_corte').select('*').order('data_envio', { ascending: false }),
    sb.from('ordens_corte_itens').select('*'),
    sb.from('insumos').select('*').order('nome', { ascending: true }),
    sb.from('distribuicoes').select('*').order('data', { ascending: false }),
    sb.from('ficha_tecnica_itens').select('*'),
  ]);
  if (e1) console.error(e1);
  if (e2) console.error(e2);
  if (e3) console.error(e3);
  if (e4) console.error(e4);
  if (e5) console.error(e5);
  if (e6) console.error(e6);
  if (e7) console.error(e7);
  if (e8) console.error(e8);
  if (e9) console.error(e9);
  if (e10) console.error(e10);
  if (e11) console.error(e11);
  if (e12) console.error(e12);
  state.tx = (tx || []).map(mapTxFromDb);
  state.produtos = (produtos || []).map(mapProdutoFromDb);
  state.plataformas = (plataformas || []).map((p) => ({ id: p.id, nome: p.nome, taxaPercentual: Number(p.taxa_percentual), taxaFixa: Number(p.taxa_fixa || 0) }));
  state.costureiras = (costureiras || []).map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa }));
  state.producoes = (producoes || []).map((p) => ({ id: p.id, costureiraId: p.costureira_id, produtoId: p.produto_id, quantidade: p.quantidade, data: p.data, pago: p.pago, varianteId: p.variante_id || null }));
  state.variantes = (variantes || []).map((v) => ({ id: v.id, produtoId: v.produto_id, nome: v.nome, estoqueAtual: v.estoque_atual, skuVariante: v.sku_variante }));
  state.materiaPrima = (materiaPrima || []).map((m) => ({ id: m.id, cor: m.cor, rolosDisponiveis: m.rolos_disponiveis, custoMedioRolo: Number(m.custo_medio_rolo || 0) }));
  state.ordensCorte = (ordensCorte || []).map((o) => ({ id: o.id, cor: o.cor, quantidadeRolos: o.quantidade_rolos, valorTecido: Number(o.valor_tecido), dataEnvio: o.data_envio, status: o.status, dataConclusao: o.data_conclusao, tipo: o.tipo || 'principal', valorCorte: Number(o.valor_corte || 0), transacaoCorteId: o.transacao_corte_id || null }));
  state.ordensCorteItens = (ordensCorteItens || []).map((i) => ({ id: i.id, ordemId: i.ordem_id, produtoId: i.produto_id, quantidade: i.quantidade, varianteId: i.variante_id || null }));
  state.insumos = (insumos || []).map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade, quantidadeDisponivel: Number(i.quantidade_disponivel), custoMedioUnitario: Number(i.custo_medio_unitario) }));
  state.distribuicoes = (distribuicoes || []).map((d) => ({ id: d.id, ordemItemId: d.ordem_item_id, produtoId: d.produto_id, varianteId: d.variante_id || null, costureiraId: d.costureira_id, quantidadeDistribuida: d.quantidade_distribuida, quantidadeDevolvida: d.quantidade_devolvida, data: d.data }));
  state.fichaTecnicaItens = (fichaTecnicaItens || []).map((f) => ({ id: f.id, produtoId: f.produto_id, tipoItem: f.tipo_item, insumoId: f.insumo_id || null, componenteProdutoId: f.componente_produto_id || null, quantidade: Number(f.quantidade) }));
  state.loading = false;
  render();
}

function mapTxFromDb(row) {
  return { id: row.id, tipo: row.tipo, valor: Number(row.valor), categoria: row.categoria, natureza: row.natureza, descricao: row.descricao, data: row.data, recorrente: !!row.recorrente, recorrenteOrigemId: row.recorrente_origem_id || null, idPedido: row.id_pedido || null, conciliado: !!row.conciliado };
}
function mapProdutoFromDb(row) {
  return { id: row.id, nome: row.nome, sku: row.sku, estoqueAtual: row.estoque_atual, estoqueMinimo: row.estoque_minimo, custoUnitario: Number(row.custo_unitario), totalVendido: row.total_vendido || 0, ultimaVenda: row.ultima_venda || null, valorMaoObra: Number(row.valor_mao_obra || 0), tipo: row.tipo || 'unitario' };
}

async function addTx(tx) {
  const { data, error } = await sb.from('transacoes').insert({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, recorrente: !!tx.recorrente,
  }).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return null; }
  return data;
}
async function addTxBatch(rows) {
  const { error } = await sb.from('transacoes').insert(rows.map((tx) => ({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, id_pedido: tx.idPedido || null,
  })));
  if (error) alert('Erro ao importar: ' + error.message);
}
async function marcarTxConciliada(id, conciliado) {
  const { error } = await sb.from('transacoes').update({ conciliado }).eq('id', id);
  if (error) alert('Erro ao atualizar conciliação: ' + error.message);
}

// ---- Variantes de cor ----
function variantesDoProduto(produtoId) {
  return state.variantes.filter((v) => v.produtoId === produtoId);
}
function estoqueEfetivo(produto) {
  const vs = variantesDoProduto(produto.id);
  return vs.length ? vs.reduce((a, v) => a + v.estoqueAtual, 0) : produto.estoqueAtual;
}
async function addVariante(produtoId, nome, skuVariante) {
  const { error } = await sb.from('variantes').insert({ produto_id: produtoId, nome, estoque_atual: 0, sku_variante: skuVariante || null });
  if (error) alert('Erro ao adicionar cor: ' + error.message);
}
async function updateVarianteEstoque(id, novoEstoque) {
  const { error } = await sb.from('variantes').update({ estoque_atual: Math.max(0, novoEstoque) }).eq('id', id);
  if (error) alert('Erro ao atualizar estoque da cor: ' + error.message);
}
async function removeVariante(id) {
  const { error } = await sb.from('variantes').delete().eq('id', id);
  if (error) alert('Erro ao remover cor: ' + error.message);
}

// ---- Matéria-prima (tecido) ----
async function comprarTecido(cor, quantidadeRolos, valorTotal, data, lancarFinanceiro) {
  const existente = state.materiaPrima.find((m) => m.cor.trim().toLowerCase() === cor.trim().toLowerCase());
  if (existente) {
    const novoTotalRolos = existente.rolosDisponiveis + quantidadeRolos;
    const novoCustoMedio = novoTotalRolos > 0
      ? (existente.custoMedioRolo * existente.rolosDisponiveis + valorTotal) / novoTotalRolos
      : 0;
    const { error } = await sb.from('materia_prima').update({ rolos_disponiveis: novoTotalRolos, custo_medio_rolo: novoCustoMedio }).eq('id', existente.id);
    if (error) { alert('Erro ao registrar compra: ' + error.message); return; }
  } else {
    const custoMedio = quantidadeRolos > 0 ? valorTotal / quantidadeRolos : 0;
    const { error } = await sb.from('materia_prima').insert({ cor, rolos_disponiveis: quantidadeRolos, custo_medio_rolo: custoMedio });
    if (error) { alert('Erro ao registrar compra: ' + error.message); return; }
  }
  if (lancarFinanceiro) {
    await addTx({
      tipo: 'saida', valor: valorTotal, categoria: 'Tecido', natureza: 'variavel',
      descricao: `${quantidadeRolos} rolo(s) — ${cor}`, data,
    });
  }
}
async function updateMateriaPrima(id, cor, rolosDisponiveis, custoMedioRolo) {
  const { error } = await sb.from('materia_prima').update({ cor, rolos_disponiveis: rolosDisponiveis, custo_medio_rolo: custoMedioRolo }).eq('id', id);
  if (error) alert('Erro ao atualizar matéria-prima: ' + error.message);
}
async function removeMateriaPrima(id) {
  const { error } = await sb.from('materia_prima').delete().eq('id', id);
  if (error) alert('Erro ao remover matéria-prima: ' + error.message);
}
async function criarOrdemCorte(cor, quantidadeRolos, valorTecido, dataEnvio, tipo, valorCorte) {
  if (tipo === 'principal') {
    const materia = state.materiaPrima.find((m) => m.cor.trim().toLowerCase() === cor.trim().toLowerCase());
    if (!materia || materia.rolosDisponiveis < quantidadeRolos) {
      if (!confirm('Você tem menos rolos dessa cor em estoque do que está enviando. Confirma mesmo assim?')) return false;
    }
    if (materia) await sb.from('materia_prima').update({ rolos_disponiveis: Math.max(0, materia.rolosDisponiveis - quantidadeRolos) }).eq('id', materia.id);
  }
  const { data: ordemCriada, error } = await sb.from('ordens_corte').insert({
    cor, quantidade_rolos: quantidadeRolos, valor_tecido: valorTecido, data_envio: dataEnvio, status: 'aguardando', tipo, valor_corte: valorCorte || 0,
  }).select().single();
  if (error) { alert('Erro ao criar ordem de corte: ' + error.message); return false; }
  if (valorCorte > 0) {
    const tx = await addTx({
      tipo: 'saida', valor: valorCorte, categoria: 'Corte e costura (terceirizado)', natureza: 'variavel',
      descricao: `${tipo === 'retalho' ? 'Corte de retalhos' : 'Corte'} — ${cor}`, data: dataEnvio,
    });
    if (tx) await sb.from('ordens_corte').update({ transacao_corte_id: tx.id }).eq('id', ordemCriada.id);
  }
  return true;
}
async function concluirOrdemCorte(ordemId, itens) {
  for (const item of itens) {
    const { error } = await sb.from('ordens_corte_itens').insert({ ordem_id: ordemId, produto_id: item.produtoId, quantidade: item.quantidade });
    if (error) { alert('Erro ao salvar item do corte: ' + error.message); return; }
  }
  const { error } = await sb.from('ordens_corte').update({ status: 'concluido', data_conclusao: todayStr() }).eq('id', ordemId);
  if (error) alert('Erro ao concluir ordem: ' + error.message);
}
async function removeOrdemCorte(id) {
  const ordem = state.ordensCorte.find((o) => o.id === id);
  if (ordem && ordem.transacaoCorteId) await removeTx(ordem.transacaoCorteId);
  const { error } = await sb.from('ordens_corte').delete().eq('id', id);
  if (error) alert('Erro ao remover ordem: ' + error.message);
}
async function updateOrdemCorte(id, { cor, quantidadeRolos, valorTecido, valorCorte, dataEnvio }) {
  const ordem = state.ordensCorte.find((o) => o.id === id);
  let transacaoCorteId = ordem ? ordem.transacaoCorteId : null;
  const descricao = `${ordem && ordem.tipo === 'retalho' ? 'Corte de retalhos' : 'Corte'} — ${cor}`;

  if (transacaoCorteId) {
    if (valorCorte > 0) {
      await updateTx(transacaoCorteId, { tipo: 'saida', valor: valorCorte, categoria: 'Corte e costura (terceirizado)', natureza: 'variavel', descricao, data: dataEnvio, recorrente: false });
    } else {
      await removeTx(transacaoCorteId);
      transacaoCorteId = null;
    }
  } else if (valorCorte > 0) {
    const tx = await addTx({ tipo: 'saida', valor: valorCorte, categoria: 'Corte e costura (terceirizado)', natureza: 'variavel', descricao, data: dataEnvio });
    if (tx) transacaoCorteId = tx.id;
  }

  const { error } = await sb.from('ordens_corte').update({
    cor, quantidade_rolos: quantidadeRolos, valor_tecido: valorTecido, valor_corte: valorCorte, data_envio: dataEnvio, transacao_corte_id: transacaoCorteId,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar ordem de corte: ' + error.message);
}

// ---- Insumos (aviamentos, embalagem, etiquetas...) ----
async function comprarInsumo(nome, unidade, quantidade, valorTotal, categoria, data, lancarFinanceiro) {
  const existente = state.insumos.find((i) => i.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  if (existente) {
    const novaQtd = existente.quantidadeDisponivel + quantidade;
    const novoCusto = novaQtd > 0 ? (existente.custoMedioUnitario * existente.quantidadeDisponivel + valorTotal) / novaQtd : 0;
    const { error } = await sb.from('insumos').update({ quantidade_disponivel: novaQtd, custo_medio_unitario: novoCusto }).eq('id', existente.id);
    if (error) { alert('Erro ao registrar compra: ' + error.message); return; }
  } else {
    const custo = quantidade > 0 ? valorTotal / quantidade : 0;
    const { error } = await sb.from('insumos').insert({ nome, unidade, quantidade_disponivel: quantidade, custo_medio_unitario: custo });
    if (error) { alert('Erro ao registrar compra: ' + error.message); return; }
  }
  if (lancarFinanceiro) {
    await addTx({
      tipo: 'saida', valor: valorTotal, categoria, natureza: 'variavel',
      descricao: `${quantidade} ${unidade} — ${nome}`, data,
    });
  }
}
async function baixarInsumo(id, quantidadeUsada) {
  const insumo = state.insumos.find((i) => i.id === id);
  if (!insumo) return;
  const nova = Math.max(0, insumo.quantidadeDisponivel - quantidadeUsada);
  const { error } = await sb.from('insumos').update({ quantidade_disponivel: nova }).eq('id', id);
  if (error) alert('Erro ao dar baixa: ' + error.message);
}
async function removeInsumo(id) {
  const { error } = await sb.from('insumos').delete().eq('id', id);
  if (error) alert('Erro ao remover insumo: ' + error.message);
}

// ---- Distribuição de peças cortadas pras costureiras ----
async function distribuirPecas(ordemItemId, produtoId, varianteId, costureiraId, quantidade, data) {
  const { error } = await sb.from('distribuicoes').insert({
    ordem_item_id: ordemItemId, produto_id: produtoId, variante_id: varianteId || null,
    costureira_id: costureiraId, quantidade_distribuida: quantidade, quantidade_devolvida: 0, data,
  });
  if (error) alert('Erro ao distribuir peças: ' + error.message);
}
async function removeDistribuicao(id) {
  const { error } = await sb.from('distribuicoes').delete().eq('id', id);
  if (error) alert('Erro ao remover distribuição: ' + error.message);
}

// ---- Ficha de corte em PDF (duas vias: Costureira e Expedição) ----
function gerarFichaCortePDF(distribuicao, ordem) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('A biblioteca de PDF ainda não carregou. Aguarda alguns segundos e tenta de novo, ou feche e abra o app.');
    return;
  }
  try {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const produto = state.produtos.find((p) => p.id === distribuicao.produtoId);
  const variante = distribuicao.varianteId ? state.variantes.find((v) => v.id === distribuicao.varianteId) : null;
  const costureira = state.costureiras.find((c) => c.id === distribuicao.costureiraId);
  const nomeModelo = produto ? produto.nome : '—';
  const cor = variante ? variante.nome : (ordem ? ordem.cor : '—');
  const valorPeca = produto ? produto.valorMaoObra : 0;
  const totalPagar = valorPeca * distribuicao.quantidadeDistribuida;
  const dataCorte = ordem ? ordem.dataConclusao || ordem.dataEnvio : distribuicao.data;

  const desenharVia = (viaLabel, comConferencia) => {
    let y = 15;
    const margemEsq = 15;
    const largura = 180;

    doc.setFontSize(9);
    doc.text(viaLabel, margemEsq, y);
    y += 6;

    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('FICHA DE CORTE – ROSA JULIETA', margemEsq, y);
    doc.setFont(undefined, 'normal');
    y += 9;

    doc.setFontSize(10);
    doc.text(`NOME COSTUREIRA: ${costureira ? costureira.nome.toUpperCase() : '—'}`, margemEsq, y);
    doc.text(`DATA ENVIO: ${distribuicao.data}`, margemEsq + 110, y);
    y += 6;
    doc.text('NUMERO ETIQUETA COMPOSIÇÃO: _______________', margemEsq, y);
    y += 9;

    doc.setFont(undefined, 'bold');
    doc.text('1. IDENTIFICAÇÃO E CONTROLE DE SAÍDA DA PEÇA', margemEsq, y);
    doc.setFont(undefined, 'normal');
    y += 6;
    doc.text(`Nome do Modelo: ${nomeModelo}`, margemEsq, y); y += 5.5;
    doc.text(`SKU: ${produto?.sku || '—'}`, margemEsq, y); y += 5.5;
    doc.text(`Data do Corte: ${dataCorte}`, margemEsq, y); y += 5.5;
    doc.text(`Quantidade Total de Peças: ${distribuicao.quantidadeDistribuida} UNIDADES`, margemEsq, y); y += 5.5;
    doc.text(`Cor: ${cor}`, margemEsq, y); y += 9;

    doc.setFont(undefined, 'bold');
    doc.text('2. CONTROLE DE ENTREGA', margemEsq, y);
    doc.setFont(undefined, 'normal');
    y += 6;
    for (let i = 1; i <= 6; i++) {
      doc.text(`Entrega ${i} — Data: _______________  Quantidade: _______________`, margemEsq, y);
      y += 6.5;
    }
    doc.text('TOTAL DE PEÇAS ENTREGUES: _______________', margemEsq, y);
    y += 9;

    doc.setFont(undefined, 'bold');
    doc.text('3. CONTROLE DE DEFEITOS', margemEsq, y);
    doc.setFont(undefined, 'normal');
    y += 6;
    doc.text('Quantidade Peças com Defeito: _______________', margemEsq, y); y += 6;
    doc.text('Tipo de Defeito: _____________________________________________________', margemEsq, y); y += 9;

    if (comConferencia) {
      doc.setFont(undefined, 'bold');
      doc.text('4. CONFERÊNCIA NA DEVOLUÇÃO (GALPÃO)', margemEsq, y);
      doc.setFont(undefined, 'normal');
      y += 6;
      doc.text('Quantidade Entregue: _______   Aprovada: _______   Reprovada: _______', margemEsq, y);
      y += 9;
    }

    doc.setFont(undefined, 'bold');
    doc.text('5. CONTROLE DE PAGAMENTO', margemEsq, y);
    doc.setFont(undefined, 'normal');
    y += 6;
    doc.text(`Valor por Peça: ${fmt(valorPeca)}`, margemEsq, y); y += 5.5;
    doc.text(`Total a Pagar (se tudo aprovado): ${fmt(totalPagar)}`, margemEsq, y); y += 5.5;
    doc.setFontSize(8.5);
    doc.text('OBS: O pagamento será realizado apenas sobre as peças conferidas e aprovadas.', margemEsq, y);
    doc.setFontSize(10);
    y += 10;
    doc.text('Data da Entrega Total do Corte: _____ / _____ / _________', margemEsq, y);
    y += 12;
    doc.text('Assinatura: _________________________________________________', margemEsq, y);
  };

  desenharVia('1ª via — Costureira', false);
  doc.addPage();
  desenharVia('2ª via — Expedição', true);

  const nomeArquivo = `ficha-corte-${(costureira?.nome || 'costureira').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${distribuicao.data}.pdf`;
  doc.save(nomeArquivo);
  } catch (err) {
    console.error(err);
    alert('Não consegui gerar o PDF: ' + err.message);
  }
}
// baixa automática (FIFO) do que a costureira tem em mãos, quando ela devolve peças prontas
async function baixarDistribuicoesFIFO(costureiraId, produtoId, varianteId, quantidadeDevolvida) {
  let restante = quantidadeDevolvida;
  const abertas = state.distribuicoes
    .filter((d) => d.costureiraId === costureiraId && d.produtoId === produtoId && (d.varianteId || null) === (varianteId || null) && d.quantidadeDevolvida < d.quantidadeDistribuida)
    .sort((a, b) => a.data.localeCompare(b.data));
  for (const d of abertas) {
    if (restante <= 0) break;
    const disponivel = d.quantidadeDistribuida - d.quantidadeDevolvida;
    const abate = Math.min(disponivel, restante);
    await sb.from('distribuicoes').update({ quantidade_devolvida: d.quantidadeDevolvida + abate }).eq('id', d.id);
    restante -= abate;
  }
}
// desfaz devoluções já registradas (das mais recentes pra trás), pra "devolver" peças às mãos da costureira
async function restaurarDistribuicoesLIFO(costureiraId, produtoId, varianteId, quantidadeARestaurar) {
  let restante = quantidadeARestaurar;
  const comDevolucao = state.distribuicoes
    .filter((d) => d.costureiraId === costureiraId && d.produtoId === produtoId && (d.varianteId || null) === (varianteId || null) && d.quantidadeDevolvida > 0)
    .sort((a, b) => b.data.localeCompare(a.data));
  for (const d of comDevolucao) {
    if (restante <= 0) break;
    const restaura = Math.min(d.quantidadeDevolvida, restante);
    await sb.from('distribuicoes').update({ quantidade_devolvida: d.quantidadeDevolvida - restaura }).eq('id', d.id);
    restante -= restaura;
  }
  return restante; // > 0 se não havia devolução suficiente pra desfazer
}
// ajusta o total de "peças em mãos" pro valor informado, distribuindo a diferença
// entre as distribuições existentes (sem mexer no estoque de peças prontas)
async function ajustarPecasEmMaos(costureiraId, produtoId, varianteId, novoTotal) {
  const relacionadas = state.distribuicoes.filter((d) => d.costureiraId === costureiraId && d.produtoId === produtoId && (d.varianteId || null) === (varianteId || null));
  const totalAtual = relacionadas.reduce((a, d) => a + (d.quantidadeDistribuida - d.quantidadeDevolvida), 0);
  const diferenca = novoTotal - totalAtual;
  if (diferenca === 0) return;
  if (diferenca < 0) {
    await baixarDistribuicoesFIFO(costureiraId, produtoId, varianteId, Math.abs(diferenca));
  } else {
    const sobrou = await restaurarDistribuicoesLIFO(costureiraId, produtoId, varianteId, diferenca);
    if (sobrou > 0) {
      alert(`Consegui ajustar só ${diferenca - sobrou} de ${diferenca} peças a mais, porque não havia devolução suficiente registrada pra desfazer.`);
    }
  }
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
  const { data, error } = await sb.from('produtos').insert({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, valor_mao_obra: p.valorMaoObra || 0, tipo: p.tipo || 'unitario',
  }).select().single();
  if (error) { alert('Erro ao salvar produto: ' + error.message); return null; }
  return data;
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
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, valor_mao_obra: p.valorMaoObra || 0, tipo: p.tipo || 'unitario',
  }).eq('id', id);
  if (error) alert('Erro ao atualizar produto: ' + error.message);
}

// ---- Ficha técnica (receita de insumos + produtos componentes por produto/kit) ----
function fichaTecnicaDoProduto(produtoId) {
  return state.fichaTecnicaItens.filter((f) => f.produtoId === produtoId);
}
// custo total = tecido/corte + mão de obra + (insumos da ficha × custo) + (produtos componentes da ficha × custo total deles, recursivo)
function calcularCustoTotalProduto(produtoId, visitados) {
  visitados = visitados || new Set();
  if (visitados.has(produtoId)) return 0; // evita loop infinito se alguém criar uma referência circular
  visitados.add(produtoId);
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (!produto) return 0;
  let total = (produto.custoUnitario || 0) + (produto.valorMaoObra || 0);
  fichaTecnicaDoProduto(produtoId).forEach((item) => {
    if (item.tipoItem === 'insumo') {
      const insumo = state.insumos.find((i) => i.id === item.insumoId);
      if (insumo) total += insumo.custoMedioUnitario * item.quantidade;
    } else if (item.tipoItem === 'produto') {
      total += calcularCustoTotalProduto(item.componenteProdutoId, visitados) * item.quantidade;
    }
  });
  return total;
}
async function salvarFichaTecnica(produtoId, itens) {
  const { error: errDel } = await sb.from('ficha_tecnica_itens').delete().eq('produto_id', produtoId);
  if (errDel) { alert('Erro ao salvar ficha técnica: ' + errDel.message); return; }
  if (itens.length === 0) return;
  const { error: errIns } = await sb.from('ficha_tecnica_itens').insert(itens.map((item) => ({
    produto_id: produtoId,
    tipo_item: item.tipoItem,
    insumo_id: item.tipoItem === 'insumo' ? item.refId : null,
    componente_produto_id: item.tipoItem === 'produto' ? item.refId : null,
    quantidade: item.quantidade,
  })));
  if (errIns) alert('Erro ao salvar ficha técnica: ' + errIns.message);
}
// desconta do estoque os insumos e produtos-componentes da ficha técnica, proporcional à quantidade vendida
async function baixarEstoquePorFichaTecnica(produtoId, quantidadeVendida, dataVenda, visitados) {
  visitados = visitados || new Set();
  if (visitados.has(produtoId)) return;
  visitados.add(produtoId);
  for (const item of fichaTecnicaDoProduto(produtoId)) {
    const qtdConsumida = item.quantidade * quantidadeVendida;
    if (item.tipoItem === 'insumo') {
      const insumo = state.insumos.find((i) => i.id === item.insumoId);
      if (insumo) await baixarInsumo(insumo.id, qtdConsumida);
    } else if (item.tipoItem === 'produto') {
      const componente = state.produtos.find((p) => p.id === item.componenteProdutoId);
      if (componente) {
        const novoEstoque = Math.max(0, componente.estoqueAtual - qtdConsumida);
        const novoTotalVendido = (componente.totalVendido || 0) + qtdConsumida;
        await registrarVendaProduto(componente.id, novoEstoque, novoTotalVendido, dataVenda);
        await baixarEstoquePorFichaTecnica(componente.id, qtdConsumida, dataVenda, visitados);
      }
    }
  }
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
async function registrarProducao(costureiraId, produtoId, quantidade, data, varianteId, jaPago) {
  const { error } = await sb.from('producoes').insert({ costureira_id: costureiraId, produto_id: produtoId, quantidade, data, pago: !!jaPago, variante_id: varianteId || null });
  if (error) { alert('Erro ao registrar produção: ' + error.message); return; }
  if (varianteId) {
    const variante = state.variantes.find((v) => v.id === varianteId);
    if (variante) await updateVarianteEstoque(varianteId, variante.estoqueAtual + quantidade);
  } else {
    const produto = state.produtos.find((p) => p.id === produtoId);
    if (produto) await updateProdutoEstoque(produtoId, produto.estoqueAtual + quantidade);
  }
  if (quantidade !== 0) await baixarDistribuicoesFIFO(costureiraId, produtoId, varianteId, Math.abs(quantidade));
}
async function marcarProducaoPaga(ids) {
  const { error } = await sb.from('producoes').update({ pago: true }).in('id', ids);
  if (error) alert('Erro ao marcar produção como paga: ' + error.message);
}
async function removeProducao(id) {
  const p = state.producoes.find((x) => x.id === id);
  if (p) {
    if (p.varianteId) {
      const variante = state.variantes.find((v) => v.id === p.varianteId);
      if (variante) await updateVarianteEstoque(variante.id, variante.estoqueAtual - p.quantidade);
    } else {
      const produto = state.produtos.find((x) => x.id === p.produtoId);
      if (produto) await updateProdutoEstoque(produto.id, Math.max(0, produto.estoqueAtual - p.quantidade));
    }
  }
  const { error } = await sb.from('producoes').delete().eq('id', id);
  if (error) alert('Erro ao remover lançamento: ' + error.message);
}
async function updateProducao(id, novo) {
  const antigo = state.producoes.find((p) => p.id === id);
  if (!antigo) return;
  const { error } = await sb.from('producoes').update({ produto_id: novo.produtoId, quantidade: novo.quantidade, data: novo.data }).eq('id', id);
  if (error) { alert('Erro ao editar lançamento: ' + error.message); return; }
  // lançamentos com cor (variante) não trocam de produto na edição — só ajusta a quantidade na mesma cor
  if (antigo.varianteId) {
    const variante = state.variantes.find((v) => v.id === antigo.varianteId);
    if (variante) await updateVarianteEstoque(variante.id, Math.max(0, variante.estoqueAtual + (novo.quantidade - antigo.quantidade)));
    return;
  }
  if (antigo.produtoId === novo.produtoId) {
    const produto = state.produtos.find((p) => p.id === novo.produtoId);
    if (produto) await updateProdutoEstoque(produto.id, Math.max(0, produto.estoqueAtual + (novo.quantidade - antigo.quantidade)));
  } else {
    const produtoAntigo = state.produtos.find((p) => p.id === antigo.produtoId);
    if (produtoAntigo) await updateProdutoEstoque(produtoAntigo.id, Math.max(0, produtoAntigo.estoqueAtual - antigo.quantidade));
    const produtoNovo = state.produtos.find((p) => p.id === novo.produtoId);
    if (produtoNovo) await updateProdutoEstoque(produtoNovo.id, produtoNovo.estoqueAtual + novo.quantidade);
  }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'variantes' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'materia_prima' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens_corte' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens_corte_itens' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'insumos' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'distribuicoes' }, loadData)
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
    const estoqueReal = estoqueEfetivo(p);
    const precisaRepor = estoqueReal <= p.estoqueMinimo;
    const qtdSugerida = Math.max(p.estoqueMinimo * 2 - estoqueReal, p.estoqueMinimo || 1);
    const custoRepor = qtdSugerida * p.custoUnitario;
    let status = 'ok';
    if (estoqueReal <= 0) status = 'critico';
    else if (precisaRepor) status = saldoTotal >= custoRepor ? 'pode-cortar' : 'aguarde';
    const diasSemVender = p.ultimaVenda ? Math.floor((Date.now() - new Date(p.ultimaVenda + 'T00:00:00').getTime()) / 86400000) : null;
    return { ...p, estoqueAtual: estoqueReal, precisaRepor, qtdSugerida, custoRepor, status, diasSemVender };
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

  // valor real do estoque: matéria-prima + insumos parados + peças prontas (pelo custo, não preço de venda)
  const valorInsumos = state.insumos.reduce((a, i) => a + i.quantidadeDisponivel * i.custoMedioUnitario, 0);
  const valorMateriaPrima = state.materiaPrima.reduce((a, m) => a + m.rolosDisponiveis * m.custoMedioRolo, 0) + valorInsumos;
  const valorPecasProntas = produtosStatus.reduce((a, p) => a + p.estoqueAtual * p.custoUnitario, 0);
  const valorEstoqueTotal = valorMateriaPrima + valorPecasProntas;
  const materiaPrimaDetalhe = state.materiaPrima
    .filter((m) => m.rolosDisponiveis > 0)
    .map((m) => [`${m.cor} (${m.rolosDisponiveis} rolo(s))`, m.rolosDisponiveis * m.custoMedioRolo])
    .concat(state.insumos.filter((i) => i.quantidadeDisponivel > 0).map((i) => [`${i.nome} (${i.quantidadeDisponivel} ${i.unidade})`, i.quantidadeDisponivel * i.custoMedioUnitario]))
    .sort((a, b) => b[1] - a[1]);
  const pecasProntasDetalhe = produtosStatus
    .filter((p) => p.estoqueAtual > 0)
    .map((p) => [`${p.nome} (${p.estoqueAtual} un)`, p.estoqueAtual * p.custoUnitario])
    .sort((a, b) => b[1] - a[1]);

  return { saldoTotal, txMes, entradasMes, saidasMes, custoFixo, custoVariavel, produtosStatus, produtosParados, contasAVencer, valorMateriaPrima, valorPecasProntas, valorEstoqueTotal, materiaPrimaDetalhe, pecasProntasDetalhe };
}

// ==================== RENDER ====================
// ---- Produção (visão do dono) ----
function renderProducaoDono(c) {
  if (state.costureiraDetalheId) return renderCostureiraDetalhe(state.costureiraDetalheId);

  const naoPagas = state.producoes.filter((p) => !p.pago);
  const porCostureira = {};
  naoPagas.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const nomeProduto = produto?.nome || 'Produto removido';
    const valorUnit = produto ? produto.valorMaoObra : 0;
    const valorItem = p.quantidade * valorUnit;
    if (!porCostureira[p.costureiraId]) porCostureira[p.costureiraId] = { qtd: 0, valor: 0, ids: [], porProduto: {} };
    porCostureira[p.costureiraId].qtd += p.quantidade;
    porCostureira[p.costureiraId].valor += valorItem;
    porCostureira[p.costureiraId].ids.push(p.id);
    if (!porCostureira[p.costureiraId].porProduto[nomeProduto]) porCostureira[p.costureiraId].porProduto[nomeProduto] = { qtd: 0, valor: 0 };
    porCostureira[p.costureiraId].porProduto[nomeProduto].qtd += p.quantidade;
    porCostureira[p.costureiraId].porProduto[nomeProduto].valor += valorItem;
  });

  // defeitos da loja toda: total geral + por costureira + por modelo
  const todosDefeitos = state.producoes.filter((p) => p.quantidade < 0);
  const totalDefeitosLoja = todosDefeitos.reduce((a, p) => a + Math.abs(p.quantidade), 0);
  const defeitosPorCostureira = {};
  const defeitosPorProduto = {};
  todosDefeitos.forEach((p) => {
    const costureira = state.costureiras.find((cc) => cc.id === p.costureiraId);
    const nomeCost = costureira?.nome || 'Costureira removida';
    defeitosPorCostureira[nomeCost] = (defeitosPorCostureira[nomeCost] || 0) + Math.abs(p.quantidade);
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const nomeProd = produto?.nome || 'Produto removido';
    defeitosPorProduto[nomeProd] = (defeitosPorProduto[nomeProd] || 0) + Math.abs(p.quantidade);
  });
  const rankingDefeitosCostureira = Object.entries(defeitosPorCostureira).sort((a, b) => b[1] - a[1]);
  const rankingDefeitosProduto = Object.entries(defeitosPorProduto).sort((a, b) => b[1] - a[1]);

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Defeitos da loja</div><div class="section-subtitle">Total de peças perdidas por defeito, todas as costureiras</div></div>
      <button class="icon-btn-ghost" id="toggleTotalDefeitos">${state.showTotalDefeitos ? '✕ Fechar' : `⚠️ Ver total (${totalDefeitosLoja})`}</button>
    </div>

    ${state.showTotalDefeitos ? `
      <div class="form-card">
        <div class="stats-grid" style="margin-bottom:16px">
          <div class="stat-card">
            <div class="stat-icon" style="background:rgba(255,71,87,0.1)">⚠️</div>
            <div class="stat-label">Total de defeitos</div>
            <div class="stat-value" style="color:var(--red)">${totalDefeitosLoja}</div>
          </div>
        </div>
        ${totalDefeitosLoja === 0 ? `<div class="empty-state">Nenhum defeito registrado ainda 🎉</div>` : `
          <div class="section-title" style="margin-bottom:2px">Por costureira</div>
          <div class="tx-list" style="margin-bottom:20px">
            ${rankingDefeitosCostureira.map(([nome, qtd]) => `
              <div class="tx-row">
                <div class="tx-dot" style="background:var(--red)"></div>
                <div style="flex:1"><div class="tx-categoria">${esc(nome)}</div></div>
                <div class="tx-valor" style="color:var(--red)">${qtd} peças</div>
              </div>
            `).join('')}
          </div>
          <div class="section-title" style="margin-bottom:2px">Por modelo</div>
          <div class="tx-list">
            ${rankingDefeitosProduto.map(([nome, qtd]) => `
              <div class="tx-row">
                <div class="tx-dot" style="background:var(--red)"></div>
                <div style="flex:1"><div class="tx-categoria">${esc(nome)}</div></div>
                <div class="tx-valor" style="color:var(--red)">${qtd} peças</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    ` : ''}

    <div class="section-title-wrap">
      <div><div class="section-title">Valores por peça (SKU)</div><div class="section-subtitle">Quanto você paga por peça de cada modelo</div></div>
      <button class="icon-btn-ghost" id="toggleValoresPeca">${state.showValoresPecaForm ? '✕ Fechar' : '💲 Ver/editar'}</button>
    </div>

    ${state.showValoresPecaForm ? `
      <div class="form-card">
        ${state.produtos.length === 0 ? `<div class="form-hint">Cadastre produtos no Estoque primeiro.</div>` : `
          ${state.produtos.map((p) => `
            <div class="taxa-row">
              <div class="taxa-row-nome">${esc(p.nome)}${p.sku ? ` <span style="color:var(--text-muted);font-weight:400">(${esc(p.sku)})</span>` : ''}</div>
              <div class="taxa-row-inputs">
                <div class="taxa-input-group">
                  <span>R$</span>
                  <input type="text" id="valorPeca-${p.id}" value="${(p.valorMaoObra || 0).toFixed(2).replace('.', ',')}" placeholder="0" />
                </div>
              </div>
            </div>
          `).join('')}
          <button class="confirm-btn" id="salvarValoresPeca">Salvar valores</button>
        `}
      </div>
    ` : ''}

    <div class="section-title-wrap">
      <div><div class="section-title">Costureiras</div><div class="section-subtitle">Toque numa costureira pra ver o histórico completo</div></div>
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
          <div class="tx-row" style="cursor:pointer" data-abrir-costureira="${cost.id}">
            <div class="tx-dot" style="background:${cost.ativa ? 'var(--teal)' : 'var(--text-muted)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(cost.nome)}</div></div>
            <span style="color:var(--text-muted);font-size:16px">›</span>
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
          const costureira = state.costureiras.find((cc) => cc.id === costureiraId);
          const produtosLista = Object.entries(info.porProduto).sort((a, b) => b[1].qtd - a[1].qtd);
          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(costureira?.nome || 'Costureira removida')}</div>
                  <div class="produto-sku">${info.qtd} peças (líquido)</div>
                </div>
                <div class="dre-td-num ${info.valor >= 0 ? 'dre-positivo' : 'dre-negativo'}" style="font-size:16px">${fmt(info.valor)}</div>
              </div>
              <div class="prod-breakdown">
                ${produtosLista.map(([nome, dados]) => `<div class="prod-breakdown-item"><span>${esc(nome)}</span><span>${dados.qtd} peças · ${fmt(dados.valor)}</span></div>`).join('')}
              </div>
              <button class="confirm-btn" style="margin-top:10px" data-pagar-costureira="${costureiraId}" data-ids="${info.ids.join(',')}" data-valor="${info.valor}" data-nome="${esc(costureira?.nome || '')}">✅ Pagar ${fmt(info.valor)}</button>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

function renderCostureiraDetalhe(costureiraId) {
  const cost = state.costureiras.find((c) => c.id === costureiraId);
  const entradas = state.producoes.filter((p) => p.costureiraId === costureiraId).sort((a, b) => b.data.localeCompare(a.data));
  const totalPago = entradas.filter((p) => p.pago).reduce((acc, p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    return acc + p.quantidade * (produto ? produto.valorMaoObra : 0);
  }, 0);
  const pendentes = entradas.filter((p) => !p.pago);
  const totalPendenteQtd = pendentes.reduce((a, p) => a + p.quantidade, 0);
  const totalPendenteValor = pendentes.reduce((acc, p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    return acc + p.quantidade * (produto ? produto.valorMaoObra : 0);
  }, 0);

  // resumo agrupado por produto, só do que ainda está pendente (a semana em aberto)
  const porProdutoPendente = {};
  pendentes.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const nome = produto?.nome || 'Produto removido';
    if (!porProdutoPendente[nome]) porProdutoPendente[nome] = { qtd: 0, valor: 0 };
    porProdutoPendente[nome].qtd += p.quantidade;
    porProdutoPendente[nome].valor += p.quantidade * (produto ? produto.valorMaoObra : 0);
  });
  const resumoProdutos = Object.entries(porProdutoPendente).sort((a, b) => b[1].qtd - a[1].qtd);

  const entradasFiltradas = entradas.filter((p) => {
    if (state.prodFiltroStatus === 'pendente' && p.pago) return false;
    if (state.prodFiltroStatus === 'pago' && !p.pago) return false;
    if (state.prodFiltroInicio && p.data < state.prodFiltroInicio) return false;
    if (state.prodFiltroFim && p.data > state.prodFiltroFim) return false;
    return true;
  });
  const porDiaFiltrado = {};
  entradasFiltradas.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const valorItem = p.quantidade * (produto ? produto.valorMaoObra : 0);
    if (!porDiaFiltrado[p.data]) porDiaFiltrado[p.data] = { qtd: 0, valor: 0 };
    porDiaFiltrado[p.data].qtd += p.quantidade;
    porDiaFiltrado[p.data].valor += valorItem;
  });
  const resumoPorDia = Object.entries(porDiaFiltrado).sort((a, b) => b[0].localeCompare(a[0]));

  // peças cortadas que essa costureira ainda tem em mãos (distribuído - já devolvido)
  const emMaosMap = {};
  state.distribuicoes.filter((d) => d.costureiraId === costureiraId).forEach((d) => {
    const restante = d.quantidadeDistribuida - d.quantidadeDevolvida;
    if (restante <= 0) return;
    const produto = state.produtos.find((p) => p.id === d.produtoId);
    const variante = d.varianteId ? state.variantes.find((v) => v.id === d.varianteId) : null;
    const chaveId = `${d.produtoId}|${d.varianteId || ''}`;
    const nome = `${produto?.nome || 'Produto removido'}${variante ? ' — ' + variante.nome : ''}`;
    if (!emMaosMap[chaveId]) emMaosMap[chaveId] = { nome, qtd: 0, produtoId: d.produtoId, varianteId: d.varianteId || null };
    emMaosMap[chaveId].qtd += restante;
  });
  const emMaosLista = Object.values(emMaosMap).sort((a, b) => b.qtd - a.qtd);

  // defeitos: total de peças perdidas por defeito, dessa costureira
  const defeitos = entradas.filter((p) => p.quantidade < 0);
  const totalDefeitosQtd = defeitos.reduce((a, p) => a + Math.abs(p.quantidade), 0);
  const porProdutoDefeito = {};
  defeitos.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const nome = produto?.nome || 'Produto removido';
    porProdutoDefeito[nome] = (porProdutoDefeito[nome] || 0) + Math.abs(p.quantidade);
  });
  const resumoDefeitos = Object.entries(porProdutoDefeito).sort((a, b) => b[1] - a[1]);

  const tipo = window.__prodDetalheTipo || 'producao';

  return `
    <button class="icon-btn-ghost" id="voltarCostureiras" style="margin-bottom:14px">← Voltar</button>

    ${emMaosLista.length > 0 ? `
      <div class="section-title-wrap">
        <div><div class="section-title">Peças em mãos</div><div class="section-subtitle">Cortadas e distribuídas, ainda não devolvidas prontas</div></div>
      </div>
      <div class="tx-list" style="margin-bottom:20px">
        ${emMaosLista.map((item) => {
          const chaveId = `${item.produtoId}|${item.varianteId || ''}`;
          const editando = state.editandoEmMaosChave === chaveId;
          return `
          <div class="tx-row">
            <div class="tx-dot" style="background:var(--amber)"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(item.nome)}</div></div>
            ${editando ? `
              <input type="text" id="editEmMaosQtd" value="${item.qtd}" style="width:70px;margin-right:6px" />
              <button class="confirm-btn" style="width:auto;padding:8px 10px" data-salvar-em-maos="1" data-produto="${item.produtoId}" data-variante="${item.varianteId || ''}" data-costureira="${costureiraId}">OK</button>
              <button class="trash-btn" data-cancelar-em-maos="1">✕</button>
            ` : `
              <div class="tx-valor" style="color:var(--amber);margin-right:6px">${item.qtd} peças</div>
              <button class="trash-btn" data-editar-em-maos="${chaveId}">✏️</button>
            `}
          </div>
        `;
        }).join('')}
      </div>
    ` : ''}

    <div class="section-title-wrap">
      <div><div class="section-title">${esc(cost?.nome || 'Costureira')}</div><div class="section-subtitle">Histórico completo de produção</div></div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.1)">💰</div>
        <div class="stat-label">Já pago (histórico)</div>
        <div class="stat-value">${fmt(totalPago)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,182,39,0.1)">⏳</div>
        <div class="stat-label">Pendente</div>
        <div class="stat-value">${fmt(totalPendenteValor)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.1)">📦</div>
        <div class="stat-label">Peças pendentes</div>
        <div class="stat-value">${totalPendenteQtd}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,71,87,0.1)">⚠️</div>
        <div class="stat-label">Defeitos (total)</div>
        <div class="stat-value" style="color:var(--red)">${totalDefeitosQtd}</div>
      </div>
    </div>

    ${resumoDefeitos.length > 0 ? `
      <div class="section-title-wrap">
        <div><div class="section-title">Defeitos por modelo</div><div class="section-subtitle">Histórico completo dessa costureira</div></div>
      </div>
      <div class="tx-list" style="margin-bottom:28px">
        ${resumoDefeitos.map(([nome, qtd]) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:var(--red)"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(nome)}</div></div>
            <div class="tx-valor" style="color:var(--red)">${qtd} peças</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-title-wrap">
      <div><div class="section-title">Resumo da semana (pendente)</div><div class="section-subtitle">Total por modelo, pronto pro fechamento de sexta</div></div>
    </div>
    ${resumoProdutos.length === 0 ? `<div class="empty-state">Nenhuma produção pendente pra essa costureira.</div>` : `
      <div class="tx-list" style="margin-bottom:28px">
        ${resumoProdutos.map(([nome, info]) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(nome)}</div></div>
            <div class="tx-valor" style="color:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}">${info.qtd} peças</div>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Novo lançamento</div></div>
      <button class="icon-btn" id="toggleDetalheForm">＋ Lançar</button>
    </div>

    ${state.showProducaoForm ? `
      <div class="form-card">
        <div class="form-row">
          <button class="toggle-btn ${tipo === 'producao' ? 'active-teal' : ''}" data-prod-detalhe-tipo="producao">✅ Produção</button>
          <button class="toggle-btn ${tipo === 'defeito' ? 'active-pink' : ''}" data-prod-detalhe-tipo="defeito">⚠️ Defeito</button>
        </div>
        <select id="detalheProduto">
          <option value="">Selecione o produto</option>
          ${state.produtos.map((p) => `<option value="${p.id}" ${window.__prodFormProdutoId === p.id ? 'selected' : ''}>${esc(p.nome)}${p.sku ? ' — ' + esc(p.sku) : ''}</option>`).join('')}
        </select>
        ${window.__prodFormProdutoId && variantesDoProduto(window.__prodFormProdutoId).length > 0 ? `
          <select id="detalheVariante">
            <option value="">Selecione a cor</option>
            ${variantesDoProduto(window.__prodFormProdutoId).map((v) => `<option value="${v.id}">${esc(v.nome)}</option>`).join('')}
          </select>
        ` : ''}
        <input type="text" id="detalheQuantidade" placeholder="Quantidade de peças" inputmode="numeric" />
        <input type="date" id="detalheData" value="${todayStr()}" />
        <label class="checkbox-label"><input type="checkbox" id="detalheJaPago" /> 💰 Já foi pago antes (não lançar no financeiro)</label>
        <button class="confirm-btn" id="salvarDetalheProducao" data-costureira="${costureiraId}">${tipo === 'defeito' ? 'Registrar defeito' : 'Registrar produção'}</button>
      </div>
    ` : ''}

    <div class="section-title-wrap"><div><div class="section-title">Lançamentos</div><div class="section-subtitle">Filtre por status ou período</div></div></div>

    <div class="filtro-tipo-bar">
      <button class="filtro-tipo-btn ${state.prodFiltroStatus === 'todos' ? 'active' : ''}" data-prod-filtro-status="todos">Tudo</button>
      <button class="filtro-tipo-btn ${state.prodFiltroStatus === 'pendente' ? 'active-teal' : ''}" data-prod-filtro-status="pendente">Pendente</button>
      <button class="filtro-tipo-btn ${state.prodFiltroStatus === 'pago' ? 'active-teal' : ''}" data-prod-filtro-status="pago">Pago</button>
    </div>
    <div class="form-row" style="margin-bottom:10px">
      <input type="date" id="prodFiltroInicio" value="${state.prodFiltroInicio || ''}" />
      <input type="date" id="prodFiltroFim" value="${state.prodFiltroFim || ''}" />
    </div>
    <div class="form-row" style="margin-bottom:20px">
      <button class="icon-btn-ghost" id="filtroEstaSemana" style="flex:1">📅 Esta semana</button>
      <button class="icon-btn-ghost" id="filtroLimpar" style="flex:1">✕ Limpar período</button>
    </div>

    <div class="section-title-wrap"><div><div class="section-title">Resumo por dia</div></div></div>
    ${resumoPorDia.length === 0 ? `<div class="empty-state">Nenhum lançamento no filtro selecionado.</div>` : `
      <div class="tx-list" style="margin-bottom:28px">
        ${resumoPorDia.map(([dia, info]) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${dia}</div></div>
            <div class="tx-valor" style="color:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}">${info.qtd} peças · ${fmt(info.valor)}</div>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title-wrap"><div><div class="section-title">Detalhado</div></div></div>
    ${entradasFiltradas.length === 0 ? `<div class="empty-state">Nenhum lançamento no filtro selecionado.</div>` : `
      <div class="tx-list">
        ${entradasFiltradas.map((p) => {
          const produto = state.produtos.find((x) => x.id === p.produtoId);
          const valor = p.quantidade * (produto ? produto.valorMaoObra : 0);
          const ehDefeito = p.quantidade < 0;

          if (state.editingProducaoId === p.id) {
            const tipoEdit = window.__editProdTipo || (ehDefeito ? 'defeito' : 'producao');
            return `
              <div class="form-card">
                <div class="form-row">
                  <button class="toggle-btn ${tipoEdit === 'producao' ? 'active-teal' : ''}" data-edit-prod-tipo="producao">✅ Produção</button>
                  <button class="toggle-btn ${tipoEdit === 'defeito' ? 'active-pink' : ''}" data-edit-prod-tipo="defeito">⚠️ Defeito</button>
                </div>
                <select id="editProdProduto-${p.id}">
                  ${state.produtos.map((prod) => `<option value="${prod.id}" ${prod.id === p.produtoId ? 'selected' : ''}>${esc(prod.nome)}${prod.sku ? ' — ' + esc(prod.sku) : ''}</option>`).join('')}
                </select>
                <input type="text" id="editProdQuantidade-${p.id}" value="${Math.abs(p.quantidade)}" placeholder="Quantidade" />
                <input type="date" id="editProdData-${p.id}" value="${p.data}" />
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-producao="${p.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-producao="${p.id}">Cancelar</button>
                </div>
              </div>
            `;
          }

          return `
            <div class="tx-row">
              <div class="tx-dot" style="background:${ehDefeito ? 'var(--red)' : p.pago ? 'var(--teal)' : 'var(--amber)'}"></div>
              <div style="flex:1">
                <div class="tx-categoria">${esc(produto?.nome || 'Produto removido')}${p.varianteId ? ` — ${esc(state.variantes.find((v) => v.id === p.varianteId)?.nome || '')}` : ''}${ehDefeito ? ' ⚠️ Defeito' : ''}</div>
                <div class="tx-desc">${p.quantidade} peças · ${fmt(valor)}${p.pago ? ' · pago' : ' · pendente'}</div>
                <div class="tx-date">${p.data}</div>
              </div>
              <button class="trash-btn" data-editar-producao="${p.id}">✏️</button>
              <button class="trash-btn" data-remover-producao="${p.id}">🗑</button>
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

  const listaFiltrada = state.producoes.filter((p) => {
    if (state.prodFiltroCostureiraId && p.costureiraId !== state.prodFiltroCostureiraId) return false;
    if (state.prodFiltroStatus === 'pendente' && p.pago) return false;
    if (state.prodFiltroStatus === 'pago' && !p.pago) return false;
    if (state.prodFiltroInicio && p.data < state.prodFiltroInicio) return false;
    if (state.prodFiltroFim && p.data > state.prodFiltroFim) return false;
    return true;
  }).sort((a, b) => (b.data + b.id).localeCompare(a.data + a.id));

  const porDia = {};
  listaFiltrada.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const valorItem = p.quantidade * (produto ? produto.valorMaoObra : 0);
    if (!porDia[p.data]) porDia[p.data] = { qtd: 0, valor: 0 };
    porDia[p.data].qtd += p.quantidade;
    porDia[p.data].valor += valorItem;
  });
  const resumoPorDia = Object.entries(porDia).sort((a, b) => b[0].localeCompare(a[0]));

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
          <div class="form-row">
            <button class="toggle-btn ${(window.__prodSupTipo || 'producao') === 'producao' ? 'active-teal' : ''}" data-prod-sup-tipo="producao">✅ Produção</button>
            <button class="toggle-btn ${window.__prodSupTipo === 'defeito' ? 'active-pink' : ''}" data-prod-sup-tipo="defeito">⚠️ Defeito</button>
          </div>
          <select id="prodCostureira">
            <option value="">Selecione a costureira</option>
            ${costureirasAtivas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}
          </select>
          <select id="prodProduto">
            <option value="">Selecione o produto</option>
            ${state.produtos.map((p) => `<option value="${p.id}" ${window.__prodFormProdutoId === p.id ? 'selected' : ''}>${esc(p.nome)}${p.sku ? ' — ' + esc(p.sku) : ''}</option>`).join('')}
          </select>
          ${window.__prodFormProdutoId && variantesDoProduto(window.__prodFormProdutoId).length > 0 ? `
            <select id="prodVariante">
              <option value="">Selecione a cor</option>
              ${variantesDoProduto(window.__prodFormProdutoId).map((v) => `<option value="${v.id}">${esc(v.nome)}</option>`).join('')}
            </select>
          ` : ''}
          <input type="text" id="prodQuantidade" placeholder="Quantidade de peças" inputmode="numeric" />
          <input type="date" id="prodData" value="${hoje}" />
          <button class="confirm-btn" id="salvarProducao">${(window.__prodSupTipo || 'producao') === 'defeito' ? 'Registrar defeito' : 'Registrar produção'}</button>
        </div>
      `}

      <div class="section-title-wrap"><div><div class="section-title">Histórico</div><div class="section-subtitle">Filtre por costureira, status ou período</div></div></div>

      <select id="supFiltroCostureira" style="margin-bottom:10px">
        <option value="">Todas as costureiras</option>
        ${state.costureiras.map((c) => `<option value="${c.id}" ${state.prodFiltroCostureiraId === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
      </select>

      <div class="filtro-tipo-bar">
        <button class="filtro-tipo-btn ${state.prodFiltroStatus === 'todos' ? 'active' : ''}" data-prod-filtro-status="todos">Tudo</button>
        <button class="filtro-tipo-btn ${state.prodFiltroStatus === 'pendente' ? 'active-teal' : ''}" data-prod-filtro-status="pendente">Pendente</button>
        <button class="filtro-tipo-btn ${state.prodFiltroStatus === 'pago' ? 'active-teal' : ''}" data-prod-filtro-status="pago">Pago</button>
      </div>
      <div class="form-row" style="margin-bottom:10px">
        <input type="date" id="prodFiltroInicio" value="${state.prodFiltroInicio || ''}" />
        <input type="date" id="prodFiltroFim" value="${state.prodFiltroFim || ''}" />
      </div>
      <div class="form-row" style="margin-bottom:20px">
        <button class="icon-btn-ghost" id="filtroEstaSemana" style="flex:1">📅 Esta semana</button>
        <button class="icon-btn-ghost" id="filtroLimpar" style="flex:1">✕ Limpar período</button>
      </div>

      <div class="section-title-wrap"><div><div class="section-title">Resumo por dia</div></div></div>
      ${resumoPorDia.length === 0 ? `<div class="empty-state">Nenhum lançamento no filtro selecionado.</div>` : `
        <div class="tx-list" style="margin-bottom:28px">
          ${resumoPorDia.map(([dia, info]) => `
            <div class="tx-row">
              <div class="tx-dot" style="background:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}"></div>
              <div style="flex:1"><div class="tx-categoria">${dia}</div></div>
              <div class="tx-valor" style="color:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}">${info.qtd} peças · ${fmt(info.valor)}</div>
            </div>
          `).join('')}
        </div>
      `}

      <div class="section-title-wrap"><div><div class="section-title">Lançamentos</div></div></div>
      ${listaFiltrada.length === 0 ? `<div class="empty-state">Nenhum lançamento no filtro selecionado.</div>` : `
        <div class="tx-list">
          ${listaFiltrada.map((p) => {
            const costureira = state.costureiras.find((c) => c.id === p.costureiraId);
            const produto = state.produtos.find((x) => x.id === p.produtoId);
            const ehDefeito = p.quantidade < 0;

            if (state.editingProducaoId === p.id) {
              const tipoEdit = window.__editProdTipo || (ehDefeito ? 'defeito' : 'producao');
              return `
                <div class="form-card">
                  <div class="form-row">
                    <button class="toggle-btn ${tipoEdit === 'producao' ? 'active-teal' : ''}" data-edit-prod-tipo="producao">✅ Produção</button>
                    <button class="toggle-btn ${tipoEdit === 'defeito' ? 'active-pink' : ''}" data-edit-prod-tipo="defeito">⚠️ Defeito</button>
                  </div>
                  <select id="editProdProduto-${p.id}">
                    ${state.produtos.map((prod) => `<option value="${prod.id}" ${prod.id === p.produtoId ? 'selected' : ''}>${esc(prod.nome)}${prod.sku ? ' — ' + esc(prod.sku) : ''}</option>`).join('')}
                  </select>
                  <input type="text" id="editProdQuantidade-${p.id}" value="${Math.abs(p.quantidade)}" placeholder="Quantidade" />
                  <input type="date" id="editProdData-${p.id}" value="${p.data}" />
                  <div class="form-row">
                    <button class="confirm-btn" data-salvar-edit-producao="${p.id}">Salvar</button>
                    <button class="toggle-btn" data-cancelar-edit-producao="${p.id}">Cancelar</button>
                  </div>
                </div>
              `;
            }

            return `
              <div class="tx-row">
                <div class="tx-dot" style="background:${ehDefeito ? 'var(--red)' : p.pago ? 'var(--teal)' : 'var(--amber)'}"></div>
                <div style="flex:1">
                  <div class="tx-categoria">${esc(costureira?.nome || '—')}${ehDefeito ? ' ⚠️' : ''}</div>
                  <div class="tx-desc">${esc(produto?.nome || '—')}${p.varianteId ? ` — ${esc(state.variantes.find((v) => v.id === p.varianteId)?.nome || '')}` : ''} · ${p.quantidade} peças</div>
                  <div class="tx-date">${p.data}${p.pago ? ' · pago' : ' · pendente'}</div>
                </div>
                <button class="trash-btn" data-editar-producao="${p.id}">✏️</button>
                <button class="trash-btn" data-remover-producao="${p.id}">🗑</button>
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

  document.querySelectorAll('[data-prod-sup-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__prodSupTipo = btn.dataset.prodSupTipo; render(); });
  });

  const prodProdutoSelect = document.getElementById('prodProduto');
  if (prodProdutoSelect) prodProdutoSelect.addEventListener('change', (e) => { window.__prodFormProdutoId = e.target.value; render(); });

  const salvarBtn = document.getElementById('salvarProducao');
  if (salvarBtn) salvarBtn.addEventListener('click', async () => {
    const costureiraId = document.getElementById('prodCostureira').value;
    const produtoId = document.getElementById('prodProduto').value;
    const varianteSelect = document.getElementById('prodVariante');
    const varianteId = varianteSelect ? varianteSelect.value : '';
    let quantidade = Number(document.getElementById('prodQuantidade').value);
    const data = document.getElementById('prodData').value || hoje;
    if (!costureiraId || !produtoId || !quantidade || quantidade <= 0) {
      alert('Selecione a costureira, o produto e informe a quantidade.');
      return;
    }
    if (varianteSelect && !varianteId) { alert('Selecione a cor.'); return; }
    if ((window.__prodSupTipo || 'producao') === 'defeito') quantidade = -quantidade;
    await registrarProducao(costureiraId, produtoId, quantidade, data, varianteId || null);
    window.__prodSupTipo = 'producao';
    window.__prodFormProdutoId = null;
    await loadData();
  });

  const supFiltroCostureira = document.getElementById('supFiltroCostureira');
  if (supFiltroCostureira) supFiltroCostureira.addEventListener('change', (e) => { state.prodFiltroCostureiraId = e.target.value || null; render(); });

  document.querySelectorAll('[data-prod-filtro-status]').forEach((btn) => {
    btn.addEventListener('click', () => { state.prodFiltroStatus = btn.dataset.prodFiltroStatus; render(); });
  });

  const filtroInicio = document.getElementById('prodFiltroInicio');
  if (filtroInicio) filtroInicio.addEventListener('change', (e) => { state.prodFiltroInicio = e.target.value || null; render(); });
  const filtroFim = document.getElementById('prodFiltroFim');
  if (filtroFim) filtroFim.addEventListener('change', (e) => { state.prodFiltroFim = e.target.value || null; render(); });

  const filtroEstaSemana = document.getElementById('filtroEstaSemana');
  if (filtroEstaSemana) filtroEstaSemana.addEventListener('click', () => {
    state.prodFiltroInicio = inicioDaSemana(todayStr());
    state.prodFiltroFim = todayStr();
    render();
  });
  const filtroLimpar = document.getElementById('filtroLimpar');
  if (filtroLimpar) filtroLimpar.addEventListener('click', () => {
    state.prodFiltroInicio = null;
    state.prodFiltroFim = null;
    render();
  });

  document.querySelectorAll('[data-editar-producao]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.editingProducaoId = btn.dataset.editarProducao;
      window.__editProdTipo = null;
      render();
    });
  });
  document.querySelectorAll('[data-cancelar-edit-producao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingProducaoId = null; render(); });
  });
  document.querySelectorAll('[data-edit-prod-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__editProdTipo = btn.dataset.editProdTipo; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-producao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditProducao;
      const produtoId = document.getElementById(`editProdProduto-${id}`).value;
      let quantidade = Number(document.getElementById(`editProdQuantidade-${id}`).value);
      const data = document.getElementById(`editProdData-${id}`).value || todayStr();
      const tipoEdit = window.__editProdTipo || 'producao';
      if (!produtoId || !quantidade || quantidade <= 0) { alert('Selecione o produto e informe a quantidade.'); return; }
      if (tipoEdit === 'defeito') quantidade = -quantidade;
      await updateProducao(id, { produtoId, quantidade, data });
      state.editingProducaoId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-remover-producao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover esse lançamento? Isso também ajusta o estoque de volta.')) {
        await removeProducao(btn.dataset.removerProducao);
        await loadData();
      }
    });
  });
}

// ---- Conciliação ----
function renderConciliacao(c) {
  const pendentes = state.tx.filter((t) => t.tipo === 'entrada' && !t.conciliado).sort((a, b) => a.data.localeCompare(b.data));
  const totalPendente = pendentes.reduce((a, t) => a + t.valor, 0);
  const hoje = todayStr();

  return `
    <div class="form-card">
      <div class="form-hint">Vendas ainda não confirmadas como recebidas da plataforma. Confirme manualmente quando o dinheiro cair, ou importe o relatório de repasse/liquidação da plataforma pra tentar casar automaticamente pelo número do pedido.</div>

      <label class="file-label">📤 Importar relatório de repasse (CSV ou Excel)<input type="file" accept=".csv,.xlsx,.xls" id="repasseInput" style="display:none" /></label>

      <div style="margin-top:14px;font-size:12.5px;color:var(--text-muted)">
        ${pendentes.length} venda(s) pendente(s) · total ${fmt(totalPendente)}
      </div>

      ${pendentes.length === 0 ? `<div class="empty-state" style="margin-top:10px">Tudo conciliado 🎉</div>` : `
        <div class="tx-list" style="margin-top:10px">
          ${pendentes.slice(0, 50).map((t) => {
            const dias = Math.floor((new Date(hoje + 'T00:00:00') - new Date(t.data + 'T00:00:00')) / 86400000);
            return `
              <div class="tx-row">
                <div class="tx-dot" style="background:var(--amber)"></div>
                <div style="flex:1">
                  <div class="tx-categoria">${esc(t.categoria)}</div>
                  <div class="tx-desc">${esc(t.descricao || '')}${t.idPedido ? ` · Pedido ${esc(t.idPedido)}` : ''}</div>
                  <div class="tx-date">${t.data} · há ${dias} dia(s)</div>
                </div>
                <div class="tx-valor" style="color:var(--teal)">${fmt(t.valor)}</div>
                <button class="trash-btn" data-conciliar-tx="${t.id}">✅</button>
              </div>
            `;
          }).join('')}
        </div>
        ${pendentes.length > 50 ? `<div class="form-hint" style="margin-top:8px">Mostrando as 50 mais antigas.</div>` : ''}
      `}
    </div>
  `;
}
// ---- Materiais (matéria-prima + insumos) ----
function renderMateriais(c) {
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Matéria-prima</div><div class="section-subtitle">Rolos de tecido em estoque, por cor</div></div>
      <button class="icon-btn" id="toggleCompraTecido">＋ Comprar</button>
    </div>

    ${state.showCompraTecidoForm ? `
      <div class="form-card">
        <select id="tecidoCorSelect">
          <option value="" ${!window.__tecidoCorSelecionada ? 'selected' : ''}>Selecione a cor...</option>
          ${state.materiaPrima.map((m) => `<option value="${esc(m.cor)}" ${window.__tecidoCorSelecionada === m.cor ? 'selected' : ''}>${esc(m.cor)} (${m.rolosDisponiveis} em estoque)</option>`).join('')}
          <option value="__nova__" ${window.__tecidoCorNova ? 'selected' : ''}>➕ Nova cor</option>
        </select>
        ${window.__tecidoCorNova ? `<input type="text" id="tecidoCorNova" placeholder="Nome da nova cor" value="${esc(window.__tecidoCorNovaTexto || '')}" />` : ''}

        <div class="form-hint">🧮 Sabe só o peso total comprado? Calcule a quantidade de rolos automaticamente (peso médio ajustável, cada rolo costuma pesar entre 19,5kg e 20kg).</div>
        <div class="form-row">
          <input type="text" id="tecidoPesoTotal" placeholder="Peso total comprado (kg)" inputmode="decimal" />
          <input type="text" id="tecidoPesoRolo" placeholder="Peso médio por rolo (kg)" value="19,75" inputmode="decimal" />
        </div>
        <button class="entrada-btn" type="button" id="calcularRolosPeso">🧮 Calcular quantidade de rolos</button>

        <div class="form-row">
          <input type="text" id="tecidoRolos" placeholder="Quantidade de rolos" inputmode="numeric" />
          <input type="text" id="tecidoValor" placeholder="Valor total pago (R$)" />
        </div>
        <div class="form-hint" id="tecidoPreviewCusto" style="display:none"></div>
        <input type="date" id="tecidoData" value="${todayStr()}" />
        <label class="checkbox-label"><input type="checkbox" id="tecidoHistorico" /> 📦 Já tinha esse tecido antes do sistema (não lançar despesa)</label>
        <button class="confirm-btn" id="salvarCompraTecido">Registrar compra</button>
      </div>
    ` : ''}

    ${state.materiaPrima.length === 0 ? `<div class="empty-state">Nenhum tecido cadastrado ainda.</div>` : `
      <div class="tx-list" style="margin-bottom:28px">
        ${state.materiaPrima.map((m) => {
          if (state.editingMateriaPrimaId === m.id) {
            return `
              <div class="form-card">
                <input type="text" id="editMpCor-${m.id}" placeholder="Cor" value="${esc(m.cor)}" />

                <div class="form-hint">🧮 Sabe o peso total em estoque? Calcule a quantidade de rolos (peso médio ajustável, 19,5kg a 20kg por rolo).</div>
                <div class="form-row">
                  <input type="text" id="editMpPesoTotal-${m.id}" placeholder="Peso total (kg)" inputmode="decimal" />
                  <input type="text" id="editMpPesoRolo-${m.id}" placeholder="Peso médio/rolo (kg)" value="19,75" inputmode="decimal" />
                </div>
                <button class="entrada-btn" type="button" data-calcular-rolos-peso-mp="${m.id}">🧮 Calcular rolos</button>

                <input type="text" id="editMpRolos-${m.id}" placeholder="Rolos disponíveis" value="${m.rolosDisponiveis}" />
                <div class="form-hint">Preencha o valor TOTAL pago por esses rolos — o custo médio por rolo é calculado sozinho.</div>
                <div class="form-row">
                  <input type="text" id="editMpValorTotal-${m.id}" placeholder="Valor total pago (R$)" inputmode="decimal" />
                  <input type="text" id="editMpCusto-${m.id}" placeholder="Custo médio por rolo (R$)" value="${m.custoMedioRolo.toFixed(2).replace('.', ',')}" />
                </div>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-mp="${m.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-mp="${m.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          return `
          <div class="tx-row">
            <div class="tx-dot" style="background:${m.rolosDisponiveis > 0 ? 'var(--teal)' : 'var(--red)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(m.cor)}</div><div class="tx-desc">${fmt(m.custoMedioRolo)}/rolo (média)</div></div>
            <div class="tx-valor" style="margin-right:6px">${m.rolosDisponiveis} rolo(s)</div>
            <button class="trash-btn" data-editar-mp="${m.id}">✏️</button>
            <button class="trash-btn" data-remover-mp="${m.id}">🗑</button>
          </div>
        `;
        }).join('')}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Outros insumos</div><div class="section-subtitle">Zíper, elástico, bojo, etiqueta, saquinho...</div></div>
      <button class="icon-btn" id="toggleCompraInsumo">＋ Comprar</button>
    </div>

    ${state.showCompraInsumoForm ? `
      <div class="form-card">
        <input type="text" id="insumoNome" placeholder="Nome (ex: Zíper 20cm, Bojo P, Etiqueta)" />
        <div class="form-row">
          <input type="text" id="insumoQuantidade" placeholder="Quantidade" inputmode="decimal" />
          <select id="insumoUnidade">
            <option value="un">unidade</option>
            <option value="m">metro</option>
            <option value="cm">cm</option>
            <option value="par">par</option>
            <option value="pacote">pacote</option>
          </select>
        </div>
        <input type="text" id="insumoValor" placeholder="Valor total pago (R$)" />
        <select id="insumoCategoria">
          <option value="Aviamento">Aviamento (zíper, elástico, bojo...)</option>
          <option value="Embalagem">Embalagem (saquinho, caixa...)</option>
          <option value="Etiquetas/Tags">Etiquetas/Tags</option>
        </select>
        <input type="date" id="insumoData" value="${todayStr()}" />
        <label class="checkbox-label"><input type="checkbox" id="insumoHistorico" /> 📦 Já tinha antes do sistema (não lançar despesa)</label>
        <button class="confirm-btn" id="salvarCompraInsumo">Registrar compra</button>
      </div>
    ` : ''}

    ${state.insumos.length === 0 ? `<div class="empty-state">Nenhum insumo cadastrado ainda.</div>` : `
      <div class="tx-list">
        ${state.insumos.map((i) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:${i.quantidadeDisponivel > 0 ? 'var(--teal)' : 'var(--red)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(i.nome)}</div><div class="tx-desc">${fmt(i.custoMedioUnitario)}/${esc(i.unidade)} (média)</div></div>
            ${state.showBaixaInsumoId === i.id ? `
              <input type="text" id="baixaQtd-${i.id}" placeholder="Qtd usada" style="width:70px;margin-right:6px" />
              <button class="confirm-btn" style="width:auto;padding:8px 10px" data-confirmar-baixa="${i.id}">OK</button>
            ` : `
              <div class="tx-valor" style="margin-right:6px">${i.quantidadeDisponivel} ${esc(i.unidade)}</div>
              <button class="trash-btn" data-abrir-baixa="${i.id}">➖</button>
            `}
            <button class="trash-btn" data-remover-insumo="${i.id}">🗑</button>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

// ---- Corte (ordens de corte: envio, resultado, distribuição pras costureiras) ----
function renderCorte(c) {
  const aguardando = state.ordensCorte.filter((o) => o.status === 'aguardando').sort((a, b) => a.dataEnvio.localeCompare(b.dataEnvio));
  const concluidas = [...state.ordensCorte.filter((o) => o.status === 'concluido')].sort((a, b) => b.dataConclusao.localeCompare(a.dataConclusao));

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Ordens de corte</div><div class="section-subtitle">Envio de tecido pro corte e resultado em peças</div></div>
      <button class="icon-btn" id="toggleOrdemCorte">＋ Enviar corte</button>
    </div>

    ${state.showOrdemCorteForm ? `
      <div class="form-card">
        <div class="form-row">
          <button class="toggle-btn ${(window.__ordemTipo || 'principal') === 'principal' ? 'active-teal' : ''}" data-ordem-tipo="principal">✂️ Corte principal</button>
          <button class="toggle-btn ${window.__ordemTipo === 'retalho' ? 'active-pink' : ''}" data-ordem-tipo="retalho">♻️ Corte de retalhos</button>
        </div>
        ${(window.__ordemTipo || 'principal') === 'principal' ? `
          <select id="ordemCor">
            <option value="">Selecione a cor</option>
            ${state.materiaPrima.map((m) => `<option value="${esc(m.cor)}" data-custo="${m.custoMedioRolo}">${esc(m.cor)} (${m.rolosDisponiveis} disponível)</option>`).join('')}
          </select>
          <div class="form-row">
            <input type="text" id="ordemRolos" placeholder="Quantidade de rolos enviados" inputmode="numeric" />
            <input type="text" id="ordemValor" placeholder="Valor do tecido usado (R$)" />
          </div>
          <input type="text" id="ordemValorCorte" placeholder="Valor do corte, se pagar à parte (opcional)" />
        ` : `
          <div class="form-hint">O tecido dos retalhos já foi pago no corte principal — aqui só entra o valor de cortar de novo.</div>
          <input type="text" id="ordemCorRetalho" placeholder="De qual cor são esses retalhos? (referência)" />
          <input type="text" id="ordemValorCorte" placeholder="Valor pago pelo corte dos retalhos (R$)" />
        `}
        <input type="date" id="ordemData" value="${todayStr()}" />
        <button class="confirm-btn" id="salvarOrdemCorte">Enviar pro corte</button>
      </div>
    ` : ''}

    ${aguardando.length === 0 ? '' : `
      <div class="produto-list" style="margin-bottom:20px">
        ${aguardando.map((o) => {
          if (state.editingOrdemCorteId === o.id) {
            return `
              <div class="form-card">
                <input type="text" id="editOrdemCor-${o.id}" placeholder="Cor" value="${esc(o.cor)}" />
                <div class="form-row">
                  <input type="text" id="editOrdemRolos-${o.id}" placeholder="Rolos" value="${o.quantidadeRolos}" />
                  <input type="text" id="editOrdemValorTecido-${o.id}" placeholder="Valor do tecido (R$)" value="${o.valorTecido.toFixed(2).replace('.', ',')}" />
                </div>
                <div class="form-row">
                  <input type="text" id="editOrdemValorCorte-${o.id}" placeholder="Valor do corte (R$)" value="${o.valorCorte.toFixed(2).replace('.', ',')}" />
                  <input type="date" id="editOrdemData-${o.id}" value="${o.dataEnvio}" />
                </div>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-ordem="${o.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-ordem="${o.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          return `
          <div class="produto-card" style="border-color:var(--amber)55">
            <div class="produto-header">
              <div>
                <div class="produto-nome">${o.tipo === 'retalho' ? '♻️ ' : ''}${esc(o.cor)}${o.quantidadeRolos > 0 ? ` — ${o.quantidadeRolos} rolo(s)` : ''}</div>
                <div class="produto-sku">Enviado em ${o.dataEnvio} · ${o.valorTecido > 0 ? fmt(o.valorTecido) + ' tecido' : ''}${o.valorCorte > 0 ? `${o.valorTecido > 0 ? ' + ' : ''}${fmt(o.valorCorte)} corte` : ''} · 🟡 Aguardando resultado</div>
              </div>
              <div style="display:flex;gap:2px">
                <button class="trash-btn" data-editar-ordem="${o.id}">✏️</button>
                <button class="trash-btn" data-remover-ordem="${o.id}">🗑</button>
              </div>
            </div>
            ${state.ordemConcluindoId === o.id ? `
              <div class="entrada-box">
                <div class="form-hint">Quantas peças de cada modelo saíram desse corte?</div>
                ${[0, 1, 2, 3, 4].map((i) => `
                  <div class="form-row">
                    <select id="corteItemProduto-${o.id}-${i}">
                      <option value="">Modelo (opcional)</option>
                      ${state.produtos.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}
                    </select>
                    <input type="text" id="corteItemQtd-${o.id}-${i}" placeholder="Peças" inputmode="numeric" />
                  </div>
                `).join('')}
                <div class="form-row">
                  <button class="confirm-btn" data-confirmar-conclusao="${o.id}">Salvar resultado</button>
                  <button class="toggle-btn" data-cancelar-conclusao="${o.id}">Cancelar</button>
                </div>
              </div>
            ` : `<button class="entrada-btn" data-abrir-conclusao="${o.id}">📋 Registrar resultado do corte</button>`}
          </div>
        `;
        }).join('')}
      </div>
    `}

    <div class="section-title-wrap"><div><div class="section-title">Cortes concluídos</div></div></div>
    ${concluidas.length === 0 ? `<div class="empty-state">Nenhum corte concluído ainda.</div>` : `
      <div class="produto-list">
        ${concluidas.map((o) => {
          if (state.editingOrdemCorteId === o.id) {
            return `
              <div class="form-card">
                <input type="text" id="editOrdemCor-${o.id}" placeholder="Cor" value="${esc(o.cor)}" />
                <div class="form-row">
                  <input type="text" id="editOrdemRolos-${o.id}" placeholder="Rolos" value="${o.quantidadeRolos}" />
                  <input type="text" id="editOrdemValorTecido-${o.id}" placeholder="Valor do tecido (R$)" value="${o.valorTecido.toFixed(2).replace('.', ',')}" />
                </div>
                <div class="form-row">
                  <input type="text" id="editOrdemValorCorte-${o.id}" placeholder="Valor do corte (R$)" value="${o.valorCorte.toFixed(2).replace('.', ',')}" />
                  <input type="date" id="editOrdemData-${o.id}" value="${o.dataEnvio}" />
                </div>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-ordem="${o.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-ordem="${o.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          const itens = state.ordensCorteItens.filter((i) => i.ordemId === o.id);
          const totalPecas = itens.reduce((a, i) => a + i.quantidade, 0);
          const custoTotal = o.valorTecido + o.valorCorte;
          const custoPorPeca = totalPecas > 0 ? custoTotal / totalPecas : 0;
          const rendimento = o.quantidadeRolos > 0 ? totalPecas / o.quantidadeRolos : null;
          const outrasDaCor = concluidas.filter((x) => x.id !== o.id && x.cor === o.cor && x.tipo === 'principal');
          const rendimentosAnteriores = outrasDaCor.map((x) => {
            const its = state.ordensCorteItens.filter((i) => i.ordemId === x.id);
            const tot = its.reduce((a, i) => a + i.quantidade, 0);
            return x.quantidadeRolos > 0 ? tot / x.quantidadeRolos : null;
          }).filter((v) => v !== null);
          const mediaAnterior = rendimentosAnteriores.length ? rendimentosAnteriores.reduce((a, v) => a + v, 0) / rendimentosAnteriores.length : null;

          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${o.tipo === 'retalho' ? '♻️ ' : ''}${esc(o.cor)}${o.quantidadeRolos > 0 ? ` — ${o.quantidadeRolos} rolo(s)` : ''}</div>
                  <div class="produto-sku">${o.dataEnvio} → ${o.dataConclusao} · ${o.valorTecido > 0 ? fmt(o.valorTecido) + ' tecido' : ''}${o.valorCorte > 0 ? `${o.valorTecido > 0 ? ' + ' : ''}${fmt(o.valorCorte)} corte` : ''}</div>
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-editar-ordem="${o.id}">✏️</button>
                  <button class="trash-btn" data-remover-ordem="${o.id}">🗑</button>
                </div>
              </div>
              <div class="prod-breakdown">
                ${itens.map((i) => {
                  const produto = state.produtos.find((p) => p.id === i.produtoId);
                  return `<div class="prod-breakdown-item"><span>${esc(produto?.nome || 'Produto removido')}</span><span>${i.quantidade} peças</span></div>`;
                }).join('')}
              </div>
              <div class="produto-meta" style="margin-top:8px">
                Custo por peça: <strong style="color:var(--text)">${fmt(custoPorPeca)}</strong>${rendimento !== null ? ` · Rendimento: <strong style="color:var(--text)">${rendimento.toFixed(1)} peças/rolo</strong>` : ''}
                ${mediaAnterior !== null ? ` · Média anterior dessa cor: ${mediaAnterior.toFixed(1)} peças/rolo ${rendimento < mediaAnterior * 0.9 ? '⚠️ abaixo da média' : rendimento > mediaAnterior * 1.1 ? '✅ acima da média' : ''}` : ''}
              </div>
              <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
                ${itens.map((i) => {
                  const produto = state.produtos.find((p) => p.id === i.produtoId);
                  if (!produto || Math.abs(produto.custoUnitario - custoPorPeca) < 0.01) return '';
                  return `<button class="entrada-btn" data-aplicar-custo="${produto.id}" data-custo="${custoPorPeca.toFixed(2)}">💲 Atualizar custo de "${esc(produto.nome)}" pra ${fmt(custoPorPeca)}</button>`;
                }).join('')}
              </div>

              ${state.distribuindoOrdemId === o.id ? `
                <div class="entrada-box">
                  <div class="form-hint">Quem ficou com quantas peças de cada modelo?</div>
                  ${itens.map((i) => {
                    const produto = state.produtos.find((p) => p.id === i.produtoId);
                    const jaDistribuido = state.distribuicoes.filter((d) => d.ordemItemId === i.id).reduce((a, d) => a + d.quantidadeDistribuida, 0);
                    const restante = i.quantidade - jaDistribuido;
                    const vs = produto ? variantesDoProduto(produto.id) : [];
                    return `
                      <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
                        <div class="form-hint" style="margin-bottom:6px">${esc(produto?.nome || '')} — distribuído ${jaDistribuido}/${i.quantidade} (restam ${restante})</div>
                        <div class="form-row">
                          <select id="distCostureira-${i.id}">
                            <option value="">Costureira</option>
                            ${state.costureiras.filter((c) => c.ativa).map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}
                          </select>
                          <input type="text" id="distQtd-${i.id}" placeholder="Quantidade" inputmode="numeric" />
                        </div>
                        ${vs.length > 0 ? `
                          <select id="distVariante-${i.id}">
                            <option value="">Sem cor específica</option>
                            ${vs.map((v) => `<option value="${v.id}">${esc(v.nome)}</option>`).join('')}
                          </select>
                        ` : ''}
                        <button class="entrada-btn" data-confirmar-distribuicao="${i.id}" data-produto="${i.produtoId}">＋ Adicionar distribuição</button>
                        ${state.distribuicoes.filter((d) => d.ordemItemId === i.id).map((d) => {
                          const cost = state.costureiras.find((c) => c.id === d.costureiraId);
                          const varianteNome = d.varianteId ? state.variantes.find((v) => v.id === d.varianteId)?.nome : null;
                          return `
                            <div class="tx-row" style="margin-top:6px">
                              <div class="tx-dot" style="background:var(--teal)"></div>
                              <div style="flex:1"><div class="tx-categoria">${esc(cost?.nome || '—')}${varianteNome ? ' — ' + esc(varianteNome) : ''}</div><div class="tx-desc">${d.quantidadeDistribuida} peças · ${d.data}</div></div>
                              <button class="trash-btn" data-imprimir-ficha="${d.id}" data-ordem="${o.id}">🖨️</button>
                              <button class="trash-btn" data-remover-distribuicao="${d.id}">🗑</button>
                            </div>
                          `;
                        }).join('')}
                      </div>
                    `;
                  }).join('')}
                  <button class="toggle-btn" data-fechar-distribuicao="1" style="margin-top:8px">Fechar</button>
                </div>
              ` : `<button class="entrada-btn" data-abrir-distribuicao="${o.id}">👥 Distribuir peças pras costureiras</button>`}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}
// ---- Resumo financeiro (custos fixos x variáveis + contas a vencer) ----
function renderResumoFinanceiro(c) {
  const custoTotal = c.custoFixo + c.custoVariavel || 1;
  const pctFixo = Math.round((c.custoFixo / custoTotal) * 100);
  const pctVariavel = 100 - pctFixo;

  return `
    <div class="form-card">
      <div class="section-title" style="margin-bottom:2px">Custos fixos x variáveis</div>
      <div class="section-subtitle" style="margin-bottom:12px">Baseado nos lançamentos do mês selecionado</div>
      ${c.custoFixo + c.custoVariavel === 0 ? `<div class="empty-state">Nenhuma saída lançada neste mês ainda.</div>` : `
        <div class="custo-box">
          <div class="custo-bar"><div class="custo-bar-fill" style="width:${pctFixo}%"></div></div>
          <div class="custo-legend">
            <div class="custo-legend-item"><span class="legend-dot" style="background:var(--pink)"></span>Fixos — ${fmt(c.custoFixo)} (${pctFixo}%)</div>
            <div class="custo-legend-item"><span class="legend-dot" style="background:var(--surface2);border:1px solid var(--border)"></span>Variáveis — ${fmt(c.custoVariavel)} (${pctVariavel}%)</div>
          </div>
        </div>
      `}

      <div class="section-title" style="margin-bottom:2px">Contas a vencer</div>
      <div class="section-subtitle" style="margin-bottom:12px">Próximos 7 dias — ainda não descontadas do saldo</div>
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
    </div>
  `;
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

  // guarda o campo com foco (e a posição do cursor) antes de redesenhar a tela,
  // pra não perder o foco quando algo redesenha enquanto a pessoa está digitando
  const focoAtivo = document.activeElement;
  const focoId = focoAtivo && focoAtivo.id;
  const focoInicio = focoAtivo && typeof focoAtivo.selectionStart === 'number' ? focoAtivo.selectionStart : null;
  const focoFim = focoAtivo && typeof focoAtivo.selectionEnd === 'number' ? focoAtivo.selectionEnd : null;

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
    ${renderTabsBar(c)}
    <div class="content" id="tabContent"></div>
  `;

  const contentEl = document.getElementById('tabContent');
  if (state.tab === 'dashboard') contentEl.innerHTML = renderDashboard(c);
  else if (state.tab === 'financeiro') contentEl.innerHTML = renderFinanceiro(c);
  else if (state.tab === 'estoque') contentEl.innerHTML = renderEstoque(c);
  else if (state.tab === 'tecido') contentEl.innerHTML = renderMateriais(c);
  else if (state.tab === 'corte') contentEl.innerHTML = renderCorte(c);
  else if (state.tab === 'producao') contentEl.innerHTML = renderProducaoDono(c);
  else if (state.tab === 'ficha') contentEl.innerHTML = renderFichaTecnica(c);
  else if (state.tab === 'dre') contentEl.innerHTML = renderDRE(c);

  attachHandlers(c);

  if (focoId) {
    const elParaFocar = document.getElementById(focoId);
    if (elParaFocar) {
      elParaFocar.focus();
      if (focoInicio !== null && elParaFocar.setSelectionRange) {
        try { elParaFocar.setSelectionRange(focoInicio, focoFim); } catch (e) { /* alguns tipos de input não suportam, ignora */ }
      }
    }
  }
}

function tabBtn(id, label, badge) {
  const active = state.tab === id ? 'active' : '';
  const badgeHtml = badge ? `<span class="tab-badge">${badge}</span>` : '';
  return `<button class="tab-btn ${active}" data-tab="${id}">${label}${badgeHtml}</button>`;
}

// ---- Abas: definição, ordem customizável (salva no aparelho) ----
const TABS = {
  dashboard: { label: 'Dashboard' },
  financeiro: { label: 'Financeiro' },
  estoque: { label: 'Estoque' },
  tecido: { label: 'Materiais' },
  corte: { label: 'Corte' },
  producao: { label: 'Produção' },
  ficha: { label: 'Ficha Técnica' },
  dre: { label: 'DRE' },
};
const TAB_ORDER_PADRAO = ['dashboard', 'financeiro', 'estoque', 'tecido', 'corte', 'producao', 'ficha', 'dre'];

function getTabOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('rj_tab_order') || '[]'); } catch (e) { saved = []; }
  const validos = saved.filter((id) => TABS[id]);
  const faltando = TAB_ORDER_PADRAO.filter((id) => !validos.includes(id));
  return [...validos, ...faltando];
}
function saveTabOrder(order) {
  localStorage.setItem('rj_tab_order', JSON.stringify(order));
}

function renderTabsBar(c) {
  const order = getTabOrder();
  const ordensAguardandoCount = state.ordensCorte.filter((o) => o.status === 'aguardando').length;
  const badges = {
    dashboard: c.produtosStatus.filter((p) => p.status !== 'ok').length,
    financeiro: c.contasAVencer.length,
    corte: ordensAguardandoCount,
  };
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="icon-btn-ghost" id="toggleOrganizarAbas">${state.showTabOrderForm ? '✕ Fechar' : '↕️ Organizar abas'}</button>
    </div>
    ${state.showTabOrderForm ? renderOrganizarAbas(order) : ''}
    <div class="tabs-wrap">
      ${order.map((id) => tabBtn(id, TABS[id].label, badges[id])).join('')}
    </div>
  `;
}

function renderOrganizarAbas(order) {
  return `
    <div class="form-card" style="margin-bottom:16px">
      <div class="section-title" style="margin-bottom:2px">Organizar abas</div>
      <div class="section-subtitle" style="margin-bottom:12px">Use as setas pra colocar na ordem que preferir</div>
      ${order.map((id, idx) => `
        <div class="tx-row">
          <div style="flex:1"><div class="tx-categoria">${TABS[id].label}</div></div>
          <button class="step-btn" data-mover-aba="${id}" data-direcao="-1" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="step-btn" data-mover-aba="${id}" data-direcao="1" ${idx === order.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      `).join('')}
    </div>
  `;
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
        <button class="icon-btn-ghost" id="toggleConciliacao">🔄 Conciliação</button>
        <button class="icon-btn-ghost" id="toggleResumoFinanceiro">📊 Resumo</button>
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

    ${state.showConciliacao ? renderConciliacao(c) : ''}

    ${state.showResumoFinanceiro ? renderResumoFinanceiro(c) : ''}

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
// ---- Ficha Técnica (BOM): insumos e produtos componentes de cada produto/kit ----
function capturarLinhasFicha(produtoId, numInsumo, numComponente) {
  const insumoValores = [];
  for (let i = 0; i < numInsumo; i++) {
    insumoValores.push({
      ref: document.getElementById(`ftInsumo-${produtoId}-${i}`)?.value || '',
      qtd: document.getElementById(`ftInsumoQtd-${produtoId}-${i}`)?.value || '',
    });
  }
  const componenteValores = [];
  for (let i = 0; i < numComponente; i++) {
    componenteValores.push({
      ref: document.getElementById(`ftComponente-${produtoId}-${i}`)?.value || '',
      qtd: document.getElementById(`ftComponenteQtd-${produtoId}-${i}`)?.value || '',
    });
  }
  window.__ftInsumoValores = insumoValores;
  window.__ftComponenteValores = componenteValores;
}

function renderFichaTecnica(c) {
  const linhas = state.produtos.map((p) => ({
    produto: p,
    itens: fichaTecnicaDoProduto(p.id),
    custoBase: (p.custoUnitario || 0) + (p.valorMaoObra || 0),
    custoTotal: calcularCustoTotalProduto(p.id),
  })).sort((a, b) => {
    if (a.produto.tipo !== b.produto.tipo) return a.produto.tipo === 'kit' ? -1 : 1;
    return a.produto.nome.localeCompare(b.produto.nome, 'pt-BR');
  });

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Ficha Técnica</div><div class="section-subtitle">Custo completo de cada produto e kit — tecido, corte, mão de obra e insumos</div></div>
      <button class="icon-btn" id="toggleNovoKit">🎁 Criar novo kit</button>
    </div>

    ${state.showNovoKitForm ? `
      <div class="form-card">
        <div class="form-hint">Cria só o essencial pra reconhecer o kit nas vendas — sem precisar passar pelo Estoque. Na sequência você já monta a receita dele (quais produtos + insumos ele leva).</div>
        <input type="text" id="novoKitNome" placeholder="Nome do kit (ex: Kit 2 Tops Joy M)" />
        <input type="text" id="novoKitSku" placeholder="SKU do kit (o mesmo da plataforma)" />
        <div class="form-row">
          <button class="confirm-btn" id="salvarNovoKit">Criar e montar receita</button>
          <button class="toggle-btn" id="cancelarNovoKit">Cancelar</button>
        </div>
      </div>
    ` : ''}

    ${state.produtos.length === 0 ? `<div class="empty-state">Cadastre produtos no Estoque primeiro.</div>` : `
      <div class="produto-list">
        ${linhas.map(({ produto: p, itens, custoBase, custoTotal }) => {
          const editando = state.editingFichaTecnicaId === p.id;

          if (editando) {
            const itensInsumo = itens.filter((i) => i.tipoItem === 'insumo');
            const itensComponente = itens.filter((i) => i.tipoItem === 'produto');
            const numInsumo = window.__ftNumInsumoRows || Math.max(3, itensInsumo.length);
            const numComponente = window.__ftNumComponenteRows || Math.max(2, itensComponente.length);
            const insumoValores = window.__ftInsumoValores || itensInsumo.map((i) => ({ ref: i.insumoId, qtd: String(i.quantidade) }));
            const componenteValores = window.__ftComponenteValores || itensComponente.map((i) => ({ ref: i.componenteProdutoId, qtd: String(i.quantidade) }));

            return `
              <div class="produto-card">
                <div class="produto-header">
                  <div><div class="produto-nome">${esc(p.nome)}${p.tipo === 'kit' ? ' 🎁' : ''}</div></div>
                </div>
                <div class="form-hint">Insumos usados (bojo, etiqueta, embalagem...)</div>
                ${Array.from({ length: numInsumo }, (_, i) => {
                  const atual = insumoValores[i] || { ref: '', qtd: '' };
                  return `
                  <div class="form-row">
                    <select id="ftInsumo-${p.id}-${i}">
                      <option value="">Selecione o insumo</option>
                      ${state.insumos.map((ins) => `<option value="${ins.id}" ${atual.ref === ins.id ? 'selected' : ''}>${esc(ins.nome)}</option>`).join('')}
                    </select>
                    <input type="text" id="ftInsumoQtd-${p.id}-${i}" placeholder="Quantidade" value="${esc(atual.qtd)}" />
                  </div>
                `;
                }).join('')}
                <button class="entrada-btn" type="button" data-mais-insumo-ft="${p.id}">＋ Mais um insumo</button>

                <div class="form-hint" style="margin-top:12px">Produtos componentes (pra kits — ex: 2× Top Joy M)</div>
                ${Array.from({ length: numComponente }, (_, i) => {
                  const atual = componenteValores[i] || { ref: '', qtd: '' };
                  return `
                  <div class="form-row">
                    <select id="ftComponente-${p.id}-${i}">
                      <option value="">Selecione o produto</option>
                      ${state.produtos.filter((prod) => prod.id !== p.id).map((prod) => `<option value="${prod.id}" ${atual.ref === prod.id ? 'selected' : ''}>${esc(prod.nome)}</option>`).join('')}
                    </select>
                    <input type="text" id="ftComponenteQtd-${p.id}-${i}" placeholder="Quantidade" value="${esc(atual.qtd)}" />
                  </div>
                `;
                }).join('')}
                <button class="entrada-btn" type="button" data-mais-componente-ft="${p.id}">＋ Mais um produto componente</button>

                <div class="form-row" style="margin-top:12px">
                  <button class="confirm-btn" data-salvar-ficha="${p.id}" data-num-insumo="${numInsumo}" data-num-componente="${numComponente}">Salvar ficha técnica</button>
                  <button class="toggle-btn" data-cancelar-ficha="1">Cancelar</button>
                </div>
              </div>
            `;
          }

          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(p.nome)}${p.tipo === 'kit' ? ' 🎁 Kit' : ''}</div>
                  ${p.sku ? `<div class="produto-sku">${esc(p.sku)}</div>` : ''}
                </div>
                <button class="trash-btn" data-editar-ficha="${p.id}">✏️</button>
              </div>
              <div class="produto-meta">Custo base (tecido/corte + mão de obra): <strong style="color:var(--text)">${fmt(custoBase)}</strong></div>
              <div class="produto-meta" style="margin-top:4px">Custo total (com insumos): <strong style="color:var(--teal)">${fmt(custoTotal)}</strong></div>
              ${itens.length > 0 ? `
                <div class="prod-breakdown" style="margin-top:8px">
                  ${itens.map((item) => {
                    if (item.tipoItem === 'insumo') {
                      const insumo = state.insumos.find((i) => i.id === item.insumoId);
                      return `<div class="prod-breakdown-item"><span>🧷 ${esc(insumo?.nome || 'Insumo removido')}</span><span>${item.quantidade}×</span></div>`;
                    }
                    const componente = state.produtos.find((prod) => prod.id === item.componenteProdutoId);
                    return `<div class="prod-breakdown-item"><span>📦 ${esc(componente?.nome || 'Produto removido')}</span><span>${item.quantidade}×</span></div>`;
                  }).join('')}
                </div>
              ` : `<div class="form-hint" style="margin-top:6px">Sem ficha técnica cadastrada ainda.</div>`}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

function attachFichaTecnicaHandlers(c) {
  const toggleNovoKit = document.getElementById('toggleNovoKit');
  if (toggleNovoKit) toggleNovoKit.addEventListener('click', () => { state.showNovoKitForm = !state.showNovoKitForm; render(); });

  const cancelarNovoKit = document.getElementById('cancelarNovoKit');
  if (cancelarNovoKit) cancelarNovoKit.addEventListener('click', () => { state.showNovoKitForm = false; render(); });

  const salvarNovoKit = document.getElementById('salvarNovoKit');
  if (salvarNovoKit) salvarNovoKit.addEventListener('click', async () => {
    const nome = document.getElementById('novoKitNome').value.trim();
    const sku = document.getElementById('novoKitSku').value.trim();
    if (!nome) { alert('Informe o nome do kit.'); return; }
    const kitCriado = await addProduto({ nome, sku, estoqueAtual: 0, estoqueMinimo: 0, custoUnitario: 0, valorMaoObra: 0, tipo: 'kit' });
    state.showNovoKitForm = false;
    if (kitCriado) state.editingFichaTecnicaId = kitCriado.id;
    await loadData();
  });

  document.querySelectorAll('[data-editar-ficha]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.editingFichaTecnicaId = btn.dataset.editarFicha;
      window.__ftNumInsumoRows = null;
      window.__ftNumComponenteRows = null;
      window.__ftInsumoValores = null;
      window.__ftComponenteValores = null;
      render();
    });
  });
  document.querySelectorAll('[data-cancelar-ficha]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.editingFichaTecnicaId = null;
      window.__ftNumInsumoRows = null;
      window.__ftNumComponenteRows = null;
      window.__ftInsumoValores = null;
      window.__ftComponenteValores = null;
      render();
    });
  });
  document.querySelectorAll('[data-mais-insumo-ft]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const produtoId = btn.dataset.maisInsumoFt;
      const numInsumoAtual = window.__ftNumInsumoRows || 3;
      const numComponenteAtual = window.__ftNumComponenteRows || 2;
      capturarLinhasFicha(produtoId, numInsumoAtual, numComponenteAtual);
      window.__ftNumInsumoRows = numInsumoAtual + 3;
      render();
    });
  });
  document.querySelectorAll('[data-mais-componente-ft]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const produtoId = btn.dataset.maisComponenteFt;
      const numInsumoAtual = window.__ftNumInsumoRows || 3;
      const numComponenteAtual = window.__ftNumComponenteRows || 2;
      capturarLinhasFicha(produtoId, numInsumoAtual, numComponenteAtual);
      window.__ftNumComponenteRows = numComponenteAtual + 2;
      render();
    });
  });
  document.querySelectorAll('[data-salvar-ficha]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const produtoId = btn.dataset.salvarFicha;
      const numInsumo = Number(btn.dataset.numInsumo);
      const numComponente = Number(btn.dataset.numComponente);
      const itens = [];
      for (let i = 0; i < numInsumo; i++) {
        const insumoId = document.getElementById(`ftInsumo-${produtoId}-${i}`)?.value;
        const qtd = parseBRNumber(document.getElementById(`ftInsumoQtd-${produtoId}-${i}`)?.value || '0');
        if (insumoId && qtd > 0) itens.push({ tipoItem: 'insumo', refId: insumoId, quantidade: qtd });
      }
      for (let i = 0; i < numComponente; i++) {
        const componenteId = document.getElementById(`ftComponente-${produtoId}-${i}`)?.value;
        const qtd = parseBRNumber(document.getElementById(`ftComponenteQtd-${produtoId}-${i}`)?.value || '0');
        if (componenteId && qtd > 0) itens.push({ tipoItem: 'produto', refId: componenteId, quantidade: qtd });
      }
      await salvarFichaTecnica(produtoId, itens);
      state.editingFichaTecnicaId = null;
      window.__ftNumInsumoRows = null;
      window.__ftNumComponenteRows = null;
      window.__ftInsumoValores = null;
      window.__ftComponenteValores = null;
      await loadData();
    });
  });
}

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
  // busca por nome/SKU + ordenação (não altera c.produtosStatus original)
  let listaProdutos = c.produtosStatus;
  const termoBusca = (state.estoqueBusca || '').trim().toLowerCase();
  if (termoBusca) {
    listaProdutos = listaProdutos.filter((p) =>
      p.nome.toLowerCase().includes(termoBusca) || (p.sku && p.sku.toLowerCase().includes(termoBusca))
    );
  }
  if (state.estoqueOrdenar === 'alfabetica') {
    listaProdutos = [...listaProdutos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  } else if (state.estoqueOrdenar === 'mais-vendidos') {
    listaProdutos = [...listaProdutos].sort((a, b) => (b.totalVendido || 0) - (a.totalVendido || 0));
  }

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Estoque</div><div class="section-subtitle">Cadastre seus SKUs pra ativar o semáforo de reposição</div></div>
      <div style="display:flex;gap:8px">
        <button class="icon-btn-ghost" id="toggleProdutosParados">⏸️ Parados${c.produtosParados.length > 0 ? ` (${c.produtosParados.length})` : ''}</button>
        <button class="icon-btn" id="toggleProdutoForm">＋ Produto</button>
      </div>
    </div>

    <div class="form-row" style="margin-bottom:14px">
      <input type="text" id="estoqueBusca" placeholder="🔍 Buscar por nome ou SKU..." value="${esc(state.estoqueBusca || '')}" />
      <select id="estoqueOrdenar">
        <option value="recentes" ${state.estoqueOrdenar === 'recentes' ? 'selected' : ''}>Mais recentes</option>
        <option value="alfabetica" ${state.estoqueOrdenar === 'alfabetica' ? 'selected' : ''}>A – Z</option>
        <option value="mais-vendidos" ${state.estoqueOrdenar === 'mais-vendidos' ? 'selected' : ''}>Mais vendidos</option>
      </select>
    </div>

    ${state.showProdutosParados ? `
      <div class="form-card">
        <div class="section-title" style="margin-bottom:2px">Produtos parados</div>
        <div class="section-subtitle" style="margin-bottom:12px">Sem vender há 30 dias ou mais</div>
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
      </div>
    ` : ''}

    ${state.showProdutoForm ? `
      <div class="form-card">
        <div class="form-row">
          <button class="toggle-btn ${(window.__novoProdutoTipo || 'unitario') === 'unitario' ? 'active-teal' : ''}" data-novo-produto-tipo="unitario">📦 Peça unitária</button>
          <button class="toggle-btn ${window.__novoProdutoTipo === 'kit' ? 'active-pink' : ''}" data-novo-produto-tipo="kit">🎁 Kit</button>
        </div>
        <input type="text" id="pNome" placeholder="Nome do produto" />
        <input type="text" id="pSku" placeholder="SKU (opcional) — vários separados por vírgula" />
        <div class="form-row">
          <input type="text" id="pEstoqueAtual" placeholder="Estoque atual" />
          <input type="text" id="pEstoqueMinimo" placeholder="Estoque mínimo" />
        </div>
        <input type="text" id="pCusto" placeholder="Custo de produção por unidade (ex: 18,50)" />
        <input type="text" id="pMaoObra" placeholder="Valor de mão de obra por peça (ex: 5,00)" />

        <div class="form-hint">🎨 Esse produto tem cores? Cadastre já aqui (opcional). Se preencher, o estoque de cada cor começa zerado — o "Estoque atual" acima é ignorado e você ajusta cor por cor depois de salvar.</div>
        ${Array.from({ length: window.__numCoresNovoProduto || 5 }, (_, i) => `
          <div class="form-row">
            <input type="text" id="pCorNome-${i}" placeholder="Nome da cor" value="${esc(window.__coresNovoProdutoValores?.[i]?.nome || '')}" />
            <input type="text" id="pCorSku-${i}" placeholder="SKU da cor (opcional)" value="${esc(window.__coresNovoProdutoValores?.[i]?.sku || '')}" />
          </div>
        `).join('')}
        <button class="entrada-btn" type="button" id="adicionarLinhaCor">＋ Mais uma cor</button>

        <button class="confirm-btn" id="salvarProduto">Salvar produto</button>
      </div>
    ` : ''}

    ${listaProdutos.length === 0 ? `<div class="empty-state">${termoBusca ? 'Nenhum produto encontrado pra essa busca.' : 'Nenhum produto cadastrado ainda.'}</div>` : `
      <div class="produto-list">
        ${listaProdutos.map((p) => {
          const statusColor = { critico: 'var(--red)', aguarde: 'var(--amber)', 'pode-cortar': 'var(--teal)', ok: 'var(--border)' }[p.status];
          const entradaOpen = state.entradaOpenId === p.id;

          if (state.editingProdutoId === p.id) {
            return `
              <div class="form-card">
                <div class="form-row">
                  <button class="toggle-btn ${(window.__editProdutoTipo || p.tipo || 'unitario') === 'unitario' ? 'active-teal' : ''}" data-edit-produto-tipo="unitario">📦 Peça unitária</button>
                  <button class="toggle-btn ${(window.__editProdutoTipo || p.tipo) === 'kit' ? 'active-pink' : ''}" data-edit-produto-tipo="kit">🎁 Kit</button>
                </div>
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

          const vs = variantesDoProduto(p.id);
          const temVariantes = vs.length > 0;
          const showVarForm = state.showVarianteForm[p.id];

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

              ${temVariantes ? `
                <div class="variantes-box">
                  ${vs.map((v) => `
                    <div class="variante-row">
                      <span class="variante-nome">${esc(v.nome)}</span>
                      <button class="step-btn" data-var-step="-1" data-variante="${v.id}" data-atual="${v.estoqueAtual}">-</button>
                      <span class="variante-qtd">${v.estoqueAtual}</span>
                      <button class="step-btn" data-var-step="1" data-variante="${v.id}" data-atual="${v.estoqueAtual}">+</button>
                      <button class="trash-btn" data-remover-variante="${v.id}">🗑</button>
                    </div>
                  `).join('')}
                  <div class="produto-meta" style="margin-top:6px">Total: ${p.estoqueAtual} un · mín. ${p.estoqueMinimo} · ${fmt(p.custoUnitario)}/un</div>
                </div>
              ` : `
                <div class="produto-stock-row">
                  <button class="step-btn" data-step="-1" data-produto="${p.id}" data-atual="${p.estoqueAtual}">-</button>
                  <div class="stock-value">${p.estoqueAtual} <span class="stock-unit">un</span></div>
                  <button class="step-btn" data-step="1" data-produto="${p.id}" data-atual="${p.estoqueAtual}">+</button>
                  <div class="produto-meta">mín. ${p.estoqueMinimo} · ${fmt(p.custoUnitario)}/un</div>
                </div>
              `}

              ${showVarForm ? `
                <div class="entrada-box">
                  <div class="form-row">
                    <input type="text" id="novaVarNome-${p.id}" placeholder="Nome da cor (ex: Preto)" />
                    <input type="text" id="novaVarSku-${p.id}" placeholder="SKU da cor (opcional)" />
                  </div>
                  <div class="form-row">
                    <button class="confirm-btn" data-confirmar-variante="${p.id}">Adicionar cor</button>
                    <button class="toggle-btn" data-cancelar-variante="${p.id}">Cancelar</button>
                  </div>
                </div>
              ` : `<button class="entrada-btn" data-abrir-variante="${p.id}">🎨 ${temVariantes ? 'Adicionar outra cor' : 'Separar por cor'}</button>`}

              ${p.totalVendido > 0 ? `<div class="produto-vendido">🏷️ ${p.totalVendido} un vendidas no total</div>` : ''}
              ${temVariantes ? `
                <div class="form-hint" style="margin-top:10px">Esse produto tem cores separadas — ajuste o estoque de cada cor acima com os +/-, ou lance produção na aba Produção.</div>
              ` : entradaOpen ? `
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
  const alertList = c.produtosStatus
    .filter((p) => p.status !== 'ok')
    .sort((a, b) => ({ critico: 0, aguarde: 1, 'pode-cortar': 2 }[a.status] - { critico: 0, aguarde: 1, 'pode-cortar': 2 }[b.status]));

  return `
    <input type="month" class="month-input" id="dashboardMonthSelect" value="${state.selectedMonth}" />

    ${c.contasAVencer.length > 0 ? `
      <div class="alerta-vencimento" data-ir-financeiro="1">
        <span>📅 ${c.contasAVencer.length} conta(s) vencendo nos próximos 7 dias — ${fmt(c.contasAVencer.reduce((a, t) => a + t.valor, 0))}</span>
        <span class="alerta-vencimento-link">Ver no Financeiro ›</span>
      </div>
    ` : ''}

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
      <div><div class="section-title">Valor do estoque</div><div class="section-subtitle">Pelo custo, não pelo preço de venda — o quanto está parado</div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,182,39,0.1)">🧵</div>
        <div class="stat-label">Tecido + insumos</div>
        <div class="stat-value">${fmt(c.valorMateriaPrima)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.1)">👕</div>
        <div class="stat-label">Peças prontas</div>
        <div class="stat-value">${fmt(c.valorPecasProntas)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.15)">📦</div>
        <div class="stat-label">Total em estoque</div>
        <div class="stat-value">${fmt(c.valorEstoqueTotal)}</div>
      </div>
    </div>
    ${(c.materiaPrimaDetalhe.length > 0 || c.pecasProntasDetalhe.length > 0) ? `
      <div class="prod-breakdown" style="margin-bottom:24px">
        ${c.materiaPrimaDetalhe.map(([nome, val]) => `<div class="prod-breakdown-item"><span>🧵 ${esc(nome)}</span><span>${fmt(val)}</span></div>`).join('')}
        ${c.pecasProntasDetalhe.map(([nome, val]) => `<div class="prod-breakdown-item"><span>👕 ${esc(nome)}</span><span>${fmt(val)}</span></div>`).join('')}
      </div>
    ` : ''}

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
  const sairBtn = document.getElementById('sairApp');
  if (sairBtn) sairBtn.addEventListener('click', () => {
    if (confirm('Sair e pedir o código de acesso de novo?')) {
      localStorage.removeItem('rj_papel');
      state.papel = null;
      render();
    }
  });

  // organizar abas
  const toggleOrganizar = document.getElementById('toggleOrganizarAbas');
  if (toggleOrganizar) toggleOrganizar.addEventListener('click', () => { state.showTabOrderForm = !state.showTabOrderForm; render(); });

  document.querySelectorAll('[data-mover-aba]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.moverAba;
      const direcao = Number(btn.dataset.direcao);
      const order = getTabOrder();
      const idx = order.indexOf(id);
      const novoIdx = idx + direcao;
      if (novoIdx < 0 || novoIdx >= order.length) return;
      [order[idx], order[novoIdx]] = [order[novoIdx], order[idx]];
      saveTabOrder(order);
      render();
    });
  });

  // tabs
  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      state.tab = el.dataset.tab;
      state.showTabOrderForm = false;
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
      state.showConciliacao = false;
      state.showResumoFinanceiro = false;
      state.showProdutosParados = false;
      state.showCostureiraForm = false;
      state.showProducaoForm = false;
      state.costureiraDetalheId = null;
      state.showValoresPecaForm = false;
      state.showTotalDefeitos = false;
      state.editingProducaoId = null;
      state.showCompraTecidoForm = false;
      state.showOrdemCorteForm = false;
      state.ordemConcluindoId = null;
      state.showCompraInsumoForm = false;
      state.showBaixaInsumoId = null;
      state.distribuindoOrdemId = null;
      state.editingMateriaPrimaId = null;
      state.editingOrdemCorteId = null;
      state.editingFichaTecnicaId = null;
      state.showNovoKitForm = false;
      render();
    });
  });

  if (state.tab === 'dashboard') {
    const dashboardMonthSelect = document.getElementById('dashboardMonthSelect');
    if (dashboardMonthSelect) dashboardMonthSelect.addEventListener('change', (e) => { state.selectedMonth = e.target.value; render(); });

    const alertaVencimento = document.querySelector('[data-ir-financeiro]');
    if (alertaVencimento) alertaVencimento.addEventListener('click', () => {
      state.tab = 'financeiro';
      state.showResumoFinanceiro = true;
      render();
    });
  }
  if (state.tab === 'financeiro') attachFinanceiroHandlers(c);
  if (state.tab === 'estoque') attachEstoqueHandlers(c);
  if (state.tab === 'tecido' || state.tab === 'corte') attachTecidoHandlers(c);
  if (state.tab === 'producao') attachProducaoHandlers(c);
  if (state.tab === 'ficha') attachFichaTecnicaHandlers(c);
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

  const toggleConciliacao = document.getElementById('toggleConciliacao');
  if (toggleConciliacao) toggleConciliacao.addEventListener('click', () => { state.showConciliacao = !state.showConciliacao; render(); });

  const toggleResumoFinanceiro = document.getElementById('toggleResumoFinanceiro');
  if (toggleResumoFinanceiro) toggleResumoFinanceiro.addEventListener('click', () => { state.showResumoFinanceiro = !state.showResumoFinanceiro; render(); });

  document.querySelectorAll('[data-marcar-pago]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.marcarPago;
      const t = state.tx.find((x) => x.id === id);
      if (!t) return;
      await updateTx(id, { tipo: t.tipo, valor: t.valor, categoria: t.categoria, natureza: t.natureza, descricao: t.descricao, data: todayStr(), recorrente: t.recorrente });
      await loadData();
    });
  });

  document.querySelectorAll('[data-conciliar-tx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await marcarTxConciliada(btn.dataset.conciliarTx, true);
      await loadData();
    });
  });

  const repasseInput = document.getElementById('repasseInput');
  if (repasseInput) repasseInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    let rows;
    try {
      rows = isExcel ? await parseXLSX(file) : parseCSV(await file.text());
    } catch (err) {
      alert('Não consegui ler esse arquivo.');
      return;
    }
    const idsDoArquivo = rows.map((row) => guessIdPedidoField(row)).filter(Boolean).map((id) => id.trim().toLowerCase());
    if (!idsDoArquivo.length) {
      alert('Não encontrei uma coluna de "ID do pedido" nesse arquivo. Me manda o nome das colunas que eu ajusto o reconhecimento.');
      return;
    }
    const idsSet = new Set(idsDoArquivo);
    const candidatos = state.tx.filter((t) => t.tipo === 'entrada' && !t.conciliado && t.idPedido && idsSet.has(t.idPedido.trim().toLowerCase()));
    for (const t of candidatos) await marcarTxConciliada(t.id, true);
    await loadData();
    alert(`${candidatos.length} venda(s) confirmada(s) como recebida(s) a partir desse relatório.`);
  });

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
    await loadData();
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
    await loadData();
  });

  document.querySelectorAll('[data-remover-plataforma]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover essa plataforma da lista de taxas?')) {
        await removePlataforma(btn.dataset.removerPlataforma);
        await loadData();
      }
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
    await loadData();
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
      const idPedidoLinha = guessIdPedidoField(row);

      novos.push({
        tipo: 'entrada', valor,
        categoria: plataformaLinha ? `Venda ${plataformaLinha.nome}` : 'Venda marketplace',
        descricao: descricaoItem,
        data: dataLinha,
        idPedido: idPedidoLinha,
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
        // se o SKU vendido tem ficha técnica (ex: um kit), desconta insumos e produtos componentes também
        await baixarEstoquePorFichaTecnica(produtoId, info.qtd, info.ultimaData);
      }
    }

    state.showUpload = false;
    await loadData();

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
    await loadData();
    if (recorrente) { await garantirRecorrentes(); await loadData(); }
    state.showTxForm = false;
    window.__txFormTipo = 'saida';
    render();
  });

  document.querySelectorAll('[data-remove-tx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removeTx(btn.dataset.removeTx);
      await loadData();
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
      await loadData();
      if (recorrente) { await garantirRecorrentes(); await loadData(); }
      state.editingTxId = null;
      window.__editTxTipo = null;
      render();
    });
  });
}

function attachTecidoHandlers(c) {
  const toggleCompra = document.getElementById('toggleCompraTecido');
  if (toggleCompra) toggleCompra.addEventListener('click', () => {
    state.showCompraTecidoForm = !state.showCompraTecidoForm;
    window.__tecidoCorNova = false;
    window.__tecidoCorSelecionada = '';
    window.__tecidoCorNovaTexto = '';
    render();
  });

  const calcularRolosPeso = document.getElementById('calcularRolosPeso');
  if (calcularRolosPeso) calcularRolosPeso.addEventListener('click', () => {
    const pesoTotal = parseBRNumber(document.getElementById('tecidoPesoTotal').value);
    const pesoRolo = parseBRNumber(document.getElementById('tecidoPesoRolo').value) || 19.75;
    if (!pesoTotal || pesoTotal <= 0) { alert('Informe o peso total comprado, em kg.'); return; }
    const rolosEstimados = Math.round(pesoTotal / pesoRolo);
    document.getElementById('tecidoRolos').value = rolosEstimados;
    atualizarPreviewCustoTecido();
  });

  function atualizarPreviewCustoTecido() {
    const preview = document.getElementById('tecidoPreviewCusto');
    if (!preview) return;
    const rolos = Number(document.getElementById('tecidoRolos').value) || 0;
    const valor = parseBRNumber(document.getElementById('tecidoValor').value);
    if (rolos > 0 && valor > 0) {
      preview.style.display = 'block';
      preview.textContent = `💲 Custo por rolo: ${fmt(valor / rolos)}`;
    } else {
      preview.style.display = 'none';
    }
  }
  const tecidoRolosInput = document.getElementById('tecidoRolos');
  const tecidoValorInput = document.getElementById('tecidoValor');
  if (tecidoRolosInput) tecidoRolosInput.addEventListener('input', atualizarPreviewCustoTecido);
  if (tecidoValorInput) tecidoValorInput.addEventListener('input', atualizarPreviewCustoTecido);

  const tecidoCorSelect = document.getElementById('tecidoCorSelect');
  if (tecidoCorSelect) tecidoCorSelect.addEventListener('change', (e) => {
    window.__tecidoCorSelecionada = e.target.value;
    window.__tecidoCorNova = e.target.value === '__nova__';
    render();
  });

  const tecidoCorNovaInput = document.getElementById('tecidoCorNova');
  if (tecidoCorNovaInput) tecidoCorNovaInput.addEventListener('input', (e) => {
    window.__tecidoCorNovaTexto = e.target.value;
  });

  const salvarCompra = document.getElementById('salvarCompraTecido');
  if (salvarCompra) salvarCompra.addEventListener('click', async () => {
    const corSelecionada = document.getElementById('tecidoCorSelect').value;
    const cor = corSelecionada === '__nova__'
      ? document.getElementById('tecidoCorNova').value.trim()
      : corSelecionada.trim();
    const rolos = Number(document.getElementById('tecidoRolos').value);
    const valor = parseBRNumber(document.getElementById('tecidoValor').value);
    const data = document.getElementById('tecidoData').value || todayStr();
    const historico = document.getElementById('tecidoHistorico')?.checked;
    if (!cor || !rolos || rolos <= 0 || !valor) { alert('Selecione ou digite a cor, e preencha quantidade de rolos e valor.'); return; }
    await comprarTecido(cor, rolos, valor, data, !historico);
    window.__tecidoCorNova = false;
    window.__tecidoCorSelecionada = '';
    window.__tecidoCorNovaTexto = '';
    state.showCompraTecidoForm = false;
    await loadData();
  });

  document.querySelectorAll('[data-calcular-rolos-peso-mp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.calcularRolosPesoMp;
      const pesoTotal = parseBRNumber(document.getElementById(`editMpPesoTotal-${id}`).value);
      const pesoRolo = parseBRNumber(document.getElementById(`editMpPesoRolo-${id}`).value) || 19.75;
      if (!pesoTotal || pesoTotal <= 0) { alert('Informe o peso total, em kg.'); return; }
      const rolosEstimados = Math.round(pesoTotal / pesoRolo);
      document.getElementById(`editMpRolos-${id}`).value = rolosEstimados;
    });
  });

  // custo médio por rolo = valor total ÷ quantidade de rolos, recalculado ao digitar
  if (state.editingMateriaPrimaId) {
    const id = state.editingMateriaPrimaId;
    const valorInput = document.getElementById(`editMpValorTotal-${id}`);
    const rolosInput = document.getElementById(`editMpRolos-${id}`);
    const custoInput = document.getElementById(`editMpCusto-${id}`);
    if (valorInput && rolosInput && custoInput) {
      const recalcularCustoMp = () => {
        const valor = parseBRNumber(valorInput.value);
        const rolos = Number(rolosInput.value) || 0;
        if (valor > 0 && rolos > 0) custoInput.value = (valor / rolos).toFixed(2).replace('.', ',');
      };
      valorInput.addEventListener('input', recalcularCustoMp);
      rolosInput.addEventListener('input', recalcularCustoMp);
    }
  }

  document.querySelectorAll('[data-remover-mp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover esse tecido do cadastro de matéria-prima? Cortes já registrados com ele não são afetados.')) {
        await removeMateriaPrima(btn.dataset.removerMp);
        await loadData();
      }
    });
  });

  document.querySelectorAll('[data-editar-mp]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingMateriaPrimaId = btn.dataset.editarMp; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-mp]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingMateriaPrimaId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-mp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditMp;
      const cor = document.getElementById(`editMpCor-${id}`).value.trim();
      const rolos = Number(document.getElementById(`editMpRolos-${id}`).value) || 0;
      const custo = parseBRNumber(document.getElementById(`editMpCusto-${id}`).value);
      if (!cor) { alert('Informe a cor.'); return; }
      await updateMateriaPrima(id, cor, rolos, custo);
      state.editingMateriaPrimaId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-editar-ordem]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingOrdemCorteId = btn.dataset.editarOrdem; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-ordem]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingOrdemCorteId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-ordem]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditOrdem;
      const cor = document.getElementById(`editOrdemCor-${id}`).value.trim();
      const quantidadeRolos = Number(document.getElementById(`editOrdemRolos-${id}`).value) || 0;
      const valorTecido = parseBRNumber(document.getElementById(`editOrdemValorTecido-${id}`).value);
      const valorCorte = parseBRNumber(document.getElementById(`editOrdemValorCorte-${id}`).value);
      const dataEnvio = document.getElementById(`editOrdemData-${id}`).value;
      if (!cor) { alert('Informe a cor.'); return; }
      await updateOrdemCorte(id, { cor, quantidadeRolos, valorTecido, valorCorte, dataEnvio });
      state.editingOrdemCorteId = null;
      await loadData();
    });
  });

  const toggleOrdem = document.getElementById('toggleOrdemCorte');
  if (toggleOrdem) toggleOrdem.addEventListener('click', () => {
    state.showOrdemCorteForm = !state.showOrdemCorteForm;
    window.__ordemTipo = 'principal';
    render();
  });

  const ordemCorSelect = document.getElementById('ordemCor');
  if (ordemCorSelect) ordemCorSelect.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const custo = opt ? Number(opt.dataset.custo || 0) : 0;
    const rolosInput = document.getElementById('ordemRolos');
    const valorInput = document.getElementById('ordemValor');
    const atualizarSugestao = () => {
      const qtd = Number(rolosInput.value) || 0;
      if (qtd > 0 && custo > 0) valorInput.value = (qtd * custo).toFixed(2).replace('.', ',');
    };
    rolosInput.oninput = atualizarSugestao;
    atualizarSugestao();
  });

  document.querySelectorAll('[data-ordem-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__ordemTipo = btn.dataset.ordemTipo; render(); });
  });

  const salvarOrdem = document.getElementById('salvarOrdemCorte');
  if (salvarOrdem) salvarOrdem.addEventListener('click', async () => {
    const tipo = window.__ordemTipo || 'principal';
    const data = document.getElementById('ordemData').value || todayStr();
    const valorCorte = parseBRNumber(document.getElementById('ordemValorCorte')?.value || '0');

    if (tipo === 'principal') {
      const cor = document.getElementById('ordemCor').value;
      const rolos = Number(document.getElementById('ordemRolos').value);
      const valor = parseBRNumber(document.getElementById('ordemValor').value);
      if (!cor || !rolos || rolos <= 0) { alert('Selecione a cor e informe a quantidade de rolos.'); return; }
      const ok = await criarOrdemCorte(cor, rolos, valor, data, 'principal', valorCorte);
      if (ok) { state.showOrdemCorteForm = false; window.__ordemTipo = 'principal'; await loadData(); }
    } else {
      const cor = document.getElementById('ordemCorRetalho').value.trim() || 'Retalhos';
      if (!valorCorte || valorCorte <= 0) { alert('Informe o valor pago pelo corte dos retalhos.'); return; }
      const ok = await criarOrdemCorte(cor, 0, 0, data, 'retalho', valorCorte);
      if (ok) { state.showOrdemCorteForm = false; window.__ordemTipo = 'principal'; await loadData(); }
    }
  });

  document.querySelectorAll('[data-remover-ordem]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover essa ordem de corte?')) {
        await removeOrdemCorte(btn.dataset.removerOrdem);
        await loadData();
      }
    });
  });

  document.querySelectorAll('[data-abrir-conclusao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.ordemConcluindoId = btn.dataset.abrirConclusao; render(); });
  });
  document.querySelectorAll('[data-cancelar-conclusao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.ordemConcluindoId = null; render(); });
  });
  document.querySelectorAll('[data-confirmar-conclusao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ordemId = btn.dataset.confirmarConclusao;
      const itens = [];
      for (let i = 0; i < 5; i++) {
        const produtoId = document.getElementById(`corteItemProduto-${ordemId}-${i}`)?.value;
        const quantidade = Number(document.getElementById(`corteItemQtd-${ordemId}-${i}`)?.value);
        if (produtoId && quantidade > 0) itens.push({ produtoId, quantidade });
      }
      if (!itens.length) { alert('Informe pelo menos um modelo e quantidade de peças.'); return; }
      await concluirOrdemCorte(ordemId, itens);
      state.ordemConcluindoId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-aplicar-custo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const produto = state.produtos.find((p) => p.id === btn.dataset.aplicarCusto);
      if (!produto) return;
      const novoCusto = Number(btn.dataset.custo);
      await updateProduto(produto.id, { nome: produto.nome, sku: produto.sku, estoqueAtual: produto.estoqueAtual, estoqueMinimo: produto.estoqueMinimo, custoUnitario: novoCusto, valorMaoObra: produto.valorMaoObra });
      await loadData();
    });
  });

  const toggleCompraInsumo = document.getElementById('toggleCompraInsumo');
  if (toggleCompraInsumo) toggleCompraInsumo.addEventListener('click', () => { state.showCompraInsumoForm = !state.showCompraInsumoForm; render(); });

  const salvarCompraInsumo = document.getElementById('salvarCompraInsumo');
  if (salvarCompraInsumo) salvarCompraInsumo.addEventListener('click', async () => {
    const nome = document.getElementById('insumoNome').value.trim();
    const quantidade = parseBRNumber(document.getElementById('insumoQuantidade').value);
    const unidade = document.getElementById('insumoUnidade').value;
    const valor = parseBRNumber(document.getElementById('insumoValor').value);
    const categoria = document.getElementById('insumoCategoria').value;
    const data = document.getElementById('insumoData').value || todayStr();
    const historico = document.getElementById('insumoHistorico')?.checked;
    if (!nome || !quantidade || quantidade <= 0 || !valor) { alert('Preencha nome, quantidade e valor.'); return; }
    await comprarInsumo(nome, unidade, quantidade, valor, categoria, data, !historico);
    state.showCompraInsumoForm = false;
    await loadData();
  });

  document.querySelectorAll('[data-abrir-baixa]').forEach((btn) => {
    btn.addEventListener('click', () => { state.showBaixaInsumoId = btn.dataset.abrirBaixa; render(); });
  });
  document.querySelectorAll('[data-confirmar-baixa]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.confirmarBaixa;
      const qtd = parseBRNumber(document.getElementById(`baixaQtd-${id}`).value);
      if (!qtd || qtd <= 0) { alert('Informe a quantidade usada.'); return; }
      await baixarInsumo(id, qtd);
      state.showBaixaInsumoId = null;
      await loadData();
    });
  });
  document.querySelectorAll('[data-remover-insumo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover esse insumo?')) {
        await removeInsumo(btn.dataset.removerInsumo);
        await loadData();
      }
    });
  });

  document.querySelectorAll('[data-abrir-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.distribuindoOrdemId = btn.dataset.abrirDistribuicao; render(); });
  });
  document.querySelectorAll('[data-fechar-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.distribuindoOrdemId = null; render(); });
  });
  document.querySelectorAll('[data-confirmar-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.confirmarDistribuicao;
      const produtoId = btn.dataset.produto;
      const costureiraId = document.getElementById(`distCostureira-${itemId}`).value;
      const quantidade = Number(document.getElementById(`distQtd-${itemId}`).value);
      const varianteSelect = document.getElementById(`distVariante-${itemId}`);
      const varianteId = varianteSelect ? varianteSelect.value : '';
      if (!costureiraId || !quantidade || quantidade <= 0) { alert('Selecione a costureira e informe a quantidade.'); return; }
      await distribuirPecas(itemId, produtoId, varianteId || null, costureiraId, quantidade, todayStr());
      await loadData();
    });
  });

  document.querySelectorAll('[data-imprimir-ficha]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const distribuicao = state.distribuicoes.find((d) => d.id === btn.dataset.imprimirFicha);
      const ordem = state.ordensCorte.find((o) => o.id === btn.dataset.ordem);
      if (distribuicao) gerarFichaCortePDF(distribuicao, ordem);
    });
  });

  document.querySelectorAll('[data-remover-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover essa distribuição?')) {
        await removeDistribuicao(btn.dataset.removerDistribuicao);
        await loadData();
      }
    });
  });
}

function attachProducaoHandlers(c) {
  // ---- Tela de perfil da costureira ----
  if (state.costureiraDetalheId) {
    const voltar = document.getElementById('voltarCostureiras');
    if (voltar) voltar.addEventListener('click', () => { state.costureiraDetalheId = null; state.showProducaoForm = false; state.editingProducaoId = null; state.editandoEmMaosChave = null; render(); });

    document.querySelectorAll('[data-editar-em-maos]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editandoEmMaosChave = btn.dataset.editarEmMaos; render(); });
    });
    document.querySelectorAll('[data-cancelar-em-maos]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editandoEmMaosChave = null; render(); });
    });
    document.querySelectorAll('[data-salvar-em-maos]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const produtoId = btn.dataset.produto;
        const varianteId = btn.dataset.variante || null;
        const costureiraId = btn.dataset.costureira;
        const novoTotal = Number(document.getElementById('editEmMaosQtd').value);
        if (isNaN(novoTotal) || novoTotal < 0) { alert('Informe uma quantidade válida.'); return; }
        await ajustarPecasEmMaos(costureiraId, produtoId, varianteId, novoTotal);
        state.editandoEmMaosChave = null;
        await loadData();
      });
    });

    const toggleDetalheForm = document.getElementById('toggleDetalheForm');
    if (toggleDetalheForm) toggleDetalheForm.addEventListener('click', () => { state.showProducaoForm = !state.showProducaoForm; render(); });

    document.querySelectorAll('[data-prod-detalhe-tipo]').forEach((btn) => {
      btn.addEventListener('click', () => { window.__prodDetalheTipo = btn.dataset.prodDetalheTipo; render(); });
    });

    const detalheProdutoSelect = document.getElementById('detalheProduto');
    if (detalheProdutoSelect) detalheProdutoSelect.addEventListener('change', (e) => { window.__prodFormProdutoId = e.target.value; render(); });

    const salvarDetalhe = document.getElementById('salvarDetalheProducao');
    if (salvarDetalhe) salvarDetalhe.addEventListener('click', async () => {
      const costureiraId = salvarDetalhe.dataset.costureira;
      const produtoId = document.getElementById('detalheProduto').value;
      const varianteSelect = document.getElementById('detalheVariante');
      const varianteId = varianteSelect ? varianteSelect.value : '';
      let quantidade = Number(document.getElementById('detalheQuantidade').value);
      const data = document.getElementById('detalheData').value || todayStr();
      const tipo = window.__prodDetalheTipo || 'producao';
      const jaPago = document.getElementById('detalheJaPago')?.checked;
      if (!produtoId || !quantidade || quantidade <= 0) { alert('Selecione o produto e informe a quantidade.'); return; }
      if (varianteSelect && !varianteId) { alert('Selecione a cor.'); return; }
      if (tipo === 'defeito') quantidade = -quantidade;
      await registrarProducao(costureiraId, produtoId, quantidade, data, varianteId || null, jaPago);
      state.showProducaoForm = false;
      window.__prodDetalheTipo = 'producao';
      window.__prodFormProdutoId = null;
      await loadData();
    });

    document.querySelectorAll('[data-remover-producao]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esse lançamento? Isso também ajusta o estoque de volta.')) {
          await removeProducao(btn.dataset.removerProducao);
          await loadData();
        }
      });
    });

    document.querySelectorAll('[data-prod-filtro-status]').forEach((btn) => {
      btn.addEventListener('click', () => { state.prodFiltroStatus = btn.dataset.prodFiltroStatus; render(); });
    });

    const filtroInicio = document.getElementById('prodFiltroInicio');
    if (filtroInicio) filtroInicio.addEventListener('change', (e) => { state.prodFiltroInicio = e.target.value || null; render(); });
    const filtroFim = document.getElementById('prodFiltroFim');
    if (filtroFim) filtroFim.addEventListener('change', (e) => { state.prodFiltroFim = e.target.value || null; render(); });

    const filtroEstaSemana = document.getElementById('filtroEstaSemana');
    if (filtroEstaSemana) filtroEstaSemana.addEventListener('click', () => {
      state.prodFiltroInicio = inicioDaSemana(todayStr());
      state.prodFiltroFim = todayStr();
      render();
    });
    const filtroLimpar = document.getElementById('filtroLimpar');
    if (filtroLimpar) filtroLimpar.addEventListener('click', () => {
      state.prodFiltroInicio = null;
      state.prodFiltroFim = null;
      render();
    });

    document.querySelectorAll('[data-editar-producao]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.editingProducaoId = btn.dataset.editarProducao;
        window.__editProdTipo = null;
        render();
      });
    });
    document.querySelectorAll('[data-cancelar-edit-producao]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editingProducaoId = null; render(); });
    });
    document.querySelectorAll('[data-edit-prod-tipo]').forEach((btn) => {
      btn.addEventListener('click', () => { window.__editProdTipo = btn.dataset.editProdTipo; render(); });
    });
    document.querySelectorAll('[data-salvar-edit-producao]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.salvarEditProducao;
        const produtoId = document.getElementById(`editProdProduto-${id}`).value;
        let quantidade = Number(document.getElementById(`editProdQuantidade-${id}`).value);
        const data = document.getElementById(`editProdData-${id}`).value || todayStr();
        const tipoEdit = window.__editProdTipo || 'producao';
        if (!produtoId || !quantidade || quantidade <= 0) { alert('Selecione o produto e informe a quantidade.'); return; }
        if (tipoEdit === 'defeito') quantidade = -quantidade;
        await updateProducao(id, { produtoId, quantidade, data });
        state.editingProducaoId = null;
        await loadData();
      });
    });
    return;
  }

  // ---- Tela principal de Produção ----
  const toggleTotalDefeitos = document.getElementById('toggleTotalDefeitos');
  if (toggleTotalDefeitos) toggleTotalDefeitos.addEventListener('click', () => { state.showTotalDefeitos = !state.showTotalDefeitos; render(); });

  const toggleValoresPeca = document.getElementById('toggleValoresPeca');
  if (toggleValoresPeca) toggleValoresPeca.addEventListener('click', () => { state.showValoresPecaForm = !state.showValoresPecaForm; render(); });

  const salvarValoresPeca = document.getElementById('salvarValoresPeca');
  if (salvarValoresPeca) salvarValoresPeca.addEventListener('click', async () => {
    for (const p of state.produtos) {
      const input = document.getElementById(`valorPeca-${p.id}`);
      if (!input) continue;
      const novoValor = parseBRNumber(input.value);
      if (novoValor !== (p.valorMaoObra || 0)) {
        await updateProduto(p.id, { nome: p.nome, sku: p.sku, estoqueAtual: p.estoqueAtual, estoqueMinimo: p.estoqueMinimo, custoUnitario: p.custoUnitario, valorMaoObra: novoValor });
      }
    }
    state.showValoresPecaForm = false;
    await loadData();
  });

  const toggleForm = document.getElementById('toggleCostureiraForm');
  if (toggleForm) toggleForm.addEventListener('click', () => { state.showCostureiraForm = !state.showCostureiraForm; render(); });

  const salvarCostureira = document.getElementById('salvarCostureira');
  if (salvarCostureira) salvarCostureira.addEventListener('click', async () => {
    const nome = document.getElementById('novaCostureiraNome').value.trim();
    if (!nome) { alert('Informe o nome da costureira.'); return; }
    await addCostureira(nome);
    state.showCostureiraForm = false;
    await loadData();
  });

  document.querySelectorAll('[data-abrir-costureira]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-remover-costureira]')) return;
      state.costureiraDetalheId = row.dataset.abrirCostureira;
      render();
    });
  });

  document.querySelectorAll('[data-remover-costureira]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Remover essa costureira? O histórico de produção dela será apagado também.')) {
        await removeCostureira(btn.dataset.removerCostureira);
        await loadData();
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
  const estoqueBuscaInput = document.getElementById('estoqueBusca');
  if (estoqueBuscaInput) estoqueBuscaInput.addEventListener('input', (e) => { state.estoqueBusca = e.target.value; render(); });

  const estoqueOrdenarSelect = document.getElementById('estoqueOrdenar');
  if (estoqueOrdenarSelect) estoqueOrdenarSelect.addEventListener('change', (e) => { state.estoqueOrdenar = e.target.value; render(); });

  const toggleForm = document.getElementById('toggleProdutoForm');
  if (toggleForm) toggleForm.addEventListener('click', () => {
    state.showProdutoForm = !state.showProdutoForm;
    window.__numCoresNovoProduto = 5;
    window.__coresNovoProdutoValores = [];
    window.__novoProdutoTipo = 'unitario';
    render();
  });

  const toggleParados = document.getElementById('toggleProdutosParados');
  if (toggleParados) toggleParados.addEventListener('click', () => { state.showProdutosParados = !state.showProdutosParados; render(); });

  function capturarCoresDigitadas() {
    const valores = [];
    for (let i = 0; i < (window.__numCoresNovoProduto || 5); i++) {
      valores.push({
        nome: document.getElementById(`pCorNome-${i}`)?.value || '',
        sku: document.getElementById(`pCorSku-${i}`)?.value || '',
      });
    }
    return valores;
  }

  const adicionarLinhaCor = document.getElementById('adicionarLinhaCor');
  if (adicionarLinhaCor) adicionarLinhaCor.addEventListener('click', () => {
    window.__coresNovoProdutoValores = capturarCoresDigitadas();
    window.__numCoresNovoProduto = (window.__numCoresNovoProduto || 5) + 5;
    render();
  });

  document.querySelectorAll('[data-novo-produto-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__novoProdutoTipo = btn.dataset.novoProdutoTipo; render(); });
  });

  const salvarProduto = document.getElementById('salvarProduto');
  if (salvarProduto) salvarProduto.addEventListener('click', async () => {
    const nome = document.getElementById('pNome').value.trim();
    const sku = document.getElementById('pSku').value.trim();
    const estoqueAtual = Number(document.getElementById('pEstoqueAtual').value) || 0;
    const estoqueMinimo = Number(document.getElementById('pEstoqueMinimo').value) || 0;
    const custoUnitario = parseBRNumber(document.getElementById('pCusto').value);
    const valorMaoObra = parseBRNumber(document.getElementById('pMaoObra').value);
    const tipo = window.__novoProdutoTipo || 'unitario';
    if (!nome) { alert('Informe o nome do produto.'); return; }

    const cores = [];
    for (let i = 0; i < (window.__numCoresNovoProduto || 5); i++) {
      const corNome = document.getElementById(`pCorNome-${i}`)?.value.trim();
      const corSku = document.getElementById(`pCorSku-${i}`)?.value.trim();
      if (corNome) cores.push({ nome: corNome, sku: corSku });
    }

    const produtoCriado = await addProduto({ nome, sku, estoqueAtual: cores.length ? 0 : estoqueAtual, estoqueMinimo, custoUnitario, valorMaoObra, tipo });
    if (produtoCriado) {
      for (const cor of cores) await addVariante(produtoCriado.id, cor.nome, cor.sku);
    }
    state.showProdutoForm = false;
    window.__numCoresNovoProduto = 5;
    window.__coresNovoProdutoValores = [];
    window.__novoProdutoTipo = 'unitario';
    await loadData();
  });

  document.querySelectorAll('[data-abrir-variante]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.showVarianteForm = { ...state.showVarianteForm, [btn.dataset.abrirVariante]: true };
      render();
    });
  });
  document.querySelectorAll('[data-cancelar-variante]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.showVarianteForm = { ...state.showVarianteForm, [btn.dataset.cancelarVariante]: false };
      render();
    });
  });
  document.querySelectorAll('[data-confirmar-variante]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const produtoId = btn.dataset.confirmarVariante;
      const nome = document.getElementById(`novaVarNome-${produtoId}`).value.trim();
      const sku = document.getElementById(`novaVarSku-${produtoId}`).value.trim();
      if (!nome) { alert('Informe o nome da cor.'); return; }
      await addVariante(produtoId, nome, sku);
      state.showVarianteForm = { ...state.showVarianteForm, [produtoId]: false };
      await loadData();
    });
  });
  document.querySelectorAll('[data-var-step]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const delta = Number(btn.dataset.varStep);
      const atual = Number(btn.dataset.atual);
      await updateVarianteEstoque(btn.dataset.variante, atual + delta);
      await loadData();
    });
  });
  document.querySelectorAll('[data-remover-variante]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover essa cor? O estoque dela some junto.')) {
        await removeVariante(btn.dataset.removerVariante);
        await loadData();
      }
    });
  });

  document.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const delta = Number(btn.dataset.step);
      const atual = Number(btn.dataset.atual);
      const novo = Math.max(0, atual + delta);
      await updateProdutoEstoque(btn.dataset.produto, novo);
      await loadData();
    });
  });

  document.querySelectorAll('[data-remove-produto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover este produto?')) {
        await removeProduto(btn.dataset.removeProduto);
        await loadData();
      }
    });
  });

  document.querySelectorAll('[data-edit-produto]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingProdutoId = btn.dataset.editProduto; window.__editProdutoTipo = null; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-produto]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingProdutoId = null; window.__editProdutoTipo = null; render(); });
  });
  document.querySelectorAll('[data-edit-produto-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__editProdutoTipo = btn.dataset.editProdutoTipo; render(); });
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
      const produtoOriginal = state.produtos.find((p) => p.id === id);
      const tipo = window.__editProdutoTipo || produtoOriginal?.tipo || 'unitario';
      if (!nome) { alert('Informe o nome do produto.'); return; }
      await updateProduto(id, { nome, sku, estoqueAtual, estoqueMinimo, custoUnitario, valorMaoObra, tipo });
      state.editingProdutoId = null;
      window.__editProdutoTipo = null;
      await loadData();
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
      await loadData();
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
