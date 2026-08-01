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

// Sessão de ponto: se ela marcou "lembrar", fica salvo com prazo (localStorage);
// se não marcou, dura só enquanto a aba/navegador ficar aberto (sessionStorage).
function carregarSessaoInicial() {
  const papelSalvo = localStorage.getItem('rj_papel');
  if (papelSalvo === 'ponto') {
    const expiraEm = localStorage.getItem('rj_ponto_expira_em');
    if (expiraEm && Date.now() > Number(expiraEm)) {
      localStorage.removeItem('rj_papel');
      localStorage.removeItem('rj_funcionaria_id');
      localStorage.removeItem('rj_ponto_expira_em');
    } else {
      return { papel: 'ponto', funcionariaId: localStorage.getItem('rj_funcionaria_id') };
    }
  } else if (papelSalvo) {
    return { papel: papelSalvo, funcionariaId: null };
  }
  const papelSessao = sessionStorage.getItem('rj_papel_sessao');
  if (papelSessao === 'ponto') {
    return { papel: 'ponto', funcionariaId: sessionStorage.getItem('rj_funcionaria_id_sessao') };
  }
  return { papel: null, funcionariaId: null };
}
const SESSAO_INICIAL = carregarSessaoInicial();

const CATEGORIAS_SAIDA = {
  'Custos fixos': [
    'Aluguel', 'Funcionários — salário', 'Funcionários — encargos/benefícios',
    'Pró-labore', 'Água', 'Energia', 'Internet/Telefone', 'Contador',
    'Softwares/Assinaturas', 'Manutenção de máquinas', 'Empréstimo — parcela',
  ],
  'Custos variáveis': [
    'Tecido', 'Aviamento', 'Corte e costura (terceirizado)', 'Embalagem',
    'Frete/Logística', 'Taxas de marketplace', 'Ads/Marketing',
    'Impostos sobre venda', 'Etiquetas/Tags', 'Reposição de estoque', 'Mão de obra — produção',
    'Cartão de crédito',
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
// entradas que não são venda (empréstimo, aporte...) — não contam como Receita Bruta no DRE,
// mas continuam contando no saldo de caixa normalmente
const CATEGORIAS_ENTRADA_NAO_OPERACIONAL = ['Empréstimo recebido', 'Reembolso de frete'];

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
// mesma data-base, N meses à frente — usado pra gerar as datas das parcelas
function dataParcela(dataBase, indice) {
  const dia = Number(dataBase.slice(8, 10));
  const mesAlvo = addMonths(monthKey(dataBase), indice);
  const diaFinal = Math.min(dia, daysInMonth(mesAlvo));
  return `${mesAlvo}-${String(diaFinal).padStart(2, '0')}`;
}
// calcula em qual fatura (e quando ela vence) uma compra no cartão cai — se a compra foi
// depois do dia de fechamento, cai na fatura seguinte; parcelaIndex soma mais um ciclo por parcela
function dataVencimentoFatura(dataCompra, cartao, parcelaIndex) {
  const dia = Number(dataCompra.slice(8, 10));
  let mesFechamento = monthKey(dataCompra);
  if (dia > cartao.diaFechamento) mesFechamento = addMonths(mesFechamento, 1);
  let mesVencimento = cartao.diaVencimento < cartao.diaFechamento ? addMonths(mesFechamento, 1) : mesFechamento;
  mesVencimento = addMonths(mesVencimento, parcelaIndex || 0);
  const diaFinal = Math.min(cartao.diaVencimento, daysInMonth(mesVencimento));
  return `${mesVencimento}-${String(diaFinal).padStart(2, '0')}`;
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
// nos campos de estoque editável: "+63" soma ao valor atual, "-10" subtrai,
// e um número puro (ex: "63") substitui o valor direto — pra não precisar somar de cabeça
function calcularNovoValorEstoque(textoDigitado, valorAtual) {
  const texto = (textoDigitado || '').trim();
  if (texto.startsWith('+') || texto.startsWith('-')) {
    const delta = Number(texto);
    if (isNaN(delta)) return valorAtual;
    return Math.max(0, valorAtual + delta);
  }
  const novo = Number(texto);
  return Math.max(0, isNaN(novo) ? valorAtual : novo);
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
  papel: SESSAO_INICIAL.papel,
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
  showContasAVencer: false,
  showProdutosParados: false,
  showSkusPendentes: false,
  showVendaManualForm: false,
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
  editingInsumoId: null,
  editingCostureiraId: null,
  editingOrdemCorteId: null,
  showTabOrderForm: false,
  showTotalDefeitos: false,
  estoqueBusca: '',
  estoqueOrdenar: 'recentes',
  estoqueMostrarForaLinha: false,
  editandoEmMaosChave: null,
  fichaTecnicaItens: [],
  editingFichaTecnicaId: null,
  showNovoKitForm: false,
  fichaTecnicaBusca: '',
  fichaTecnicaFiltro: 'com-ficha',
  insumoPlataformaQtd: [],
  configEnvioInsumoId: null,
  funcionarias: [],
  pontos: [],
  funcionariaLogadaId: SESSAO_INICIAL.funcionariaId,
  showFuncionariaForm: false,
  editingFuncionariaId: null,
  rhFuncionariaDetalheId: null,
  rhFiltroInicio: (() => { try { return localStorage.getItem('rj_rh_filtro_inicio') || null; } catch (e) { return null; } })(),
  rhFiltroFim: (() => { try { return localStorage.getItem('rj_rh_filtro_fim') || null; } catch (e) { return null; } })(),
  editingPontoId: null,
  feriasTiradas: [],
  showFeriasForm: false,
  solicitacoesPonto: [],
  showSolicitarPontoId: null,
  emprestimos: [],
  emprestimoParcelas: [],
  showEmprestimos: false,
  showEmprestimoForm: false,
  cartoesCredito: [],
  showCartoes: false,
  showCartaoForm: false,
  editingCartaoId: null,
  editingEmprestimoValorId: null,
  showCompraCartaoId: null,
  showLancamentosCartaoId: null,
  vendasSkuPendentes: [],
  vendasDetalhe: [],
  abonosPonto: [],
  holerites: [],
  feriados: [],
  showFeriadosForm: false,
  empresaConfig: { cnpj: '', razaoSocial: '', nomeFantasia: '', endereco: '', telefone: '' },
  showEmpresaConfigForm: false,
  holeriteMes: null,
  showLancamentoBanco: false,
  showHistoricoBanco: false,
  showPagarSaldoBanco: false,
  showPreviaHolerite: false,
  showHoleritesLote: false,
  showAbonarId: null,
};

// ==================== DATA LAYER ====================
async function loadData() {
  const [{ data: tx, error: e1 }, { data: produtos, error: e2 }, { data: plataformas, error: e3 }, { data: costureiras, error: e4 }, { data: producoes, error: e5 }, { data: variantes, error: e6 }, { data: materiaPrima, error: e7 }, { data: ordensCorte, error: e8 }, { data: ordensCorteItens, error: e9 }, { data: insumos, error: e10 }, { data: distribuicoes, error: e11 }, { data: fichaTecnicaItens, error: e12 }, { data: insumoPlataformaQtd, error: e13 }, { data: funcionarias, error: e14 }, { data: pontos, error: e15 }, { data: feriasTiradas, error: e16 }, { data: solicitacoesPonto, error: e17 }, { data: horasExtrasLiquidadas, error: e18 }, { data: bancoHorasLancamentos, error: e19 }, { data: emprestimos, error: e20 }, { data: emprestimoParcelas, error: e21 }, { data: cartoesCredito, error: e22 }, { data: vendasSkuPendentes, error: e23 }, { data: vendasDetalhe, error: e24 }, { data: abonosPonto, error: e25 }, { data: holerites, error: e26 }, { data: feriados, error: e27 }, { data: empresaConfig, error: e28 }] = await Promise.all([
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
    sb.from('insumo_plataforma_qtd').select('*'),
    sb.from('funcionarias').select('*').order('nome', { ascending: true }),
    sb.from('pontos').select('*').order('horario', { ascending: false }),
    sb.from('ferias_tiradas').select('*').order('data_inicio', { ascending: false }),
    sb.from('solicitacoes_ponto').select('*').order('created_at', { ascending: false }),
    sb.from('horas_extras_liquidadas').select('*'),
    sb.from('banco_horas_lancamentos').select('*').order('data', { ascending: false }),
    sb.from('emprestimos').select('*').order('data_recebimento', { ascending: false }),
    sb.from('emprestimo_parcelas').select('*').order('numero', { ascending: true }),
    sb.from('cartoes_credito').select('*').order('nome', { ascending: true }),
    sb.from('vendas_sku_pendentes').select('*').order('created_at', { ascending: false }),
    sb.from('vendas_detalhe').select('*').order('data', { ascending: false }).limit(8000),
    sb.from('abonos_ponto').select('*').order('data', { ascending: false }),
    sb.from('holerites').select('*').order('mes', { ascending: false }),
    sb.from('feriados').select('*').order('data', { ascending: true }),
    sb.from('empresa_config').select('*').eq('id', 1).maybeSingle(),
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
  if (e13) console.error(e13);
  if (e14) console.error(e14);
  if (e15) console.error(e15);
  if (e16) console.error(e16);
  if (e17) console.error(e17);
  if (e18) console.error(e18);
  if (e19) console.error(e19);
  if (e20) console.error(e20);
  if (e21) console.error(e21);
  if (e22) console.error(e22);
  if (e23) console.error(e23);
  if (e24) console.error(e24);
  if (e25) console.error(e25);
  if (e26) console.error(e26);
  if (e27) console.error(e27);
  if (e28) console.error(e28);
  state.tx = (tx || []).map(mapTxFromDb);
  state.produtos = (produtos || []).map(mapProdutoFromDb);
  state.plataformas = (plataformas || []).map((p) => ({ id: p.id, nome: p.nome, taxaPercentual: Number(p.taxa_percentual), taxaFixa: Number(p.taxa_fixa || 0) }));
  state.costureiras = (costureiras || []).map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa, metaSemanal: c.meta_semanal || 0 }));
  state.producoes = (producoes || []).map((p) => ({ id: p.id, costureiraId: p.costureira_id, produtoId: p.produto_id, quantidade: p.quantidade, data: p.data, pago: p.pago, varianteId: p.variante_id || null }));
  state.variantes = (variantes || []).map((v) => ({ id: v.id, produtoId: v.produto_id, nome: v.nome, estoqueAtual: v.estoque_atual, skuVariante: v.sku_variante }));
  state.materiaPrima = (materiaPrima || []).map((m) => ({ id: m.id, cor: m.cor, rolosDisponiveis: m.rolos_disponiveis, custoMedioRolo: Number(m.custo_medio_rolo || 0) }));
  state.ordensCorte = (ordensCorte || []).map((o) => ({ id: o.id, cor: o.cor, quantidadeRolos: o.quantidade_rolos, valorTecido: Number(o.valor_tecido), dataEnvio: o.data_envio, status: o.status, dataConclusao: o.data_conclusao, tipo: o.tipo || 'principal', valorCorte: Number(o.valor_corte || 0), transacaoCorteId: o.transacao_corte_id || null }));
  state.ordensCorteItens = (ordensCorteItens || []).map((i) => ({ id: i.id, ordemId: i.ordem_id, produtoId: i.produto_id, quantidade: i.quantidade, varianteId: i.variante_id || null }));
  state.insumos = (insumos || []).map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade, quantidadeDisponivel: Number(i.quantidade_disponivel), custoMedioUnitario: Number(i.custo_medio_unitario), usadoNoEnvio: !!i.usado_no_envio, qtdVendaManual: Number(i.qtd_venda_manual ?? 1) }));
  state.distribuicoes = (distribuicoes || []).map((d) => ({ id: d.id, ordemItemId: d.ordem_item_id, produtoId: d.produto_id, varianteId: d.variante_id || null, costureiraId: d.costureira_id, quantidadeDistribuida: d.quantidade_distribuida, quantidadeDevolvida: d.quantidade_devolvida, data: d.data }));
  state.fichaTecnicaItens = (fichaTecnicaItens || []).map((f) => ({ id: f.id, produtoId: f.produto_id, tipoItem: f.tipo_item, insumoId: f.insumo_id || null, componenteProdutoId: f.componente_produto_id || null, quantidade: Number(f.quantidade), momento: f.momento || 'venda' }));
  state.insumoPlataformaQtd = (insumoPlataformaQtd || []).map((q) => ({ id: q.id, insumoId: q.insumo_id, plataformaId: q.plataforma_id, quantidade: Number(q.quantidade) }));
  state.funcionarias = (funcionarias || []).map((f) => ({ id: f.id, nome: f.nome, pin: f.pin, ativa: f.ativa, jornadaEntrada: (f.jornada_entrada || '08:00').slice(0, 5), jornadaSaidaAlmoco: (f.jornada_saida_almoco || '12:00').slice(0, 5), jornadaVoltaAlmoco: (f.jornada_volta_almoco || '13:00').slice(0, 5), jornadaSaida: (f.jornada_saida || '17:00').slice(0, 5), valorHora: Number(f.valor_hora || 0), dataAdmissao: f.data_admissao || null, jornadaSemanal: f.jornada_semanal || {}, percentualHoraExtra: Number(f.percentual_hora_extra != null ? f.percentual_hora_extra : 50), modoCompensacaoPadrao: f.modo_compensacao_padrao || 'dinheiro', tipoPagamento: f.tipo_pagamento || 'hora', salarioMensal: Number(f.salario_mensal || 0), valorVtDia: Number(f.valor_vt_dia || 0), valorVrDia: Number(f.valor_vr_dia || 0), horasCompensacaoSemanal: Number(f.horas_compensacao_semanal || 0), cpf: f.cpf || '', cargo: f.cargo || '', matricula: f.matricula || '' }));
  state.feriasTiradas = (feriasTiradas || []).map((v) => ({ id: v.id, funcionariaId: v.funcionaria_id, dataInicio: v.data_inicio, dataFim: v.data_fim }));
  state.pontos = (pontos || []).map((p) => ({ id: p.id, funcionariaId: p.funcionaria_id, data: p.data, tipo: p.tipo, horario: p.horario, origem: p.origem || 'propria' }));
  state.solicitacoesPonto = (solicitacoesPonto || []).map((s) => ({ id: s.id, funcionariaId: s.funcionaria_id, data: s.data, tipo: s.tipo, horarioSolicitado: s.horario_solicitado, motivo: s.motivo || '', status: s.status, createdAt: s.created_at }));
  state.horasExtrasLiquidadas = (horasExtrasLiquidadas || []).map((h) => ({ id: h.id, funcionariaId: h.funcionaria_id, data: h.data, horas: Number(h.horas), modo: h.modo, valorPago: h.valor_pago != null ? Number(h.valor_pago) : null }));
  state.bancoHorasLancamentos = (bancoHorasLancamentos || []).map((b) => ({ id: b.id, funcionariaId: b.funcionaria_id, data: b.data, tipo: b.tipo, horas: Number(b.horas), descricao: b.descricao || '' }));
  state.emprestimos = (emprestimos || []).map((e) => ({ id: e.id, descricao: e.descricao, instituicao: e.instituicao || '', valorRecebido: Number(e.valor_recebido), numeroParcelas: e.numero_parcelas, valorParcela: Number(e.valor_parcela), dataRecebimento: e.data_recebimento, dataPrimeiraParcela: e.data_primeira_parcela, transacaoRecebimentoId: e.transacao_recebimento_id || null }));
  state.emprestimoParcelas = (emprestimoParcelas || []).map((p) => ({ id: p.id, emprestimoId: p.emprestimo_id, numero: p.numero, valor: Number(p.valor), dataVencimento: p.data_vencimento, transacaoId: p.transacao_id || null }));
  state.cartoesCredito = (cartoesCredito || []).map((c) => ({ id: c.id, nome: c.nome, limite: Number(c.limite || 0), diaFechamento: c.dia_fechamento, diaVencimento: c.dia_vencimento, ativo: c.ativo !== false }));
  state.vendasSkuPendentes = (vendasSkuPendentes || []).map((v) => ({ id: v.id, sku: v.sku, quantidade: Number(v.quantidade), faturamento: Number(v.faturamento), ultimaData: v.ultima_data, plataformaNome: v.plataforma_nome || null }));
  state.vendasDetalhe = (vendasDetalhe || []).map((v) => ({ id: v.id, produtoId: v.produto_id, plataformaId: v.plataforma_id, plataformaNome: v.plataforma_nome || null, sku: v.sku || null, quantidade: Number(v.quantidade), valor: Number(v.valor), data: v.data }));
  state.abonosPonto = (abonosPonto || []).map((a) => ({ id: a.id, funcionariaId: a.funcionaria_id, data: a.data, tipo: a.tipo, motivo: a.motivo || '', horas: a.horas != null ? Number(a.horas) : null }));
  state.holerites = (holerites || []).map((h) => ({ id: h.id, funcionariaId: h.funcionaria_id, mes: h.mes, diasTrabalhados: Number(h.dias_trabalhados), salarioBase: Number(h.salario_base), horasExtras: Number(h.horas_extras), valorHorasExtras: Number(h.valor_horas_extras), horasExtras100: Number(h.horas_extras_100 || 0), valorHorasExtras100: Number(h.valor_horas_extras_100 || 0), modoHorasExtras: h.modo_horas_extras, horasFaltantes: Number(h.horas_faltantes), valorVt: Number(h.valor_vt), valorVr: Number(h.valor_vr), totalPagar: Number(h.total_pagar), assinadoEm: h.assinado_em || null, assinaturaImagem: h.assinatura_imagem || null, createdAt: h.created_at, numeroRecibo: h.numero_recibo || null, emitidoPor: h.emitido_por || null }));
  state.feriados = (feriados || []).map((f) => ({ id: f.id, data: f.data, nome: f.nome || '' }));
  state.empresaConfig = { cnpj: empresaConfig?.cnpj || '', razaoSocial: empresaConfig?.razao_social || '', nomeFantasia: empresaConfig?.nome_fantasia || '', endereco: empresaConfig?.endereco || '', telefone: empresaConfig?.telefone || '' };
  state.loading = false;
  render();
}

// Antes do login, a tela de gate ainda precisa validar o PIN de ponto contra alguém —
// então busca SÓ a tabela de funcionárias (nada de financeiro/estoque/produção) pra isso
// funcionar sem expor o resto do sistema antes da pessoa se autenticar.
async function loadFuncionariasParaGate() {
  const { data: funcionarias, error } = await sb.from('funcionarias').select('*').order('nome', { ascending: true });
  if (error) console.error(error);
  state.funcionarias = (funcionarias || []).map((f) => ({ id: f.id, nome: f.nome, pin: f.pin, ativa: f.ativa, jornadaEntrada: (f.jornada_entrada || '08:00').slice(0, 5), jornadaSaidaAlmoco: (f.jornada_saida_almoco || '12:00').slice(0, 5), jornadaVoltaAlmoco: (f.jornada_volta_almoco || '13:00').slice(0, 5), jornadaSaida: (f.jornada_saida || '17:00').slice(0, 5), valorHora: Number(f.valor_hora || 0), dataAdmissao: f.data_admissao || null, jornadaSemanal: f.jornada_semanal || {}, percentualHoraExtra: Number(f.percentual_hora_extra != null ? f.percentual_hora_extra : 50), modoCompensacaoPadrao: f.modo_compensacao_padrao || 'dinheiro' }));
  state.loading = false;
  render();
}

function mapTxFromDb(row) {
  return { id: row.id, tipo: row.tipo, valor: Number(row.valor), categoria: row.categoria, natureza: row.natureza, descricao: row.descricao, data: row.data, recorrente: !!row.recorrente, recorrenteOrigemId: row.recorrente_origem_id || null, idPedido: row.id_pedido || null, conciliado: !!row.conciliado, pago: row.pago !== false, cartaoId: row.cartao_id || null };
}
function mapProdutoFromDb(row) {
  return { id: row.id, nome: row.nome, sku: row.sku, estoqueAtual: row.estoque_atual, estoqueMinimo: row.estoque_minimo, custoUnitario: Number(row.custo_unitario), totalVendido: row.total_vendido || 0, ultimaVenda: row.ultima_venda || null, valorMaoObra: Number(row.valor_mao_obra || 0), tipo: row.tipo || 'unitario', precoVendaMedio: Number(row.preco_venda_medio || 0), ativo: row.ativo !== false };
}

async function addTx(tx) {
  const pago = tx.pago !== undefined ? tx.pago : tx.data <= todayStr();
  const { data, error } = await sb.from('transacoes').insert({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, recorrente: !!tx.recorrente, pago, cartao_id: tx.cartaoId || null,
  }).select().single();
  if (error) { alert('Erro ao salvar: ' + error.message); return null; }
  return data;
}
async function marcarTxComoPago(id) {
  const tx = state.tx.find((t) => t.id === id);
  const hoje = todayStr();
  const payload = { pago: true };
  // se a conta ainda não venceu (ex: fatura do cartão) e ela já foi paga adiantada,
  // traz a data pra hoje — senão o saldo só desconta na data de vencimento original,
  // mesmo o dinheiro já tendo saído da conta
  if (tx && tx.tipo === 'saida' && tx.data > hoje) {
    const dataVenc = new Date(tx.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const antecipar = confirm(`Essa conta vence em ${dataVenc}. Você já pagou hoje, antes do vencimento?\n\nSe sim, vou atualizar a data pra hoje pra já descontar do saldo agora.`);
    if (antecipar) payload.data = hoje;
  }
  const { error } = await sb.from('transacoes').update(payload).eq('id', id);
  if (error) alert('Erro ao confirmar pagamento: ' + error.message);
}
async function addTxBatch(rows) {
  const { error } = await sb.from('transacoes').insert(rows.map((tx) => ({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, id_pedido: tx.idPedido || null,
  })));
  if (error) alert('Erro ao importar: ' + error.message);
}
// grava o detalhe de vendas por produto+plataforma+data de cada import — usado pra
// alimentar o ranking de produtos e a comparação entre plataformas na aba Vendas
async function addVendasDetalheBatch(rows) {
  if (!rows.length) return;
  const { error } = await sb.from('vendas_detalhe').insert(rows.map((v) => ({
    produto_id: v.produtoId, plataforma_id: v.plataformaId || null, plataforma_nome: v.plataformaNome || null, sku: v.sku || null, quantidade: v.quantidade, valor: v.valor, data: v.data,
  })));
  if (error) console.error('Erro ao gravar detalhe de vendas: ' + error.message);
}
// cria N saídas parceladas (ex: compra no cartão em 3x) — cada parcela é uma "conta a
// vencer" normal, na data certa; a última parcela absorve a diferença de arredondamento
async function criarSaidasParceladas({ categoria, natureza, descricaoBase, valorTotal, numParcelas, dataPrimeiraParcela }) {
  const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
  let somaParcial = 0;
  for (let i = 0; i < numParcelas; i++) {
    const ultima = i === numParcelas - 1;
    const valor = ultima ? Math.round((valorTotal - somaParcial) * 100) / 100 : valorParcela;
    somaParcial += valor;
    const data = i === 0 ? dataPrimeiraParcela : dataParcela(dataPrimeiraParcela, i);
    await addTx({ tipo: 'saida', valor, categoria, natureza, descricao: `${descricaoBase} (parcela ${i + 1}/${numParcelas})`, data });
  }
}
// mesma coisa, mas as datas seguem o ciclo de fechamento/vencimento do cartão escolhido,
// em vez de "1 mês a partir da compra" — reflete quando o dinheiro sai de verdade
async function criarSaidasCartao({ cartao, categoria, natureza, descricaoBase, valorTotal, numParcelas, dataCompra }) {
  const n = numParcelas || 1;
  const valorParcela = Math.round((valorTotal / n) * 100) / 100;
  let somaParcial = 0;
  for (let i = 0; i < n; i++) {
    const ultima = i === n - 1;
    const valor = ultima ? Math.round((valorTotal - somaParcial) * 100) / 100 : valorParcela;
    somaParcial += valor;
    const data = dataVencimentoFatura(dataCompra, cartao, i);
    const descricao = n > 1 ? `${descricaoBase} (parcela ${i + 1}/${n})` : descricaoBase;
    await addTx({ tipo: 'saida', valor, categoria, natureza, descricao, data, cartaoId: cartao.id });
  }
}
// ---- Cartões de crédito ----
async function addCartao(dados) {
  const { error } = await sb.from('cartoes_credito').insert({
    nome: dados.nome, limite: dados.limite || 0, dia_fechamento: dados.diaFechamento, dia_vencimento: dados.diaVencimento, ativo: true,
  });
  if (error) alert('Erro ao adicionar cartão: ' + error.message);
}
async function updateCartao(id, dados) {
  const { error } = await sb.from('cartoes_credito').update({
    nome: dados.nome, limite: dados.limite || 0, dia_fechamento: dados.diaFechamento, dia_vencimento: dados.diaVencimento, ativo: dados.ativo,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar cartão: ' + error.message);
}
async function removeCartao(id) {
  const { error } = await sb.from('cartoes_credito').delete().eq('id', id);
  if (error) alert('Erro ao remover cartão: ' + error.message);
}
// ---- Empréstimos ----
async function criarEmprestimo({ descricao, instituicao, valorRecebido, dataRecebimento, numeroParcelas, valorParcela, dataPrimeiraParcela }) {
  const txRecebimento = await addTx({
    tipo: 'entrada', valor: valorRecebido, categoria: 'Empréstimo recebido', descricao, data: dataRecebimento,
  });
  const { data: emprestimo, error } = await sb.from('emprestimos').insert({
    descricao, instituicao: instituicao || null, valor_recebido: valorRecebido, numero_parcelas: numeroParcelas,
    valor_parcela: valorParcela, data_recebimento: dataRecebimento, data_primeira_parcela: dataPrimeiraParcela,
    transacao_recebimento_id: txRecebimento ? txRecebimento.id : null,
  }).select().single();
  if (error) { alert('Erro ao criar empréstimo: ' + error.message); return; }

  for (let i = 0; i < numeroParcelas; i++) {
    const dataVenc = i === 0 ? dataPrimeiraParcela : dataParcela(dataPrimeiraParcela, i);
    const tx = await addTx({
      tipo: 'saida', valor: valorParcela, categoria: 'Empréstimo — parcela', natureza: 'fixo',
      descricao: `${descricao} — parcela ${i + 1}/${numeroParcelas}`, data: dataVenc,
    });
    await sb.from('emprestimo_parcelas').insert({
      emprestimo_id: emprestimo.id, numero: i + 1, valor: valorParcela, data_vencimento: dataVenc,
      transacao_id: tx ? tx.id : null,
    });
  }
}
async function removeEmprestimo(id) {
  const parcelas = state.emprestimoParcelas.filter((p) => p.emprestimoId === id);
  const emprestimo = state.emprestimos.find((e) => e.id === id);
  const idsTransacoes = parcelas.map((p) => p.transacaoId).filter(Boolean);
  if (emprestimo?.transacaoRecebimentoId) idsTransacoes.push(emprestimo.transacaoRecebimentoId);
  if (idsTransacoes.length > 0) await sb.from('transacoes').delete().in('id', idsTransacoes);
  const { error } = await sb.from('emprestimos').delete().eq('id', id);
  if (error) alert('Erro ao remover empréstimo: ' + error.message);
}
// corrige o valor recebido (ex: valor contratado x valor realmente liberado pelo banco,
// depois de descontar IOF/tarifas) — atualiza o empréstimo E o lançamento de entrada juntos,
// pra não ficar um número no card e outro no Financeiro
async function updateEmprestimoValorRecebido(id, novoValor, novaData) {
  const emprestimo = state.emprestimos.find((e) => e.id === id);
  if (!emprestimo) return;
  const { error: errEmp } = await sb.from('emprestimos').update({ valor_recebido: novoValor, data_recebimento: novaData }).eq('id', id);
  if (errEmp) { alert('Erro ao atualizar empréstimo: ' + errEmp.message); return; }
  if (emprestimo.transacaoRecebimentoId) {
    const pago = novaData <= todayStr();
    const { error: errTx } = await sb.from('transacoes').update({ valor: novoValor, data: novaData, pago }).eq('id', emprestimo.transacaoRecebimentoId);
    if (errTx) alert('Erro ao atualizar o lançamento vinculado: ' + errTx.message);
  }
}
async function marcarTxConciliada(id, conciliado) {
  const { error } = await sb.from('transacoes').update({ conciliado }).eq('id', id);
  if (error) alert('Erro ao atualizar conciliação: ' + error.message);
}

// ---- Variantes de cor ----
function variantesDoProduto(produtoId) {
  return state.variantes.filter((v) => v.produtoId === produtoId);
}
// último corte PRINCIPAL conhecido desse produto (mesmo antigo) — pra dar de referência de
// custo de tecido sem precisar esperar um corte novo, útil pra quem já tem bastante estoque
// pronto. Cortes de retalho ficam de fora de propósito: o tecido deles já foi pago no corte
// principal, então o custo por peça sai artificialmente baixo e não representa o custo real
function ultimoCorteDoProduto(produtoId) {
  const itensDoProduto = state.ordensCorteItens.filter((i) => i.produtoId === produtoId);
  if (itensDoProduto.length === 0) return null;
  let melhorOrdem = null;
  let existeApenasRetalho = false;
  itensDoProduto.forEach((item) => {
    const ordem = state.ordensCorte.find((o) => o.id === item.ordemId);
    if (!ordem) return;
    if (ordem.tipo === 'retalho') { existeApenasRetalho = true; return; }
    if (!melhorOrdem || ordem.dataEnvio > melhorOrdem.dataEnvio) melhorOrdem = ordem;
  });
  if (!melhorOrdem) return existeApenasRetalho ? { apenasRetalho: true } : null;
  const itensDaOrdem = state.ordensCorteItens.filter((i) => i.ordemId === melhorOrdem.id);
  const totalPecas = itensDaOrdem.reduce((a, i) => a + i.quantidade, 0);
  const custoTotal = melhorOrdem.valorTecido + melhorOrdem.valorCorte;
  return { custoPorPeca: totalPecas > 0 ? custoTotal / totalPecas : 0, data: melhorOrdem.dataEnvio, cor: melhorOrdem.cor };
}
function estoqueEfetivo(produto) {
  const vs = variantesDoProduto(produto.id);
  return vs.length ? vs.reduce((a, v) => a + v.estoqueAtual, 0) : produto.estoqueAtual;
}
async function addVariante(produtoId, nome, skuVariante) {
  const { data, error } = await sb.from('variantes').insert({ produto_id: produtoId, nome, estoque_atual: 0, sku_variante: skuVariante || null }).select().single();
  if (error) { alert('Erro ao adicionar cor: ' + error.message); return null; }
  return data;
}
async function updateVarianteEstoque(id, novoEstoque) {
  const { error } = await sb.from('variantes').update({ estoque_atual: Math.max(0, novoEstoque) }).eq('id', id);
  if (error) alert('Erro ao atualizar estoque da cor: ' + error.message);
}
async function updateVarianteSku(id, sku) {
  const { error } = await sb.from('variantes').update({ sku_variante: sku || null }).eq('id', id);
  if (error) alert('Erro ao atualizar SKU da cor: ' + error.message);
}
async function removeVariante(id) {
  const { error } = await sb.from('variantes').delete().eq('id', id);
  if (error) alert('Erro ao remover cor: ' + error.message);
}

// ---- Matéria-prima (tecido) ----
async function comprarTecido(cor, quantidadeRolos, valorTotal, data, lancarFinanceiro, parcelas, cartao) {
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
    const descricaoBase = `${quantidadeRolos} rolo(s) — ${cor}`;
    if (cartao) {
      await criarSaidasCartao({ cartao, categoria: 'Tecido', natureza: 'variavel', descricaoBase, valorTotal, numParcelas: parcelas || 1, dataCompra: data });
    } else if (parcelas && parcelas > 1) {
      await criarSaidasParceladas({ categoria: 'Tecido', natureza: 'variavel', descricaoBase, valorTotal, numParcelas: parcelas, dataPrimeiraParcela: data });
    } else {
      await addTx({ tipo: 'saida', valor: valorTotal, categoria: 'Tecido', natureza: 'variavel', descricao: descricaoBase, data });
    }
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
async function comprarInsumo(nome, unidade, quantidade, valorTotal, categoria, data, lancarFinanceiro, parcelas, cartao) {
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
    const descricaoBase = `${quantidade} ${unidade} — ${nome}`;
    if (cartao) {
      await criarSaidasCartao({ cartao, categoria, natureza: 'variavel', descricaoBase, valorTotal, numParcelas: parcelas || 1, dataCompra: data });
    } else if (parcelas && parcelas > 1) {
      await criarSaidasParceladas({ categoria, natureza: 'variavel', descricaoBase, valorTotal, numParcelas: parcelas, dataPrimeiraParcela: data });
    } else {
      await addTx({ tipo: 'saida', valor: valorTotal, categoria, natureza: 'variavel', descricao: descricaoBase, data });
    }
  }
}
async function baixarInsumo(id, quantidadeUsada) {
  const insumo = state.insumos.find((i) => i.id === id);
  if (!insumo) return;
  const nova = Math.max(0, insumo.quantidadeDisponivel - quantidadeUsada);
  const { error } = await sb.from('insumos').update({ quantidade_disponivel: nova }).eq('id', id);
  if (error) alert('Erro ao dar baixa: ' + error.message);
}
async function updateInsumo(id, nome, quantidadeDisponivel, custoMedioUnitario) {
  const { error } = await sb.from('insumos').update({ nome, quantidade_disponivel: quantidadeDisponivel, custo_medio_unitario: custoMedioUnitario }).eq('id', id);
  if (error) alert('Erro ao atualizar insumo: ' + error.message);
}
async function toggleInsumoUsadoNoEnvio(id, valor) {
  const { error } = await sb.from('insumos').update({ usado_no_envio: valor }).eq('id', id);
  if (error) alert('Erro ao atualizar insumo: ' + error.message);
}
// quantidade desse insumo usada por pedido nessa plataforma (1 se não houver configuração específica)
function qtdInsumoPorPedido(insumoId, plataformaId) {
  if (!plataformaId) return 1;
  const cfg = state.insumoPlataformaQtd.find((q) => q.insumoId === insumoId && q.plataformaId === plataformaId);
  return cfg ? cfg.quantidade : 1;
}
async function salvarQtdPorPlataforma(insumoId, valoresPorPlataforma) {
  const { error: errDel } = await sb.from('insumo_plataforma_qtd').delete().eq('insumo_id', insumoId);
  if (errDel) { alert('Erro ao salvar configuração: ' + errDel.message); return; }
  const linhas = Object.entries(valoresPorPlataforma)
    .filter(([, qtd]) => qtd && qtd !== 1)
    .map(([plataformaId, qtd]) => ({ insumo_id: insumoId, plataforma_id: plataformaId, quantidade: qtd }));
  if (linhas.length === 0) return;
  const { error: errIns } = await sb.from('insumo_plataforma_qtd').insert(linhas);
  if (errIns) alert('Erro ao salvar configuração: ' + errIns.message);
}
// quantidade desse insumo usada por venda manual (atacado, feira etc) — separado das
// plataformas de marketplace, guardado direto no próprio insumo
async function salvarQtdVendaManual(insumoId, qtd) {
  const { error } = await sb.from('insumos').update({ qtd_venda_manual: qtd || 1 }).eq('id', insumoId);
  if (error) alert('Erro ao salvar configuração: ' + error.message);
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
      doc.text(`Entrega ${i} — Data: _______________ Quantidade: _______________`, margemEsq, y);
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
      doc.text('Quantidade Entregue: _______ Aprovada: _______ Reprovada: _______', margemEsq, y);
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
// ---- Holerite em PDF ----
// aceita tanto a prévia (dados calculados na hora, ainda não fechado) quanto um holerite
// já fechado (com data/hora de assinatura, se a funcionária já confirmou)
function gerarHoleritePDF(funcionaria, mesKey, dados) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('A biblioteca de PDF ainda não carregou. Aguarda alguns segundos e tenta de novo, ou feche e abra o app.');
    return;
  }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margemEsq = 15;
    const largura = 180;
    let y = 18;

    const mesLabelTexto = new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const [anoPdf, mesPdf] = mesKey.split('-').map(Number);
    const diasCorridosMes = new Date(anoPdf, mesPdf, 0).getDate();
    const ocorrencias = calcularResumoOcorrencias(funcionaria.id, mesKey);

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(state.empresaConfig.nomeFantasia || state.empresaConfig.razaoSocial || 'ROSA JULIETA', margemEsq, y);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    if (state.empresaConfig.nomeFantasia && state.empresaConfig.razaoSocial) { doc.text(state.empresaConfig.razaoSocial, margemEsq, y + 5); y += 4; }
    doc.setFontSize(10);
    doc.text('Recibo de Pagamento de Salário', margemEsq, y + 6);
    y += 6;
    if (state.empresaConfig.cnpj) { doc.text(`CNPJ: ${state.empresaConfig.cnpj}`, margemEsq, y + 6); y += 5; }
    if (state.empresaConfig.endereco) { doc.text(state.empresaConfig.endereco, margemEsq, y + 6); y += 5; }
    if (state.empresaConfig.telefone) { doc.text(`Tel: ${state.empresaConfig.telefone}`, margemEsq, y + 6); y += 5; }
    y += 10;

    doc.setDrawColor(200);
    doc.line(margemEsq, y, margemEsq + largura, y);
    y += 8;

    doc.setFontSize(10);
    doc.text(`Funcionária: ${funcionaria.nome}`, margemEsq, y); y += 6;
    if (funcionaria.cargo) { doc.text(`Cargo: ${funcionaria.cargo}`, margemEsq, y); y += 6; }
    if (funcionaria.matricula) { doc.text(`Matrícula: ${funcionaria.matricula}`, margemEsq, y); y += 6; }
    if (funcionaria.cpf) { doc.text(`CPF: ${mascararCpf(funcionaria.cpf)}`, margemEsq, y); y += 6; }
    doc.text(`Referência: ${mesLabelTexto.charAt(0).toUpperCase() + mesLabelTexto.slice(1)} (${diasCorridosMes} dias)`, margemEsq, y); y += 6;
    doc.text(`Dias trabalhados no mês: ${dados.diasTrabalhados}`, margemEsq, y); y += 6;
    if (ocorrencias.diasAtestado + ocorrencias.diasAbono + ocorrencias.diasFerias > 0) {
      const partes = [];
      if (ocorrencias.diasAtestado > 0) partes.push(`${ocorrencias.diasAtestado} atestado(s)`);
      if (ocorrencias.diasAbono > 0) partes.push(`${ocorrencias.diasAbono} abono(s)/folga(s)`);
      if (ocorrencias.diasFerias > 0) partes.push(`${ocorrencias.diasFerias} dia(s) de férias`);
      doc.text(`Ocorrências: ${partes.join(', ')}`, margemEsq, y); y += 6;
    }
    y += 4;

    doc.setFont(undefined, 'bold');
    doc.text('Descrição', margemEsq, y);
    doc.text('Valor', margemEsq + largura - 25, y);
    doc.setFont(undefined, 'normal');
    y += 2;
    doc.line(margemEsq, y, margemEsq + largura, y);
    y += 6;

    const linha = (texto, valor) => {
      doc.text(texto, margemEsq, y);
      doc.text(fmt(valor), margemEsq + largura - 25, y, { align: 'left' });
      y += 6.5;
    };

    linha(funcionaria.tipoPagamento === 'mensal' ? 'Salário mensal' : `Salário (${dados.horasTrabalhadasTotal.toFixed(1)}h trabalhadas)`, dados.salarioBase);
    if (dados.horasExtras > 0) linha(`Horas extras (${formatarHorasMin(dados.horasExtras)} + ${funcionaria.percentualHoraExtra}%)`, dados.modoHorasExtras === 'banco' ? 0 : dados.valorHorasExtras);
    if (dados.horasExtras100 > 0) linha(`Horas domingo/feriado (${formatarHorasMin(dados.horasExtras100)} + 100%)`, dados.modoHorasExtras === 'banco' ? 0 : dados.valorHorasExtras100);
    if (dados.valorVt > 0) linha('Vale-transporte (VT)', dados.valorVt);
    if (dados.valorVr > 0) linha('Vale-refeição/alimentação (VR)', dados.valorVr);

    y += 2;
    doc.line(margemEsq, y, margemEsq + largura, y);
    y += 7;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text('Total líquido', margemEsq, y);
    doc.text(fmt(dados.totalPagar), margemEsq + largura - 25, y);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    y += 12;

    if (dados.horasFaltantes > 0) {
      doc.setTextColor(180, 0, 0);
      doc.text(`Observação: ${formatarHorasMin(dados.horasFaltantes)} de falta não abonada registrada em banco de horas — a compensar.`, margemEsq, y, { maxWidth: largura });
      doc.setTextColor(0);
      y += 12;
    }
    if (dados.modoHorasExtras === 'banco' && (dados.horasExtras > 0 || dados.horasExtras100 > 0)) {
      doc.text('Observação: horas extras desse mês foram creditadas no banco de horas (compensação em folga), não pagas em dinheiro.', margemEsq, y, { maxWidth: largura });
      y += 12;
    }
    if (dados.horasBancoUsadas > 0) {
      doc.text(`Observação: ${formatarHorasMin(dados.horasBancoUsadas)} do saldo do banco de horas (de meses anteriores) foram usadas pra cobrir faltas parciais nesse mês.`, margemEsq, y, { maxWidth: largura });
      y += 12;
    }
    if (dados.horasBancoPagasDinheiro > 0) {
      doc.text(`Observação: ${formatarHorasMin(dados.horasBancoPagasDinheiro)} do banco de horas foram pagas em dinheiro nesse mês (${fmt(dados.valorBancoPagoDinheiro || 0)}), lançamento já feito separadamente.`, margemEsq, y, { maxWidth: largura });
      y += 12;
    }

    const extrato = calcularExtratoBancoHoras(funcionaria.id, mesKey);
    if (extrato.saldoAnterior !== 0 || extrato.produzido !== 0 || extrato.consumido !== 0) {
      doc.setFont(undefined, 'bold');
      doc.text('Extrato do banco de horas', margemEsq, y);
      doc.setFont(undefined, 'normal');
      y += 6;
      doc.text(`Saldo anterior: ${extrato.saldoAnterior >= 0 ? '+' : '-'}${formatarHorasMin(extrato.saldoAnterior)}`, margemEsq, y); y += 5.5;
      doc.text(`Produzido no mês: +${formatarHorasMin(extrato.produzido)}`, margemEsq, y); y += 5.5;
      doc.text(`Consumido no mês: -${formatarHorasMin(extrato.consumido)}`, margemEsq, y); y += 5.5;
      doc.setFont(undefined, 'bold');
      doc.text(`Saldo final: ${extrato.saldoFinal >= 0 ? '+' : '-'}${formatarHorasMin(extrato.saldoFinal)}`, margemEsq, y);
      doc.setFont(undefined, 'normal');
      y += 12;
    }

    y += 10;
    if (dados.assinaturaImagem) {
      try {
        doc.addImage(dados.assinaturaImagem, 'PNG', margemEsq, y - 14, 60, 20);
      } catch (e) { /* se a imagem vier corrompida, só pula e segue pro texto */ }
    }
    doc.line(margemEsq, y, margemEsq + 80, y);
    y += 5;
    if (dados.assinadoEm) {
      doc.setFontSize(9);
      doc.text(`Assinado eletronicamente por ${funcionaria.nome} em ${new Date(dados.assinadoEm).toLocaleString('pt-BR')}`, margemEsq, y, { maxWidth: 80 });
    } else {
      doc.setFontSize(9);
      doc.text('Assinatura da funcionária', margemEsq, y);
    }

    y += 16;
    doc.setFontSize(8);
    doc.setTextColor(120);
    const emitidoPorLabel = { dono: 'Proprietária', supervisora: 'Supervisora' }[dados.emitidoPor] || '';
    const rodapePartes = [];
    if (dados.numeroRecibo) rodapePartes.push(`Recibo nº ${dados.numeroRecibo}`);
    rodapePartes.push(`Emitido em ${new Date(dados.createdAt || Date.now()).toLocaleDateString('pt-BR')}`);
    if (emitidoPorLabel) rodapePartes.push(`por ${emitidoPorLabel}`);
    doc.text(rodapePartes.join(' · '), margemEsq, y);
    doc.setTextColor(0);

    const nomeArquivo = `holerite-${funcionaria.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${mesKey}.pdf`;
    doc.save(nomeArquivo);
  } catch (err) {
    console.error(err);
    alert('Não consegui gerar o PDF: ' + err.message);
  }
}
// ---- Espelho de ponto em PDF (batidas dia a dia do mês, separado do holerite) ----
function gerarEspelhoPontoPDF(funcionaria, mesKey) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('A biblioteca de PDF ainda não carregou. Aguarda alguns segundos e tenta de novo, ou feche e abra o app.');
    return;
  }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margemEsq = 12;
    const alturaPagina = 285;
    let y = 18;

    const [ano, mesNum] = mesKey.split('-').map(Number);
    const ultimoDia = new Date(ano, mesNum, 0).getDate();
    const mesLabelTexto = new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const desenharCabecalho = () => {
      doc.setFontSize(13);
      doc.setFont(undefined, 'bold');
      doc.text(`${state.empresaConfig.razaoSocial || 'ROSA JULIETA'} — Espelho de Ponto`, margemEsq, y);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      y += 7;
      doc.text(`Funcionária: ${funcionaria.nome}`, margemEsq, y);
      doc.text(`Referência: ${mesLabelTexto.charAt(0).toUpperCase() + mesLabelTexto.slice(1)}`, margemEsq + 100, y);
      y += 6;
      doc.setDrawColor(200);
      doc.line(margemEsq, y, margemEsq + 186, y);
      y += 6;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(8.5);
      doc.text('Data', margemEsq, y);
      doc.text('Entrada', margemEsq + 25, y);
      doc.text('Saída Almoço', margemEsq + 55, y);
      doc.text('Volta Almoço', margemEsq + 90, y);
      doc.text('Saída', margemEsq + 125, y);
      doc.text('Total', margemEsq + 150, y);
      doc.text('Diferença', margemEsq + 168, y);
      doc.setFont(undefined, 'normal');
      y += 2;
      doc.line(margemEsq, y, margemEsq + 186, y);
      y += 5;
    };

    desenharCabecalho();

    let totalExtra = 0;
    let totalFalta = 0;
    let diasComBatida = 0;

    for (let dia = 1; dia <= ultimoDia; dia++) {
      const dataStr = `${mesKey}-${String(dia).padStart(2, '0')}`;
      const pontosDoDia = state.pontos.filter((p) => p.funcionariaId === funcionaria.id && p.data === dataStr).sort((a, b) => new Date(a.horario) - new Date(b.horario));
      if (pontosDoDia.length === 0) continue;
      diasComBatida++;
      const porTipo = {};
      pontosDoDia.forEach((p) => { porTipo[p.tipo] = new Date(p.horario); });
      const hora = (d) => d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
      const calc = calcularHorasDia(pontosDoDia, funcionaria, dataStr);
      const abonado = state.abonosPonto.some((a) => a.funcionariaId === funcionaria.id && a.data === dataStr);

      if (y > alturaPagina) { doc.addPage(); y = 18; desenharCabecalho(); }

      doc.setFontSize(8.5);
      doc.text(new Date(dataStr + 'T00:00:00').toLocaleDateString('pt-BR'), margemEsq, y);
      doc.text(hora(porTipo.entrada), margemEsq + 25, y);
      doc.text(hora(porTipo.saida_almoco), margemEsq + 55, y);
      doc.text(hora(porTipo.volta_almoco), margemEsq + 90, y);
      doc.text(hora(porTipo.saida), margemEsq + 125, y);
      doc.text(calc.completo ? `${calc.horasTrabalhadas.toFixed(1)}h` : '—', margemEsq + 150, y);
      if (calc.completo) {
        if (abonado && calc.diferenca < 0) {
          doc.text('abonado', margemEsq + 168, y);
        } else {
          doc.text(`${calc.diferenca >= 0 ? '+' : '-'}${formatarHorasMin(calc.diferenca)}`, margemEsq + 168, y);
          if (calc.diferenca >= 0) totalExtra += calc.diferenca; else totalFalta += Math.abs(calc.diferenca);
        }
      } else {
        doc.text('incompleto', margemEsq + 168, y);
      }
      y += 5.5;
    }

    if (diasComBatida === 0) {
      doc.setFontSize(9);
      doc.text('Nenhuma batida registrada nesse mês.', margemEsq, y);
      y += 8;
    }

    y += 4;
    doc.line(margemEsq, y, margemEsq + 186, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text(`Total de horas extras: +${formatarHorasMin(totalExtra)}`, margemEsq, y);
    y += 6;
    doc.text(`Total de horas faltantes (não abonadas): -${formatarHorasMin(totalFalta)}`, margemEsq, y);
    doc.setFont(undefined, 'normal');

    const nomeArquivo = `espelho-ponto-${funcionaria.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${mesKey}.pdf`;
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
// atualiza o preço médio de venda (ponderado pelo histórico) — só deve ser chamado pro SKU
// que realmente vendeu direto no relatório, nunca pros produtos componentes de um kit
async function atualizarPrecoVendaMedio(produtoId, valorTotalVendas, quantidadeVendida) {
  if (quantidadeVendida <= 0) return;
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (!produto) return;
  const totalVendidoAntes = produto.totalVendido || 0;
  const novoTotalVendido = totalVendidoAntes + quantidadeVendida;
  const precoMedioAntes = produto.precoVendaMedio || 0;
  const novoPrecoMedio = novoTotalVendido > 0
    ? (precoMedioAntes * totalVendidoAntes + valorTotalVendas) / novoTotalVendido
    : precoMedioAntes;
  const { error } = await sb.from('produtos').update({ preco_venda_medio: novoPrecoMedio }).eq('id', produtoId);
  if (error) alert('Erro ao atualizar preço médio de venda: ' + error.message);
}
async function removeProduto(id) {
  const { error } = await sb.from('produtos').delete().eq('id', id);
  if (error) alert('Erro ao remover produto: ' + error.message);
}
// grava (ou soma, se já existir) um SKU que não bateu com nenhum produto no import —
// fica pendente até a Daniela vincular manualmente ao produto certo, em Estoque
async function registrarSkusPendentes(pendentesMap) {
  for (const [sku, info] of pendentesMap.entries()) {
    const existente = state.vendasSkuPendentes.find((v) => v.sku.trim().toLowerCase() === sku.trim().toLowerCase());
    if (existente) {
      const { error } = await sb.from('vendas_sku_pendentes').update({
        quantidade: existente.quantidade + info.qtd,
        faturamento: existente.faturamento + info.faturamento,
        ultima_data: info.ultimaData > existente.ultimaData ? info.ultimaData : existente.ultimaData,
      }).eq('id', existente.id);
      if (error) console.error(error);
    } else {
      const { error } = await sb.from('vendas_sku_pendentes').insert({
        sku, quantidade: info.qtd, faturamento: info.faturamento, ultima_data: info.ultimaData, plataforma_nome: info.plataformaNome || null,
      });
      if (error) console.error(error);
    }
  }
}
// vincula um SKU pendente a um produto (e, opcionalmente, a uma cor específica): salva o
// SKU como apelido do produto ou da cor (pra próximos imports já entrarem automático) e
// aplica a baixa de estoque retroativa acumulada no lugar certo
async function vincularSkuPendente(pendenteId, produtoId, varianteId) {
  const pendente = state.vendasSkuPendentes.find((v) => v.id === pendenteId);
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (!pendente || !produto) return;
  if (varianteId) {
    const variante = state.variantes.find((v) => v.id === varianteId);
    if (variante) {
      const skusAtuaisCor = (variante.skuVariante || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!skusAtuaisCor.some((s) => s.toLowerCase() === pendente.sku.trim().toLowerCase())) {
        skusAtuaisCor.push(pendente.sku.trim());
        await updateVarianteSku(varianteId, skusAtuaisCor.join(', '));
      }
      await updateVarianteEstoque(varianteId, variante.estoqueAtual - pendente.quantidade);
    }
  } else {
    const skusAtuais = (produto.sku || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!skusAtuais.some((s) => s.toLowerCase() === pendente.sku.trim().toLowerCase())) {
      skusAtuais.push(pendente.sku.trim());
      await updateProduto(produtoId, { ...produto, sku: skusAtuais.join(', ') });
    }
  }
  // estoque geral do produto só é mexido quando não tem cor envolvida (produto sem variante)
  const novoEstoque = varianteId ? produto.estoqueAtual : Math.max(0, produto.estoqueAtual - pendente.quantidade);
  const novoTotalVendido = (produto.totalVendido || 0) + pendente.quantidade;
  await registrarVendaProduto(produtoId, novoEstoque, novoTotalVendido, pendente.ultimaData);
  await atualizarPrecoVendaMedio(produtoId, pendente.faturamento, pendente.quantidade);
  await baixarEstoquePorFichaTecnica(produtoId, pendente.quantidade, pendente.ultimaData);
  const { error } = await sb.from('vendas_sku_pendentes').delete().eq('id', pendenteId);
  if (error) alert('Erro ao remover SKU pendente: ' + error.message);
}
async function removerSkuPendente(id) {
  const { error } = await sb.from('vendas_sku_pendentes').delete().eq('id', id);
  if (error) alert('Erro ao remover SKU pendente: ' + error.message);
}
// venda manual (atacado, feira, venda direta etc) — mesma lógica de baixa de estoque
// do import, só que lançada na mão em vez de vir de uma planilha. Se o produto tem cor
// cadastrada, baixa do estoque de cada cor (coresQtd), senão baixa do estoque geral do produto
async function lancarVendaManual({ produtoId, quantidade, valor, frete, canal, data, coresQtd }) {
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (!produto) return;
  const canalLabel = (canal || '').trim() || 'Venda direta';
  const vs = variantesDoProduto(produtoId);
  const qtdTotal = vs.length > 0 ? Object.values(coresQtd || {}).reduce((a, n) => a + n, 0) : quantidade;
  await addTx({
    tipo: 'entrada', valor, categoria: `Venda ${canalLabel}`,
    descricao: `${produto.nome} x${qtdTotal}`, data,
  });
  // frete reembolsado pelo cliente entra separado — passa pelo caixa mas não conta como
  // faturamento de venda (fica de fora do ranking, da comparação e da receita bruta da DRE)
  if (frete > 0) {
    await addTx({
      tipo: 'entrada', valor: frete, categoria: 'Reembolso de frete',
      descricao: `Frete — ${produto.nome} x${qtdTotal}`, data,
    });
  }
  if (vs.length > 0) {
    for (const v of vs) {
      const qtdCor = coresQtd?.[v.id] || 0;
      if (qtdCor > 0) await updateVarianteEstoque(v.id, v.estoqueAtual - qtdCor);
    }
    const novoTotalVendido = (produto.totalVendido || 0) + qtdTotal;
    await registrarVendaProduto(produtoId, produto.estoqueAtual, novoTotalVendido, data);
  } else {
    const novoEstoque = Math.max(0, produto.estoqueAtual - qtdTotal);
    const novoTotalVendido = (produto.totalVendido || 0) + qtdTotal;
    await registrarVendaProduto(produtoId, novoEstoque, novoTotalVendido, data);
  }
  await atualizarPrecoVendaMedio(produtoId, valor, qtdTotal);
  await baixarEstoquePorFichaTecnica(produtoId, qtdTotal, data);
  // insumos usados por pedido (envelope, etiqueta de rastreio) — cada venda manual lançada
  // conta como 1 pedido enviado, respeitando a quantidade configurada pra "Venda manual"
  const insumosEnvio = state.insumos.filter((i) => i.usadoNoEnvio);
  for (const insumo of insumosEnvio) {
    await baixarInsumo(insumo.id, insumo.qtdVendaManual);
  }
  await addVendasDetalheBatch([{
    produtoId, plataformaId: null, plataformaNome: canalLabel,
    sku: (produto.sku || '').split(',')[0]?.trim() || null, quantidade: qtdTotal, valor, data,
  }]);
}
async function updateProduto(id, p) {
  const { error } = await sb.from('produtos').update({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, valor_mao_obra: p.valorMaoObra || 0, tipo: p.tipo || 'unitario',
  }).eq('id', id);
  if (error) alert('Erro ao atualizar produto: ' + error.message);
}
async function toggleProdutoAtivo(id, ativo) {
  const { error } = await sb.from('produtos').update({ ativo }).eq('id', id);
  if (error) alert('Erro ao atualizar status do produto: ' + error.message);
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
    momento: item.tipoItem === 'insumo' ? (item.momento || 'venda') : 'venda',
  })));
  if (errIns) alert('Erro ao salvar ficha técnica: ' + errIns.message);
}
async function excluirFichaTecnica(produtoId) {
  const { error } = await sb.from('ficha_tecnica_itens').delete().eq('produto_id', produtoId);
  if (error) alert('Erro ao excluir ficha técnica: ' + error.message);
}
// desconta do estoque os insumos (momento = venda) e produtos-componentes da ficha técnica, proporcional à quantidade vendida
async function baixarEstoquePorFichaTecnica(produtoId, quantidadeVendida, dataVenda, visitados) {
  visitados = visitados || new Set();
  if (visitados.has(produtoId)) return;
  visitados.add(produtoId);
  for (const item of fichaTecnicaDoProduto(produtoId)) {
    const qtdConsumida = item.quantidade * quantidadeVendida;
    if (item.tipoItem === 'insumo') {
      if (item.momento !== 'venda') continue; // insumos de "produção" já foram baixados quando a peça foi entregue
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
// desconta insumos marcados como "momento = produção" (ex: etiqueta) toda vez que uma peça é entregue pronta
async function baixarInsumosProducao(produtoId, quantidadeProduzida, data) {
  for (const item of fichaTecnicaDoProduto(produtoId)) {
    if (item.tipoItem !== 'insumo' || item.momento !== 'producao') continue;
    const insumo = state.insumos.find((i) => i.id === item.insumoId);
    if (insumo) await baixarInsumo(insumo.id, item.quantidade * quantidadeProduzida);
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

// ---- RH: funcionárias e ponto eletrônico ----
async function addFuncionaria(dados) {
  const { error } = await sb.from('funcionarias').insert({
    nome: dados.nome, pin: dados.pin, ativa: true,
    jornada_entrada: dados.jornadaEntrada, jornada_saida_almoco: dados.jornadaSaidaAlmoco,
    jornada_volta_almoco: dados.jornadaVoltaAlmoco, jornada_saida: dados.jornadaSaida,
    valor_hora: dados.valorHora || 0, data_admissao: dados.dataAdmissao || null,
    jornada_semanal: dados.jornadaSemanal || {},
  });
  if (error) alert('Erro ao adicionar funcionária: ' + error.message);
}
async function updateFuncionaria(id, dados) {
  const { error } = await sb.from('funcionarias').update({
    nome: dados.nome, pin: dados.pin, ativa: dados.ativa,
    jornada_entrada: dados.jornadaEntrada, jornada_saida_almoco: dados.jornadaSaidaAlmoco,
    jornada_volta_almoco: dados.jornadaVoltaAlmoco, jornada_saida: dados.jornadaSaida,
    valor_hora: dados.valorHora || 0, data_admissao: dados.dataAdmissao || null,
    jornada_semanal: dados.jornadaSemanal || {},
    tipo_pagamento: dados.tipoPagamento || 'hora', salario_mensal: dados.salarioMensal || 0,
    percentual_hora_extra: dados.percentualHoraExtra != null ? dados.percentualHoraExtra : 50,
    modo_compensacao_padrao: dados.modoCompensacaoPadrao || 'dinheiro',
    valor_vt_dia: dados.valorVtDia || 0, valor_vr_dia: dados.valorVrDia || 0,
    horas_compensacao_semanal: dados.horasCompensacaoSemanal || 0,
    cpf: dados.cpf || null, cargo: dados.cargo || null, matricula: dados.matricula || null,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar funcionária: ' + error.message);
}
async function removeFuncionaria(id) {
  const { error } = await sb.from('funcionarias').delete().eq('id', id);
  if (error) alert('Erro ao remover funcionária: ' + error.message);
}
async function registrarPonto(funcionariaId, tipo) {
  const agora = new Date();
  const { error } = await sb.from('pontos').insert({
    funcionaria_id: funcionariaId, data: todayStr(), tipo, horario: agora.toISOString(), origem: 'propria',
  });
  if (error) alert('Erro ao bater ponto: ' + error.message);
}
async function updatePonto(id, horarioISO) {
  const { error } = await sb.from('pontos').update({ horario: horarioISO, origem: 'manual' }).eq('id', id);
  if (error) alert('Erro ao corrigir ponto: ' + error.message);
}
async function removePonto(id) {
  const { error } = await sb.from('pontos').delete().eq('id', id);
  if (error) alert('Erro ao remover ponto: ' + error.message);
}
// abona um dia inteiro (atestado médico, folga, ou abono simples) — o dia deixa de contar
// como falta no cálculo de horas, mesmo sem batida de ponto naquele dia
// abona um dia (inteiro, se horasParciais for null) ou só uma quantidade parcial de horas
// (ex: ela usou só 30min do saldo naquele dia, o resto continua contando como falta real).
// Quando tem horas parciais, debita automaticamente do banco de horas — é o que realmente
// está acontecendo: ela está gastando o saldo que tinha guardado.
async function salvarAbono(funcionariaId, data, tipo, motivo, horasParciais) {
  const { error } = await sb.from('abonos_ponto').upsert(
    { funcionaria_id: funcionariaId, data, tipo, motivo: motivo || null, horas: horasParciais || null },
    { onConflict: 'funcionaria_id,data' }
  );
  if (error) { alert('Erro ao salvar abono: ' + error.message); return; }
  if (horasParciais > 0) {
    const dataFmt = new Date(data + 'T00:00:00').toLocaleDateString('pt-BR');
    const { error: errBanco } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionariaId, data: todayStr(), tipo: 'debito', horas: -horasParciais,
      descricao: `${formatarHorasMin(horasParciais)} usadas do saldo em ${dataFmt}${motivo ? ' — ' + motivo : ''}`,
    });
    if (errBanco) console.error(errBanco);
  }
}
async function removeAbono(id) {
  const { error } = await sb.from('abonos_ponto').delete().eq('id', id);
  if (error) alert('Erro ao remover abono: ' + error.message);
}
// fecha o holerite de um mês: grava o registro congelado, lança a saída no Financeiro
// (se as horas extras forem pagas em dinheiro), e movimenta o banco de horas (crédito se
// escolheu banco pras extras, débito sempre que tem falta não abonada)
async function fecharHolerite(funcionaria, mesKey, resumo, modoHorasExtras, valorVtFinal, valorVrFinal) {
  const totalPagar = resumo.salarioBase
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras : 0)
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras100 : 0)
    + valorVtFinal + valorVrFinal;
  const { error: errHolerite } = await sb.from('holerites').upsert({
    funcionaria_id: funcionaria.id, mes: mesKey, dias_trabalhados: resumo.diasTrabalhados,
    salario_base: resumo.salarioBase, horas_extras: resumo.horasExtras, valor_horas_extras: resumo.valorHorasExtras,
    horas_extras_100: resumo.horasExtras100, valor_horas_extras_100: resumo.valorHorasExtras100,
    modo_horas_extras: modoHorasExtras, horas_faltantes: resumo.horasFaltantes,
    valor_vt: valorVtFinal, valor_vr: valorVrFinal, total_pagar: totalPagar,
    emitido_por: state.papel,
  }, { onConflict: 'funcionaria_id,mes' });
  if (errHolerite) { alert('Erro ao fechar holerite: ' + errHolerite.message); return; }

  const mesLabelTexto = new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const valorSalarioEExtras = resumo.salarioBase
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras : 0)
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras100 : 0);
  const valorBeneficios = valorVtFinal + valorVrFinal;
  if (valorSalarioEExtras > 0) {
    await addTx({
      tipo: 'saida', valor: valorSalarioEExtras, categoria: 'Funcionários — salário', natureza: 'fixo',
      descricao: `Holerite ${funcionaria.nome} — ${mesLabelTexto}`, data: todayStr(),
    });
  }
  if (valorBeneficios > 0) {
    await addTx({
      tipo: 'saida', valor: valorBeneficios, categoria: 'Funcionários — encargos/benefícios', natureza: 'fixo',
      descricao: `VT + VR ${funcionaria.nome} — ${mesLabelTexto}`, data: todayStr(),
    });
  }

  if (modoHorasExtras === 'banco' && resumo.horasExtras > 0) {
    const { error } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionaria.id, data: todayStr(), tipo: 'credito', horas: resumo.horasExtras,
      descricao: `Horas extras de ${mesLabelTexto} convertidas em banco de horas`,
    });
    if (error) console.error(error);
  }
  if (modoHorasExtras === 'banco' && resumo.horasExtras100 > 0) {
    // domingo/feriado credita em dobro no banco de horas (1h trabalhada = 2h de folga depois)
    const { error } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionaria.id, data: todayStr(), tipo: 'credito', horas: resumo.horasExtras100 * 2,
      descricao: `Horas de domingo/feriado de ${mesLabelTexto} convertidas em banco de horas (em dobro)`,
    });
    if (error) console.error(error);
  }
  if (resumo.horasFaltantes > 0) {
    const { error } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionaria.id, data: todayStr(), tipo: 'debito', horas: -resumo.horasFaltantes,
      descricao: `Faltas não abonadas de ${mesLabelTexto} — a compensar trabalhando`,
    });
    if (error) console.error(error);
  }
}
// gerencia a lista de feriados (nacionais + municipais, ela cadastra do jeito que precisar)
async function addFeriado(data, nome) {
  const { error } = await sb.from('feriados').upsert({ data, nome: nome || null }, { onConflict: 'data' });
  if (error) alert('Erro ao adicionar feriado: ' + error.message);
}
async function removeFeriado(id) {
  const { error } = await sb.from('feriados').delete().eq('id', id);
  if (error) alert('Erro ao remover feriado: ' + error.message);
}
async function salvarEmpresaConfig(dados) {
  const { error } = await sb.from('empresa_config').upsert({
    id: 1, cnpj: dados.cnpj || null, razao_social: dados.razaoSocial || null,
    nome_fantasia: dados.nomeFantasia || null, endereco: dados.endereco || null, telefone: dados.telefone || null,
  });
  if (error) alert('Erro ao salvar dados da empresa: ' + error.message);
}
// a funcionária confirma (assina eletronicamente, desenhando o nome na tela) o holerite
// dela, pelo próprio celular — fica registrado com data/hora + a imagem da assinatura
async function confirmarAssinaturaHolerite(id, imagemBase64) {
  const { error } = await sb.from('holerites').update({ assinado_em: new Date().toISOString(), assinatura_imagem: imagemBase64 || null }).eq('id', id);
  if (error) alert('Erro ao confirmar: ' + error.message);
}
async function addFeriasTirada(funcionariaId, dataInicio, dataFim) {
  const { error } = await sb.from('ferias_tiradas').insert({ funcionaria_id: funcionariaId, data_inicio: dataInicio, data_fim: dataFim });
  if (error) alert('Erro ao registrar férias: ' + error.message);
}
async function removeFeriasTirada(id) {
  const { error } = await sb.from('ferias_tiradas').delete().eq('id', id);
  if (error) alert('Erro ao remover registro de férias: ' + error.message);
}
// calcula o ciclo de férias (CLT: 12 meses pra adquirir direito + 12 meses de prazo pra conceder).
// o ciclo reinicia a partir do dia seguinte ao fim da última férias tirada (se houver).
function calcularStatusFerias(funcionaria) {
  if (!funcionaria.dataAdmissao) return null;
  const feriasDaFuncionaria = state.feriasTiradas
    .filter((v) => v.funcionariaId === funcionaria.id)
    .sort((a, b) => b.dataFim.localeCompare(a.dataFim));
  const ultimaFerias = feriasDaFuncionaria[0];

  let inicioCiclo;
  if (ultimaFerias) {
    inicioCiclo = new Date(ultimaFerias.dataFim + 'T00:00:00');
    inicioCiclo.setDate(inicioCiclo.getDate() + 1);
  } else {
    inicioCiclo = new Date(funcionaria.dataAdmissao + 'T00:00:00');
  }

  const fimPeriodoAquisitivo = new Date(inicioCiclo);
  fimPeriodoAquisitivo.setFullYear(fimPeriodoAquisitivo.getFullYear() + 1);
  const prazoLimite = new Date(fimPeriodoAquisitivo);
  prazoLimite.setFullYear(prazoLimite.getFullYear() + 1);

  const hoje = new Date(todayStr() + 'T00:00:00');
  const diasParaPrazoLimite = Math.round((prazoLimite - hoje) / 86400000);
  const diasParaAdquirirDireito = Math.round((fimPeriodoAquisitivo - hoje) / 86400000);

  let status;
  if (diasParaAdquirirDireito > 0) status = 'aquisitivo';
  else if (diasParaPrazoLimite <= 0) status = 'vencidas';
  else if (diasParaPrazoLimite <= 60) status = 'vencendo';
  else status = 'em-dia';

  return { inicioCiclo, fimPeriodoAquisitivo, prazoLimite, diasParaPrazoLimite, diasParaAdquirirDireito, status };
}
const FERIAS_STATUS_LABEL = {
  'aquisitivo': { label: '🔵 Adquirindo direito', color: 'var(--text-muted)' },
  'em-dia': { label: '🟢 Em dia', color: 'var(--teal)' },
  'vencendo': { label: '🟡 Vencendo em breve', color: 'var(--amber)' },
  'vencidas': { label: '🔴 Vencidas', color: 'var(--red)' },
};
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
function renderLinhaJornadaDia(prefixo, dia, cfgExistente, jornadaPadrao) {
  const trabalha = cfgExistente ? !!cfgExistente.trabalha : (dia >= 1 && dia <= 5);
  const entrada = cfgExistente?.entrada || jornadaPadrao.entrada;
  const saidaAlmoco = cfgExistente?.saidaAlmoco || jornadaPadrao.saidaAlmoco;
  const voltaAlmoco = cfgExistente?.voltaAlmoco || jornadaPadrao.voltaAlmoco;
  const saida = cfgExistente?.saida || jornadaPadrao.saida;
  const idHorarios = `${prefixo}Horarios-${dia}`;
  return `
    <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px">
      <label class="checkbox-label">
        <input type="checkbox" id="${prefixo}Trabalha-${dia}" ${trabalha ? 'checked' : ''} data-toggle-dia-horario="${idHorarios}" />
        ${DIAS_SEMANA[dia]}
      </label>
      <div id="${idHorarios}" style="${trabalha ? '' : 'display:none'}">
        <div class="form-row" style="margin-top:6px">
          <input type="time" id="${prefixo}Entrada-${dia}" value="${entrada}" />
          <input type="time" id="${prefixo}SaidaAlmoco-${dia}" value="${saidaAlmoco}" />
        </div>
        <div class="form-row" style="margin-top:6px">
          <input type="time" id="${prefixo}VoltaAlmoco-${dia}" value="${voltaAlmoco}" />
          <input type="time" id="${prefixo}Saida-${dia}" value="${saida}" />
        </div>
      </div>
    </div>
  `;
}
function renderEditorJornadaSemanal(prefixo, jornadaSemanalAtual, jornadaPadrao) {
  return `
    <div id="${prefixo}JornadaEditor">
      ${[1, 2, 3, 4, 5, 6, 0].map((dia) => renderLinhaJornadaDia(prefixo, dia, (jornadaSemanalAtual || {})[dia], jornadaPadrao)).join('')}
      <div class="form-card" style="margin-top:10px;text-align:center;background:var(--bg)">
        <div class="form-hint" style="margin-bottom:2px">Total semanal configurado</div>
        <div id="${prefixo}TotalSemana" style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700">—</div>
        <div class="form-hint" style="margin-top:2px;margin-bottom:0">Compare com o combinado (ex: 44h/semana)</div>
      </div>
    </div>
  `;
}
function atualizarTotalSemanal(prefixo) {
  let totalMinutos = 0;
  [0, 1, 2, 3, 4, 5, 6].forEach((dia) => {
    const trabalha = document.getElementById(`${prefixo}Trabalha-${dia}`)?.checked;
    if (!trabalha) return;
    const entrada = document.getElementById(`${prefixo}Entrada-${dia}`)?.value;
    const saidaAlmoco = document.getElementById(`${prefixo}SaidaAlmoco-${dia}`)?.value;
    const voltaAlmoco = document.getElementById(`${prefixo}VoltaAlmoco-${dia}`)?.value;
    const saida = document.getElementById(`${prefixo}Saida-${dia}`)?.value;
    if (!entrada || !saidaAlmoco || !voltaAlmoco || !saida) return;
    const [hE, mE] = entrada.split(':').map(Number);
    const [hSA, mSA] = saidaAlmoco.split(':').map(Number);
    const [hVA, mVA] = voltaAlmoco.split(':').map(Number);
    const [hS, mS] = saida.split(':').map(Number);
    totalMinutos += ((hSA * 60 + mSA) - (hE * 60 + mE)) + ((hS * 60 + mS) - (hVA * 60 + mVA));
  });
  const el = document.getElementById(`${prefixo}TotalSemana`);
  if (el) {
    const horas = totalMinutos / 60;
    el.textContent = `${horas.toFixed(1)}h / semana`;
    el.style.color = horas > 44 ? 'var(--amber)' : 'var(--teal)';
  }
}
function coletarJornadaSemanal(prefixo) {
  const resultado = {};
  [0, 1, 2, 3, 4, 5, 6].forEach((dia) => {
    const trabalha = document.getElementById(`${prefixo}Trabalha-${dia}`)?.checked;
    if (trabalha) {
      resultado[dia] = {
        trabalha: true,
        entrada: document.getElementById(`${prefixo}Entrada-${dia}`).value,
        saidaAlmoco: document.getElementById(`${prefixo}SaidaAlmoco-${dia}`).value,
        voltaAlmoco: document.getElementById(`${prefixo}VoltaAlmoco-${dia}`).value,
        saida: document.getElementById(`${prefixo}Saida-${dia}`).value,
      };
    } else {
      resultado[dia] = { trabalha: false };
    }
  });
  return resultado;
}

// pega a jornada esperada pra um dia específico (0=domingo...6=sábado), olhando primeiro
// a configuração por dia da semana; se não tiver, cai no padrão antigo (seg-sex fixo, sem sáb/dom)
// formata uma diferença de horas decimal em texto tipo "13min", "1h20min" — mais legível
// que hora fracionada (0.2h) pra diferenças de ponto
// mascara o CPF pra exibir em documentos (só os 3 primeiros e 2 últimos dígitos aparecem)
function mascararCpf(cpf) {
  const digitos = (cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11) return cpf || '';
  return `${digitos.slice(0, 3)}.***.***-${digitos.slice(9)}`;
}
function formatarHorasMin(horasDecimais) {
  const totalMin = Math.round(Math.abs(horasDecimais) * 60);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h === 0) return `${min}min`;
  if (min === 0) return `${h}h`;
  return `${h}h${String(min).padStart(2, '0')}min`;
}
// persiste o filtro de datas do RH pra não resetar quando sai e volta do sistema
function salvarRhFiltro(inicio, fim) {
  try {
    if (inicio) localStorage.setItem('rj_rh_filtro_inicio', inicio); else localStorage.removeItem('rj_rh_filtro_inicio');
    if (fim) localStorage.setItem('rj_rh_filtro_fim', fim); else localStorage.removeItem('rj_rh_filtro_fim');
  } catch (e) { /* ignora se localStorage não estiver disponível */ }
}
function jornadaEsperadaDoDia(funcionaria, dataStr) {
  const diaSemana = new Date(dataStr + 'T00:00:00').getDay();
  const config = (funcionaria.jornadaSemanal || {})[diaSemana];
  if (config) {
    if (!config.trabalha) return { trabalha: false, minutos: 0 };
    const [hE, mE] = config.entrada.split(':').map(Number);
    const [hSA, mSA] = config.saidaAlmoco.split(':').map(Number);
    const [hVA, mVA] = config.voltaAlmoco.split(':').map(Number);
    const [hS, mS] = config.saida.split(':').map(Number);
    const minutos = ((hSA * 60 + mSA) - (hE * 60 + mE)) + ((hS * 60 + mS) - (hVA * 60 + mVA));
    return { trabalha: true, minutos };
  }
  // sem jornada semanal configurada: usa o padrão antigo (só seg-sex)
  if (diaSemana === 0 || diaSemana === 6) return { trabalha: false, minutos: 0 };
  const [hE, mE] = funcionaria.jornadaEntrada.split(':').map(Number);
  const [hSA, mSA] = funcionaria.jornadaSaidaAlmoco.split(':').map(Number);
  const [hVA, mVA] = funcionaria.jornadaVoltaAlmoco.split(':').map(Number);
  const [hS, mS] = funcionaria.jornadaSaida.split(':').map(Number);
  const minutos = ((hSA * 60 + mSA) - (hE * 60 + mE)) + ((hS * 60 + mS) - (hVA * 60 + mVA));
  return { trabalha: true, minutos };
}
// calcula horas trabalhadas e a diferença (extra/falta) num dia, a partir das batidas —
// a jornada esperada agora varia por dia da semana (ex: acordo de não trabalhar sábado)
function calcularHorasDia(pontosDoDia, funcionaria, dataStr) {
  const porTipo = {};
  pontosDoDia.forEach((p) => { porTipo[p.tipo] = new Date(p.horario); });
  let horasTrabalhadas = 0;
  if (porTipo.entrada && porTipo.saida_almoco) horasTrabalhadas += (porTipo.saida_almoco - porTipo.entrada) / 3600000;
  if (porTipo.volta_almoco && porTipo.saida) horasT
