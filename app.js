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
    'Frete/Logística', 'Taxas de marketplace', 'Desconto de cupom', 'Ads/Marketing',
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
const CATEGORIAS_ENTRADA_NAO_OPERACIONAL = ['Empréstimo recebido', 'Reembolso de frete', 'Crédito grátis Ads'];
// categorias já geradas automaticamente por outro fluxo do sistema (parcela de empréstimo,
// holerite) — nunca devem ser marcadas como "repetir todos os meses" manualmente, senão
// duplicam com o que o próprio sistema já lança sozinho
const CATEGORIAS_SEM_RECORRENTE_MANUAL = ['Empréstimo — parcela', 'Funcionários — salário', 'Funcionários — encargos/benefícios'];

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
// seletor de período (de/até) reutilizado em Financeiro, Vendas, Dashboard e DRE — com atalhos
// rápidos, tipo os que aparecem no Upseller e nos painéis das plataformas, pra não precisar
// digitar duas datas toda vez pra ver "hoje" ou "esse mês"
function renderSeletorPeriodo(prefixoId) {
  return `
    <div class="form-row" style="align-items:center;flex-wrap:wrap;gap:6px">
      <input type="date" id="${prefixoId}Inicio" value="${state.periodoInicio}" style="max-width:150px" />
      <span style="color:var(--text-muted)">até</span>
      <input type="date" id="${prefixoId}Fim" value="${state.periodoFim}" style="max-width:150px" />
      <button class="toggle-btn" data-periodo-atalho="hoje" data-periodo-alvo="${prefixoId}">Hoje</button>
      <button class="toggle-btn" data-periodo-atalho="7dias" data-periodo-alvo="${prefixoId}">7 dias</button>
      <button class="toggle-btn" data-periodo-atalho="30dias" data-periodo-alvo="${prefixoId}">30 dias</button>
      <button class="toggle-btn" data-periodo-atalho="mes" data-periodo-alvo="${prefixoId}">Este mês</button>
    </div>
  `;
}
function wireSeletorPeriodo(prefixoId) {
  const inicioEl = document.getElementById(`${prefixoId}Inicio`);
  const fimEl = document.getElementById(`${prefixoId}Fim`);
  if (inicioEl) inicioEl.addEventListener('change', (e) => { state.periodoInicio = e.target.value; render(); });
  if (fimEl) fimEl.addEventListener('change', (e) => { state.periodoFim = e.target.value; render(); });
  document.querySelectorAll(`[data-periodo-alvo="${prefixoId}"]`).forEach((btn) => {
    btn.addEventListener('click', () => {
      const hoje = todayStr();
      if (btn.dataset.periodoAtalho === 'hoje') { state.periodoInicio = hoje; state.periodoFim = hoje; }
      else if (btn.dataset.periodoAtalho === '7dias') { state.periodoInicio = somaDias(hoje, -6); state.periodoFim = hoje; }
      else if (btn.dataset.periodoAtalho === '30dias') { state.periodoInicio = somaDias(hoje, -29); state.periodoFim = hoje; }
      else if (btn.dataset.periodoAtalho === 'mes') {
        const mk = hoje.slice(0, 7);
        state.periodoInicio = `${mk}-01`;
        state.periodoFim = `${mk}-${String(daysInMonth(mk)).padStart(2, '0')}`;
      }
      render();
    });
  });
}
function somaDias(dataStr, n) {
  const d = new Date(dataStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
// deixa "sku||variação" mais legível na tela (ex: "KIT-2-TOP||preto,branco" -> "KIT-2-TOP (preto,branco)")
// — o "||" é só um jeito interno de guardar o alias, não precisa aparecer cru pro usuário
const fmtSkuExibicao = (sku) => (sku ?? '').toString().split(',').map((s) => {
  const partes = s.trim().split('||');
  return partes.length > 1 ? `${partes[0]} (${partes[1]})` : partes[0];
}).join(', ');

// interpreta número digitado no padrão BR: vírgula é sempre decimal, ponto pode ser milhar
// ("3.000" = três mil) OU decimal ("19.5" = dezenove e meio), dependendo do formato — se
// tem vírgula, todo ponto antes dela é milhar; sem vírgula, só é milhar se aparecer em
// grupos certinhos de 3 dígitos (ex: "3.000", "12.500.000"), senão é tratado como decimal
function parseBRNumber(str) {
  if (typeof str !== 'string') return Number(str) || 0;
  const cleaned = str.replace(/[^\d,.-]/g, '');
  if (cleaned.includes(',')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '')) || 0;
  }
  return parseFloat(cleaned) || 0;
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
  const candidates = ['subtotal do produto', 'valor total', 'pagamentos recebidos', 'valor de vendas válidas', 'valor de vendas', 'valor total de vendas', 'valor da nota fiscal', 'valor', 'total', 'preço total', 'preco total', 'valor do produto', 'receita'];
  // usa a PRIMEIRA coluna candidata que existir na planilha, mesmo que o valor seja 0 — antes,
  // um R$0,00 de verdade (ex: pedido cancelado, sem repasse) era tratado como "não tem essa
  // coluna" e caía pra próxima candidata, ou pulava a linha inteira sem nem contar como pedido
  for (const c of candidates) if (row[c] !== undefined && row[c] !== '' && row[c] !== null) return row[c];
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
// texto da variante/cor da planilha (ex: "Preto,Único (36 a 42)") — só pra ajudar a
// identificar visualmente qual cor é, na hora de vincular um SKU pendente
function guessVarianteTextoField(row) {
  const candidates = ['variantes', 'variante', 'variação', 'variacao', 'variation'];
  for (const c of candidates) if (row[c]) return String(row[c]);
  return null;
}
function guessSkuField(row) {
  // "sku" primeiro: em relatórios "por variante" (ex: Sales by Variant da Shopee), a coluna
  // "SKU" já traz o código específico da cor (ex: BLUSA-ZAR-Preto-Unico), enquanto "SKU
  // Principal" traz só o código genérico do produto (ex: BLUSA-ZAR), igual pra todas as
  // cores. Se "SKU Principal" viesse primeiro, toda venda cairia no genérico e o sistema
  // nunca saberia de qual cor descontar — foi exatamente o bug que zerava a baixa de estoque
  // por cor em produtos como a Blusa Zara.
  const candidates = ['sku', 'nº de referência do sku principal', 'sku principal', 'número de referência sku', 'referência sku', 'referencia sku'];
  for (const c of candidates) if (row[c]) return String(row[c]).trim();
  return null;
}
function guessQuantidadeField(row) {
  const candidates = ['quantidade', 'unidades vendidas', 'qtd', 'quantity'];
  for (const c of candidates) if (row[c]) return Number(row[c]) || 1;
  return 1;
}
// número de PEDIDOS por linha — diferente da quantidade de peças, já que um pedido pode
// ter várias unidades. Relatórios "por variante" costumam trazer os dois separados
// ("Pedidos Válidos" x "Unidades Vendidas"); sem essa coluna, assume 1 pedido por linha
function guessPedidosField(row) {
  const candidates = ['pedidos válidos', 'número de pedidos', 'numero de pedidos', 'pedidos'];
  for (const c of candidates) if (row[c]) return Number(row[c]) || 1;
  return 1;
}
function guessDataFromFilename(fileName) {
  const m = fileName.match(/(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})/);
  if (!m) return { data: null, ehPeriodo: false };
  const [, y1, mo1, d1, y2, mo2, d2] = m;
  if (y1 === y2 && mo1 === mo2 && d1 === d2) return { data: `${y1}-${mo1}-${d1}`, ehPeriodo: false };
  // relatório de vários dias resumido numa linha só por SKU (ex: "Sales by Variant") — não dá
  // pra saber o dia exato de cada venda, então usa o ÚLTIMO dia do período como referência (bem
  // melhor que cair no dia de hoje, que não tem nada a ver com quando a venda aconteceu)
  return { data: `${y2}-${mo2}-${d2}`, ehPeriodo: true };
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
// escolhe a taxa % e fixa certa pra uma plataforma — se ela tiver "taxa por faixa de valor"
// configurada (ex: TikTok Shop, que cobra diferente pra produtos abaixo/acima de R$50),
// usa a faixa certa conforme o valor da venda; senão usa a taxa única normal
// escolhe a taxa % e fixa certa pra uma plataforma — se ela tiver "faixas por valor"
// configuradas (ex: Shopee com 3+ faixas, TikTok Shop com 2), usa a faixa certa conforme
// o valor da venda; senão usa a taxa única normal. As faixas são [{ate, pct, fixa}], e a
// última faixa (sem "ate", ou o maior "ate") cobre "esse valor pra cima"
function taxaDaPlataformaParaValor(plataforma, valor) {
  if (!plataforma) return { pct: 0, fixa: 0 };
  if (plataforma.taxaFaixas && plataforma.taxaFaixas.length > 0) {
    const ordenadas = [...plataforma.taxaFaixas].sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity));
    const faixa = ordenadas.find((f) => f.ate == null || valor <= f.ate) || ordenadas[ordenadas.length - 1];
    return { pct: faixa.pct, fixa: faixa.fixa };
  }
  return { pct: plataforma.taxaPercentual, fixa: plataforma.taxaFixa };
}

// fatura/extrato de anúncios da Shopee (Shopee Ads) — formato bem diferente de uma planilha
// comum: tem linhas de metadado antes da tabela de verdade, e a tabela é um EXTRATO DE
// CARTEIRA (cada recarga e cada uso, misturados), não um resumo por dia pronto. O gasto de
// anúncio de verdade é o total das linhas "Deduction for..." (o que a própria Shopee chama de
// "Investimento" no painel — confirmado batendo com o valor real que a Daniela conferiu na
// tela dela). "Crédito de Recarga" é só o dinheiro entrando na carteira, não o gasto em si.
async function processarFaturaAdsShopee(file) {
  const texto = await file.text();
  const linhas = texto.split(/\r?\n/);
  const idxHeader = linhas.findIndex((l) => {
    const low = l.toLowerCase();
    return low.includes('descri') && low.includes('quantidade') && low.includes('tempo');
  });
  if (idxHeader === -1) { alert('Não consegui reconhecer esse relatório de anúncios — o formato pode ter mudado.'); return; }
  const dados = parseCSV(linhas.slice(idxHeader).join('\n'));

  const gastoPorDia = new Map(); // 'YYYY-MM-DD' -> valor gasto (deduzido) no dia
  const gratisPorDia = new Map(); // 'YYYY-MM-DD' -> crédito grátis recebido da Shopee no dia (bônus, não é gasto)
  dados.forEach((row) => {
    const descricao = String(row['descrição'] || row['descricao'] || '').trim().toLowerCase();
    const tempo = String(row['tempo'] || '').trim();
    const m = tempo.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return;
    const [, d, mo, y] = m;
    const dataDia = `${y}-${mo}-${d}`;
    if (descricao.startsWith('deduction')) {
      const valorLinha = Math.abs(parseBRNumber(String(row['quantidade'] || '0')));
      gastoPorDia.set(dataDia, (gastoPorDia.get(dataDia) || 0) + valorLinha);
    } else if (descricao.startsWith('crédito de recarga') || descricao.startsWith('credito de recarga')) {
      const observacao = String(row['observação'] || row['observacao'] || '');
      const matchGratis = observacao.match(/Cr[ée]dito Gratuito:\s*([\d.,]+)/i);
      if (matchGratis) {
        const valorGratis = parseBRNumber(matchGratis[1]);
        gratisPorDia.set(dataDia, (gratisPorDia.get(dataDia) || 0) + valorGratis);
      }
    } else if (descricao.includes('rebate') || descricao.includes('roas')) {
      // devolução de crédito grátis (ex: "ROAS Protection Free Ads Credit Rebate") — também é bônus, não saiu do bolso
      const valorLinha = parseBRNumber(String(row['quantidade'] || '0'));
      if (valorLinha > 0) gratisPorDia.set(dataDia, (gratisPorDia.get(dataDia) || 0) + valorLinha);
    }
  });

  if (gastoPorDia.size === 0) { alert('Não achei nenhum gasto de anúncio (Deduction) nesse relatório — nada pra lançar.'); return; }

  const registros = [...gastoPorDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const total = registros.reduce((a, [, v]) => a + v, 0);
  const totalGratis = [...gratisPorDia.values()].reduce((a, v) => a + v, 0);
  const listaResumo = registros.map(([data, v]) => `${new Date(data + 'T00:00:00').toLocaleDateString('pt-BR')}: ${fmt(v)}`).join('\n');
  if (!confirm(`Achei ${registros.length} dia(s) de gasto com Shopee Ads nesse relatório:\n\n${listaResumo}\n\nTotal: ${fmt(total)}${totalGratis > 0 ? ` (dos quais ${fmt(totalGratis)} vieram de crédito grátis que a Shopee te deu, o resto do seu saldo pago)` : ''}\n\n(Esse total é o "Investimento" que a própria Shopee mostra no painel.)\n\nLançar um lançamento de despesa por dia?`)) return;

  for (const [dataDia, valor] of registros) {
    await addTx({
      tipo: 'saida', valor, categoria: 'Ads/Marketing', natureza: 'variavel',
      descricao: 'Shopee Ads — gasto com anúncios (Investimento)', data: dataDia,
    });
  }
  // crédito grátis não é despesa nem receita de venda — é só um registro informativo, guardado
  // como entrada numa categoria própria, pra aparecer no painel de marketing sem contar como
  // faturamento (o cálculo de faturamento só olha categorias que começam com "Venda")
  for (const [dataDia, valor] of gratisPorDia) {
    if (valor > 0) {
      await addTx({
        tipo: 'entrada', valor, categoria: 'Crédito grátis Ads', natureza: null,
        descricao: 'Shopee Ads — crédito grátis recebido (bônus, não é gasto seu)', data: dataDia,
      });
    }
  }
  await loadData();
  alert(`Lançado! ${registros.length} dia(s) de gasto com anúncios, totalizando ${fmt(total)}.${totalGratis > 0 ? `\n\nTambém registrei ${fmt(totalGratis)} de crédito grátis recebido, só pra referência (não conta como despesa nem receita).` : ''}`);
}
async function parseXLSX(file, nomeAba) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = nomeAba ? wb.Sheets[nomeAba] : wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return null;
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
  periodoInicio: todayStr().slice(0, 8) + '01',
  periodoFim: `${todayStr().slice(0, 8)}${String(daysInMonth(todayStr().slice(0, 7))).padStart(2, '0')}`,
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
  mostrarResumoPorDia: false,
  showProducaoForm: false,
  costureiraDetalheId: null,
  mostrarPecasPorModelo: false,
  editandoFeriasId: null,
  showNovoAdiantamento: false,
  modeloExpandido: null,
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
  showProdutosSemCor: false,
  sincronizando: false,
  adiantamentos: [],
  ordenarRankingPor: 'quantidade',
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
  grupoConcluindoId: null,
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
  pendenteKitAtivo: {},
  pendenteSelecaoAtual: {},
  vendasDetalhe: [],
  filtroHistoricoCanal: 'todos',
  abonosPonto: [],
  holerites: [],
  feriados: [],
  showFeriadosForm: false,
  empresaConfig: { cnpj: '', razaoSocial: '', nomeFantasia: '', endereco: '', telefone: '', emailjsServiceId: '', emailjsTemplateId: '', emailjsPublicKey: '' },
  showEmpresaConfigForm: false,
  showEmailConfigForm: false,
  importacoesVendas: [],
  kitComponentes: [],
  showKitForm: false,
  showImportacoesVendas: false,
  holeriteMes: null,
  holeriteDataPagamento: null,
  showLancamentoBanco: false,
  showHistoricoBanco: false,
  editingBancoHorasId: null,
  showPagarSaldoBanco: false,
  showPreviaHolerite: false,
  showHoleritesLote: false,
  showAbonarId: null,
};

// ==================== DATA LAYER ====================
// busca TODAS as linhas de uma tabela, sem depender do limite padrão do Supabase (que corta em
// 1000 linhas por padrão) — pagina de 1000 em 1000 até não sobrar mais nada. Essencial pra
// tabelas que crescem muito, tipo "transacoes" (cada peça vendida vira um lançamento separado)
// Ordenar só pela coluna pedida (ex: "data") não é suficiente quando MUITAS linhas empatam
// nesse valor (ex: milhares de vendas na mesma data) — o banco pode devolver essas linhas em
// ordem levemente diferente entre uma página e outra, fazendo alguma linha cair "no buraco"
// entre duas páginas e nunca aparecer (ou aparecer duplicada). Adicionar "id" como critério de
// desempate garante que a ordem fica sempre a mesma entre as páginas, sem perder nem repetir nada
async function fetchAllRows(tabela, colunaOrdem, ascending) {
  const linhas = [];
  const tamanhoPagina = 1000;
  let pagina = 0;
  while (true) {
    const de = pagina * tamanhoPagina;
    const ate = de + tamanhoPagina - 1;
    const { data, error } = await sb.from(tabela).select('*').order(colunaOrdem, { ascending }).order('id', { ascending: true }).range(de, ate);
    if (error) { console.error(`Erro ao buscar página de ${tabela}:`, error); break; }
    if (!data || data.length === 0) break;
    linhas.push(...data);
    if (data.length < tamanhoPagina) break; // última página
    pagina++;
  }
  return linhas;
}
async function loadData() {
  // mostra um aviso pequeno de "sincronizando" sem cobrir a tela inteira (o spinner de tela
  // cheia é só pra primeira vez que o app abre) — antes disso, qualquer ação (bater ponto,
  // lançar produção, etc.) processava em silêncio total, parecendo travado
  if (!state.loading) { state.sincronizando = true; render(); }
  // essas duas tabelas crescem muito rápido (cada peça vendida = 1 linha), então buscam
  // paginado em paralelo com o resto, pra nunca cortar dado antigo por engano
  const [tx, vendasDetalhe, producoes, distribuicoes] = await Promise.all([
    fetchAllRows('transacoes', 'data', false),
    fetchAllRows('vendas_detalhe', 'data', false),
    fetchAllRows('producoes', 'data', false),
    fetchAllRows('distribuicoes', 'data', false),
  ]);
  const [{ data: produtos, error: e2 }, { data: plataformas, error: e3 }, { data: costureiras, error: e4 }, { data: variantes, error: e6 }, { data: materiaPrima, error: e7 }, { data: ordensCorte, error: e8 }, { data: ordensCorteItens, error: e9 }, { data: insumos, error: e10 }, { data: fichaTecnicaItens, error: e12 }, { data: insumoPlataformaQtd, error: e13 }, { data: funcionarias, error: e14 }, { data: pontos, error: e15 }, { data: feriasTiradas, error: e16 }, { data: solicitacoesPonto, error: e17 }, { data: horasExtrasLiquidadas, error: e18 }, { data: bancoHorasLancamentos, error: e19 }, { data: emprestimos, error: e20 }, { data: emprestimoParcelas, error: e21 }, { data: cartoesCredito, error: e22 }, { data: vendasSkuPendentes, error: e23 }, { data: abonosPonto, error: e25 }, { data: holerites, error: e26 }, { data: feriados, error: e27 }, { data: empresaConfig, error: e28 }, { data: importacoesVendas, error: e29 }, { data: kitComponentes, error: e30 }, { data: vendasResumoDiario, error: e31 }, { data: adiantamentos, error: e32 }] = await Promise.all([
    sb.from('produtos').select('*').order('created_at', { ascending: false }),
    sb.from('plataformas').select('*').order('nome', { ascending: true }),
    sb.from('costureiras').select('*').order('nome', { ascending: true }),
    sb.from('variantes').select('*').order('nome', { ascending: true }),
    sb.from('materia_prima').select('*').order('cor', { ascending: true }),
    sb.from('ordens_corte').select('*').order('data_envio', { ascending: false }),
    sb.from('ordens_corte_itens').select('*'),
    sb.from('insumos').select('*').order('nome', { ascending: true }),
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
    sb.from('abonos_ponto').select('*').order('data', { ascending: false }),
    sb.from('holerites').select('*').order('mes', { ascending: false }),
    sb.from('feriados').select('*').order('data', { ascending: true }),
    sb.from('empresa_config').select('*').eq('id', 1).maybeSingle(),
    sb.from('importacoes_vendas').select('id, nome_arquivo, transacao_ids, vendas_detalhe_ids, sku_pendente_ids, desfeita, created_at').order('created_at', { ascending: false }).limit(10),
    sb.from('kit_componentes').select('*'),
    sb.from('vendas_resumo_diario').select('*'),
    sb.from('adiantamentos').select('*').order('data', { ascending: false }),
  ]);
  if (e2) console.error(e2);
  if (e3) console.error(e3);
  if (e4) console.error(e4);
  if (e6) console.error(e6);
  if (e7) console.error(e7);
  if (e8) console.error(e8);
  if (e9) console.error(e9);
  if (e10) console.error(e10);
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
  if (e25) console.error(e25);
  if (e26) console.error(e26);
  if (e27) console.error(e27);
  if (e28) console.error(e28);
  if (e29) console.error(e29);
  if (e30) console.error(e30);
  if (e31) console.error(e31);
  if (e32) console.error(e32);
  state.tx = (tx || []).map(mapTxFromDb);
  state.produtos = (produtos || []).map(mapProdutoFromDb);
  state.plataformas = (plataformas || []).map((p) => ({ id: p.id, nome: p.nome, taxaPercentual: Number(p.taxa_percentual), taxaFixa: Number(p.taxa_fixa || 0), taxaFaixas: Array.isArray(p.taxa_faixas) ? p.taxa_faixas : [] }));
  state.costureiras = (costureiras || []).map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa, metaSemanal: c.meta_semanal || 0, numeroIdentificacao: c.numero_identificacao || null }));
  state.producoes = (producoes || []).map((p) => ({ id: p.id, costureiraId: p.costureira_id, produtoId: p.produto_id, quantidade: p.quantidade, data: p.data, pago: p.pago, varianteId: p.variante_id || null, abateVarianteId: 'abate_variante_id' in p ? p.abate_variante_id : undefined, motivoDefeito: p.motivo_defeito || null, valorAjuste: p.valor_ajuste != null ? Number(p.valor_ajuste) : null, abateDistribuicoes: Array.isArray(p.abate_distribuicoes) ? p.abate_distribuicoes.map((x) => ({ distribuicaoId: x.distribuicaoId, quantidade: x.quantidade })) : null }));
  state.variantes = (variantes || []).map((v) => ({ id: v.id, produtoId: v.produto_id, nome: v.nome, estoqueAtual: v.estoque_atual, skuVariante: v.sku_variante }));
  state.materiaPrima = (materiaPrima || []).map((m) => ({ id: m.id, cor: m.cor, rolosDisponiveis: m.rolos_disponiveis, custoMedioRolo: Number(m.custo_medio_rolo || 0) }));
  state.ordensCorte = (ordensCorte || []).map((o) => ({ id: o.id, cor: o.cor, quantidadeRolos: o.quantidade_rolos, valorTecido: Number(o.valor_tecido), dataEnvio: o.data_envio, status: o.status, dataConclusao: o.data_conclusao, tipo: o.tipo || 'principal', valorCorte: Number(o.valor_corte || 0), transacaoCorteId: o.transacao_corte_id || null, grupoId: o.grupo_id || null }));
  state.ordensCorteItens = (ordensCorteItens || []).map((i) => ({ id: i.id, ordemId: i.ordem_id, produtoId: i.produto_id, quantidade: i.quantidade, varianteId: i.variante_id || null }));
  state.insumos = (insumos || []).map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade, quantidadeDisponivel: Number(i.quantidade_disponivel), custoMedioUnitario: Number(i.custo_medio_unitario), usadoNoEnvio: !!i.usado_no_envio, qtdVendaManual: Number(i.qtd_venda_manual ?? 1), quantidadeMinima: Number(i.quantidade_minima || 0) }));
  state.distribuicoes = (distribuicoes || []).map((d) => ({ id: d.id, ordemItemId: d.ordem_item_id, produtoId: d.produto_id, varianteId: d.variante_id || null, costureiraId: d.costureira_id, quantidadeDistribuida: d.quantidade_distribuida, quantidadeDevolvida: d.quantidade_devolvida, data: d.data, numeroSerie: d.numero_serie || null }));
  state.fichaTecnicaItens = (fichaTecnicaItens || []).map((f) => ({ id: f.id, produtoId: f.produto_id, tipoItem: f.tipo_item, insumoId: f.insumo_id || null, componenteProdutoId: f.componente_produto_id || null, quantidade: Number(f.quantidade), momento: f.momento || 'venda' }));
  state.insumoPlataformaQtd = (insumoPlataformaQtd || []).map((q) => ({ id: q.id, insumoId: q.insumo_id, plataformaId: q.plataforma_id, quantidade: Number(q.quantidade) }));
  state.funcionarias = (funcionarias || []).map((f) => ({ id: f.id, nome: f.nome, pin: f.pin, ativa: f.ativa, jornadaEntrada: (f.jornada_entrada || '08:00').slice(0, 5), jornadaSaidaAlmoco: (f.jornada_saida_almoco || '12:00').slice(0, 5), jornadaVoltaAlmoco: (f.jornada_volta_almoco || '13:00').slice(0, 5), jornadaSaida: (f.jornada_saida || '17:00').slice(0, 5), valorHora: Number(f.valor_hora || 0), dataAdmissao: f.data_admissao || null, jornadaSemanal: f.jornada_semanal || {}, percentualHoraExtra: Number(f.percentual_hora_extra != null ? f.percentual_hora_extra : 50), modoCompensacaoPadrao: f.modo_compensacao_padrao || 'dinheiro', tipoPagamento: f.tipo_pagamento || 'hora', salarioMensal: Number(f.salario_mensal || 0), valorVtDia: Number(f.valor_vt_dia || 0), valorVrDia: Number(f.valor_vr_dia || 0), horasCompensacaoSemanal: Number(f.horas_compensacao_semanal || 0), cpf: f.cpf || '', cargo: f.cargo || '', matricula: f.matricula || '', email: f.email || '' }));
  state.feriasTiradas = (feriasTiradas || []).map((v) => ({ id: v.id, funcionariaId: v.funcionaria_id, dataInicio: v.data_inicio, dataFim: v.data_fim, diasVendidos: Number(v.dias_vendidos || 0), mesReferenciaPagamento: v.mes_referencia_pagamento || null }));
  state.pontos = (pontos || []).map((p) => ({ id: p.id, funcionariaId: p.funcionaria_id, data: p.data, tipo: p.tipo, horario: p.horario, origem: p.origem || 'propria' }));
  state.solicitacoesPonto = (solicitacoesPonto || []).map((s) => ({ id: s.id, funcionariaId: s.funcionaria_id, data: s.data, tipo: s.tipo, horarioSolicitado: s.horario_solicitado, motivo: s.motivo || '', status: s.status, createdAt: s.created_at }));
  state.horasExtrasLiquidadas = (horasExtrasLiquidadas || []).map((h) => ({ id: h.id, funcionariaId: h.funcionaria_id, data: h.data, horas: Number(h.horas), modo: h.modo, valorPago: h.valor_pago != null ? Number(h.valor_pago) : null }));
  state.bancoHorasLancamentos = (bancoHorasLancamentos || []).map((b) => ({ id: b.id, funcionariaId: b.funcionaria_id, data: b.data, tipo: b.tipo, horas: Number(b.horas), descricao: b.descricao || '', mesReferencia: b.mes_referencia || null }));
  state.emprestimos = (emprestimos || []).map((e) => ({ id: e.id, descricao: e.descricao, instituicao: e.instituicao || '', valorRecebido: Number(e.valor_recebido), numeroParcelas: e.numero_parcelas, valorParcela: Number(e.valor_parcela), dataRecebimento: e.data_recebimento, dataPrimeiraParcela: e.data_primeira_parcela, transacaoRecebimentoId: e.transacao_recebimento_id || null }));
  state.emprestimoParcelas = (emprestimoParcelas || []).map((p) => ({ id: p.id, emprestimoId: p.emprestimo_id, numero: p.numero, valor: Number(p.valor), dataVencimento: p.data_vencimento, transacaoId: p.transacao_id || null }));
  state.cartoesCredito = (cartoesCredito || []).map((c) => ({ id: c.id, nome: c.nome, limite: Number(c.limite || 0), diaFechamento: c.dia_fechamento, diaVencimento: c.dia_vencimento, ativo: c.ativo !== false }));
  state.vendasSkuPendentes = (vendasSkuPendentes || []).map((v) => ({ id: v.id, sku: v.sku, quantidade: Number(v.quantidade), faturamento: Number(v.faturamento), ultimaData: v.ultima_data, plataformaNome: v.plataforma_nome || null, descricao: v.descricao || null, varianteTexto: v.variante_texto || null, pedidos: Number(v.pedidos || v.quantidade || 1), taxa: Number(v.taxa || 0) }));
  state.vendasDetalhe = (vendasDetalhe || []).map((v) => ({ id: v.id, produtoId: v.produto_id, varianteId: v.variante_id || null, plataformaId: v.plataforma_id, plataformaNome: v.plataforma_nome || null, sku: v.sku || null, quantidade: Number(v.quantidade), valor: Number(v.valor), data: v.data, pedidos: Number(v.pedidos || 1), taxa: Number(v.taxa || 0) }));
  state.abonosPonto = (abonosPonto || []).map((a) => ({ id: a.id, funcionariaId: a.funcionaria_id, data: a.data, tipo: a.tipo, motivo: a.motivo || '', horas: a.horas != null ? Number(a.horas) : null }));
  state.holerites = (holerites || []).map((h) => ({ id: h.id, funcionariaId: h.funcionaria_id, mes: h.mes, diasTrabalhados: Number(h.dias_trabalhados), salarioBase: Number(h.salario_base), horasExtras: Number(h.horas_extras), valorHorasExtras: Number(h.valor_horas_extras), horasExtras100: Number(h.horas_extras_100 || 0), valorHorasExtras100: Number(h.valor_horas_extras_100 || 0), modoHorasExtras: h.modo_horas_extras, horasFaltantes: Number(h.horas_faltantes), valorVt: Number(h.valor_vt), valorVr: Number(h.valor_vr), totalPagar: Number(h.total_pagar), assinadoEm: h.assinado_em || null, assinaturaImagem: h.assinatura_imagem || null, createdAt: h.created_at, numeroRecibo: h.numero_recibo || null, emitidoPor: h.emitido_por || null, valorFerias: Number(h.valor_ferias || 0), valorAbonoPecuniario: Number(h.valor_abono_pecuniario || 0), diasFeriasGozados: Number(h.dias_ferias_gozados || 0), diasVendidos: Number(h.dias_vendidos || 0) }));
  state.feriados = (feriados || []).map((f) => ({ id: f.id, data: f.data, nome: f.nome || '' }));
  state.empresaConfig = { cnpj: empresaConfig?.cnpj || '', razaoSocial: empresaConfig?.razao_social || '', nomeFantasia: empresaConfig?.nome_fantasia || '', endereco: empresaConfig?.endereco || '', telefone: empresaConfig?.telefone || '', emailjsServiceId: empresaConfig?.emailjs_service_id || '', emailjsTemplateId: empresaConfig?.emailjs_template_id || '', emailjsPublicKey: empresaConfig?.emailjs_public_key || '' };
  state.importacoesVendas = (importacoesVendas || []).map((i) => ({ id: i.id, nomeArquivo: i.nome_arquivo || 'Importação', transacaoIds: i.transacao_ids || [], vendasDetalheIds: i.vendas_detalhe_ids || [], skuPendenteIds: i.sku_pendente_ids || [], desfeita: i.desfeita, createdAt: i.created_at }));
  state.kitComponentes = (kitComponentes || []).map((k) => ({ id: k.id, produtoKitId: k.produto_kit_id, componenteProdutoId: k.componente_produto_id, componenteVarianteId: k.componente_variante_id || null, quantidade: Number(k.quantidade) }));
  state.vendasResumoDiario = (vendasResumoDiario || []).map((r) => ({ id: r.id, plataformaNome: r.plataforma_nome || null, data: r.data, pedidos: Number(r.pedidos), unidades: Number(r.unidades), faturamento: Number(r.faturamento) }));
  state.adiantamentos = (adiantamentos || []).map((a) => ({ id: a.id, funcionariaId: a.funcionaria_id, data: a.data, valor: Number(a.valor), motivo: a.motivo || '', transacaoId: a.transacao_id || null }));
  state.loading = false;
  state.sincronizando = false;
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
  return { id: row.id, nome: row.nome, sku: row.sku, estoqueAtual: row.estoque_atual, estoqueMinimo: row.estoque_minimo, custoUnitario: Number(row.custo_unitario), custoEstimado: !!row.custo_estimado, totalVendido: row.total_vendido || 0, ultimaVenda: row.ultima_venda || null, valorMaoObra: Number(row.valor_mao_obra || 0), tipo: row.tipo || 'unitario', precoVendaMedio: Number(row.preco_venda_medio || 0), ativo: row.ativo !== false, ehKit: !!row.eh_kit };
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
  const { data, error } = await sb.from('transacoes').insert(rows.map((tx) => ({
    tipo: tx.tipo, valor: tx.valor, categoria: tx.categoria, natureza: tx.natureza || null, descricao: tx.descricao || null, data: tx.data, id_pedido: tx.idPedido || null,
  }))).select('id');
  if (error) { alert('Erro ao importar: ' + error.message); return []; }
  return (data || []).map((r) => r.id);
}
// grava o detalhe de vendas por produto+plataforma+data de cada import — usado pra
// alimentar o ranking de produtos e a comparação entre plataformas na aba Vendas
async function addVendasDetalheBatch(rows) {
  if (!rows.length) return [];
  const { data, error } = await sb.from('vendas_detalhe').insert(rows.map((v) => ({
    produto_id: v.produtoId, variante_id: v.varianteId || null, plataforma_id: v.plataformaId || null, plataforma_nome: v.plataformaNome || null, sku: v.sku || null, quantidade: v.quantidade, valor: v.valor, data: v.data, pedidos: v.pedidos || 1, taxa: v.taxa || 0,
  }))).select('id');
  if (error) { console.error('Erro ao gravar detalhe de vendas: ' + error.message); return []; }
  return (data || []).map((r) => r.id);
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
    const { error: errParcela } = await sb.from('emprestimo_parcelas').insert({
      emprestimo_id: emprestimo.id, numero: i + 1, valor: valorParcela, data_vencimento: dataVenc,
      transacao_id: tx ? tx.id : null,
    });
    if (errParcela) console.error('Erro ao salvar parcela do empréstimo:', errParcela);
  }
}
async function removeEmprestimo(id) {
  const parcelas = state.emprestimoParcelas.filter((p) => p.emprestimoId === id);
  const emprestimo = state.emprestimos.find((e) => e.id === id);
  const idsTransacoes = parcelas.map((p) => p.transacaoId).filter(Boolean);
  if (emprestimo?.transacaoRecebimentoId) idsTransacoes.push(emprestimo.transacaoRecebimentoId);
  if (idsTransacoes.length > 0) {
    const { error: errTx } = await deleteEmLotes('transacoes', idsTransacoes);
    if (errTx) { alert('Erro ao remover as parcelas desse empréstimo: ' + errTx.message); return; }
  }
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
  const { error } = await sb.from('variantes').update({ estoque_atual: novoEstoque }).eq('id', id);
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
async function criarOrdemCorte(cor, quantidadeRolos, valorTecido, dataEnvio, tipo, valorCorte, grupoId) {
  if (tipo === 'principal') {
    const materia = state.materiaPrima.find((m) => m.cor.trim().toLowerCase() === cor.trim().toLowerCase());
    if (!materia || materia.rolosDisponiveis < quantidadeRolos) {
      if (!confirm('Você tem menos rolos dessa cor em estoque do que está enviando. Confirma mesmo assim?')) return false;
    }
    if (materia) await sb.from('materia_prima').update({ rolos_disponiveis: Math.max(0, materia.rolosDisponiveis - quantidadeRolos) }).eq('id', materia.id);
  }
  // não lança no Financeiro ainda aqui — o valor do corte só é PAGO quando a peça volta pronta
  // (em concluirOrdemCorte), não no dia que o tecido é enviado pra cortar
  const { error } = await sb.from('ordens_corte').insert({
    cor, quantidade_rolos: quantidadeRolos, valor_tecido: valorTecido, data_envio: dataEnvio, status: 'aguardando', tipo, valor_corte: valorCorte || 0, grupo_id: grupoId || null,
  }).select().single();
  if (error) { alert('Erro ao criar ordem de corte: ' + error.message); return false; }
  return true;
}
async function concluirOrdemCorte(ordemId, itens) {
  for (const item of itens) {
    const { error } = await sb.from('ordens_corte_itens').insert({ ordem_id: ordemId, produto_id: item.produtoId, quantidade: item.quantidade });
    if (error) { alert('Erro ao salvar item do corte: ' + error.message); return; }
  }
  const dataConclusao = todayStr();
  const { error } = await sb.from('ordens_corte').update({ status: 'concluido', data_conclusao: dataConclusao }).eq('id', ordemId);
  if (error) { alert('Erro ao concluir ordem: ' + error.message); return; }
  // é AQUI que lança o valor do corte no Financeiro — na data que a peça volta pronta (quando
  // de fato se paga), não no dia que o tecido foi mandado pra cortar
  const ordem = state.ordensCorte.find((o) => o.id === ordemId);
  if (ordem && ordem.valorCorte > 0 && !ordem.transacaoCorteId) {
    const tx = await addTx({
      tipo: 'saida', valor: ordem.valorCorte, categoria: 'Corte e costura (terceirizado)', natureza: 'variavel',
      descricao: `${ordem.tipo === 'retalho' ? 'Corte de retalhos' : 'Corte'} — ${ordem.cor}`, data: dataConclusao,
    });
    if (tx) await sb.from('ordens_corte').update({ transacao_corte_id: tx.id }).eq('id', ordemId);
  }
}
async function removeOrdemCorte(id) {
  const ordem = state.ordensCorte.find((o) => o.id === id);
  if (ordem && ordem.transacaoCorteId) await removeTx(ordem.transacaoCorteId);
  // devolve os rolos pro estoque de matéria-prima — só se foi corte principal AINDA
  // aguardando resultado (se já tinha sido concluído, o tecido virou peça de verdade,
  // não deve "reaparecer" no estoque de matéria-prima)
  if (ordem && ordem.tipo === 'principal' && ordem.status === 'aguardando' && ordem.quantidadeRolos > 0) {
    const materia = state.materiaPrima.find((m) => m.cor.trim().toLowerCase() === ordem.cor.trim().toLowerCase());
    if (materia) await sb.from('materia_prima').update({ rolos_disponiveis: materia.rolosDisponiveis + ordem.quantidadeRolos }).eq('id', materia.id);
  }
  const { error } = await sb.from('ordens_corte').delete().eq('id', id);
  if (error) alert('Erro ao remover ordem: ' + error.message);
}
async function updateOrdemCorte(id, { cor, quantidadeRolos, valorTecido, valorCorte, dataEnvio }) {
  const ordem = state.ordensCorte.find((o) => o.id === id);
  let transacaoCorteId = ordem ? ordem.transacaoCorteId : null;
  const descricao = `${ordem && ordem.tipo === 'retalho' ? 'Corte de retalhos' : 'Corte'} — ${cor}`;

  if (transacaoCorteId) {
    // já tinha lançamento (corte já concluído antes) — só ajusta o valor, mantém a data que já
    // tava lá (a data de conclusão, não mexe nisso aqui)
    if (valorCorte > 0) {
      await updateTx(transacaoCorteId, { tipo: 'saida', valor: valorCorte, categoria: 'Corte e costura (terceirizado)', natureza: 'variavel', descricao, recorrente: false });
    } else {
      await removeTx(transacaoCorteId);
      transacaoCorteId = null;
    }
  } else if (valorCorte > 0 && ordem?.status === 'concluido' && ordem.dataConclusao) {
    // só cria o lançamento aqui se o corte JÁ estiver concluído (peça pronta) — se ainda tá
    // "aguardando", o valor fica só guardado, e o lançamento é criado na hora de concluir
    const tx = await addTx({ tipo: 'saida', valor: valorCorte, categoria: 'Corte e costura (terceirizado)', natureza: 'variavel', descricao, data: ordem.dataConclusao });
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
async function updateInsumo(id, nome, quantidadeDisponivel, custoMedioUnitario, quantidadeMinima) {
  const { error } = await sb.from('insumos').update({ nome, quantidade_disponivel: quantidadeDisponivel, custo_medio_unitario: custoMedioUnitario, quantidade_minima: quantidadeMinima || 0 }).eq('id', id);
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
// gera o próximo número de série da ficha pra essa costureira, no formato
// [numeroIdentificacao].[sequencial]/[ano] — ex: "02.001/26". O sequencial é próprio de
// cada NÚMERO (não da costureira em si) e reinicia a cada ano novo — isso garante que o
// número de série nunca se repete mesmo se um número de identificação for reaproveitado
// por outra costureira depois (ex: "02" era da Fernanda, hoje é da Joélia — a sequência
// continua de onde parou, nunca gerando duas fichas "02.001/26" diferentes). Se a
// costureira não tem número de identificação cadastrado ainda, não gera nada (fica null)
function proximoNumeroSerieFicha(costureiraId, data) {
  const costureira = state.costureiras.find((c) => c.id === costureiraId);
  if (!costureira || !costureira.numeroIdentificacao) return null;
  const anoCompleto = data.slice(0, 4);
  const anoCurto = data.slice(2, 4);
  const prefixo = costureira.numeroIdentificacao + '.';
  let maiorSequencial = 0;
  state.distribuicoes.forEach((d) => {
    if (!d.numeroSerie || !d.data || d.data.slice(0, 4) !== anoCompleto) return;
    if (!d.numeroSerie.startsWith(prefixo)) return;
    const m = d.numeroSerie.match(/\.(\d+)\//);
    if (m) maiorSequencial = Math.max(maiorSequencial, Number(m[1]));
  });
  const sequencial = String(maiorSequencial + 1).padStart(3, '0');
  return `${costureira.numeroIdentificacao}.${sequencial}/${anoCurto}`;
}
async function distribuirPecas(ordemItemId, produtoId, varianteId, costureiraId, quantidade, data) {
  const numeroSerie = proximoNumeroSerieFicha(costureiraId, data);
  const { error } = await sb.from('distribuicoes').insert({
    ordem_item_id: ordemItemId, produto_id: produtoId, variante_id: varianteId || null,
    costureira_id: costureiraId, quantidade_distribuida: quantidade, quantidade_devolvida: 0, data,
    numero_serie: numeroSerie,
  });
  if (error) alert('Erro ao distribuir peças: ' + error.message);
}
async function removeDistribuicao(id) {
  const { error } = await sb.from('distribuicoes').delete().eq('id', id);
  if (error) alert('Erro ao remover distribuição: ' + error.message);
}

// carrega a biblioteca de gerar PDF sob demanda, tentando duas fontes diferentes — em vez
// de só avisar "espera e tenta de novo", o sistema tenta buscar a biblioteca sozinho antes
// de desistir. Isso resolve o caso em que a internet estava lenta bem no instante em que o
// app abriu e a biblioteca não deu tempo de carregar junto com o resto
let __jspdfLoadingPromise = null;
function garantirJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  if (__jspdfLoadingPromise) return __jspdfLoadingPromise;
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
  ];
  __jspdfLoadingPromise = (async () => {
    for (const url of urls) {
      if (window.jspdf && window.jspdf.jsPDF) return;
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        if (window.jspdf && window.jspdf.jsPDF) return;
      } catch (e) { /* tenta a próxima fonte */ }
    }
    __jspdfLoadingPromise = null;
    throw new Error('não foi possível carregar a biblioteca de PDF');
  })();
  return __jspdfLoadingPromise;
}
// ---- Ficha de corte em PDF (duas vias: Costureira e Expedição) ----
async function gerarFichaCortePDF(distribuicao, ordem) {
  try {
    await garantirJsPDF();
  } catch (e) {
    alert('Não consegui carregar a biblioteca de PDF. Confira sua internet e tenta de novo — se persistir, feche e abra o app.');
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
    const tituloFicha = distribuicao.numeroSerie ? `${distribuicao.numeroSerie} - FICHA DE CORTE – ROSA JULIETA` : 'FICHA DE CORTE – ROSA JULIETA';
    doc.text(tituloFicha, margemEsq, y);
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

  const prefixoSerie = distribuicao.numeroSerie ? distribuicao.numeroSerie.replace(/[^a-z0-9]+/gi, '-') + '-' : '';
  const nomeArquivo = `ficha-corte-${prefixoSerie}${(costureira?.nome || 'costureira').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${distribuicao.data}.pdf`;
  doc.save(nomeArquivo);
  } catch (err) {
    console.error(err);
    alert('Não consegui gerar o PDF: ' + err.message);
  }
}
// ---- Holerite em PDF ----
// aceita tanto a prévia (dados calculados na hora, ainda não fechado) quanto um holerite
// já fechado (com data/hora de assinatura, se a funcionária já confirmou)
// monta o PDF do holerite e devolve o objeto "doc" pronto (sem salvar/baixar ainda) — assim
// a mesma montagem serve tanto pra baixar quanto pra mandar por e-mail, sem duplicar o
// layout inteiro duas vezes
function montarHoleritePDF(funcionaria, mesKey, dados) {
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
  if (funcionaria.cpf) { doc.text(`CNPJ: ${formatarCnpj(funcionaria.cpf)}`, margemEsq, y); y += 6; }
  doc.text(`Referência: ${mesLabelTexto.charAt(0).toUpperCase() + mesLabelTexto.slice(1)} (${diasCorridosMes} dias)`, margemEsq, y); y += 6;
  doc.text(`Dias trabalhados no mês: ${dados.diasTrabalhados}`, margemEsq, y); y += 6;
  if (ocorrencias.diasAtestado + ocorrencias.diasAbono + ocorrencias.diasFerias > 0) {
    const partes = [];
    if (ocorrencias.diasAtestado > 0) partes.push(`${ocorrencias.diasAtestado} atestado(s)`);
    if (ocorrencias.diasAbono > 0) partes.push(`${ocorrencias.diasAbono} abono(s)/folga(s)`);
    if (ocorrencias.diasFerias > 0) partes.push(`${ocorrencias.diasFerias} dia(s) de recesso`);
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
  if (dados.valorVt > 0) linha('Auxílio Transporte', dados.valorVt);
  if (dados.valorVr > 0) linha('Auxílio Alimentação', dados.valorVr);
  if (dados.diasFeriasGozados > 0) linha(`Recesso (${dados.diasFeriasGozados} dias + adicional)`, (dados.valorFerias || 0) * (4 / 3));
  if (dados.diasVendidos > 0) linha(`Dias vendidos (${dados.diasVendidos} dias + adicional)`, (dados.valorAbonoPecuniario || 0) * (4 / 3));
  const totalAdiantamentosPdf = state.adiantamentos.filter((a) => a.funcionariaId === funcionaria.id && a.data.slice(0, 7) === mesKey).reduce((acc, a) => acc + a.valor, 0);
  if (totalAdiantamentosPdf > 0) linha('Adiantamento/vale descontado', -totalAdiantamentosPdf);

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

  return doc;
}
async function gerarHoleritePDF(funcionaria, mesKey, dados) {
  try {
    await garantirJsPDF();
  } catch (e) {
    alert('Não consegui carregar a biblioteca de PDF. Confira sua internet e tenta de novo — se persistir, feche e abra o app.');
    return;
  }
  try {
    const doc = montarHoleritePDF(funcionaria, mesKey, dados);
    const nomeArquivo = `holerite-${funcionaria.nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${mesKey}.pdf`;
    doc.save(nomeArquivo);
  } catch (err) {
    console.error(err);
    alert('Não consegui gerar o PDF: ' + err.message);
  }
}
// carrega o SDK do EmailJS sob demanda, igual já fazemos com o jsPDF
let __emailjsLoadingPromise = null;
function garantirEmailJS() {
  if (window.emailjs) return Promise.resolve();
  if (__emailjsLoadingPromise) return __emailjsLoadingPromise;
  __emailjsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    script.onload = () => { if (window.emailjs) resolve(); else reject(new Error('emailjs não inicializou')); };
    script.onerror = () => reject(new Error('falha ao carregar o script do emailjs'));
    document.head.appendChild(script);
  }).catch((e) => { __emailjsLoadingPromise = null; throw e; });
  return __emailjsLoadingPromise;
}
// manda o holerite por e-mail pra funcionária, com um LINK pro PDF (em vez de anexo — o
// EmailJS passou a cobrar por anexo, então guardamos o PDF no Supabase Storage e mandamos
// um link assinado, que expira sozinho em 30 dias por segurança) — usa exatamente o mesmo
// layout de quem baixa o PDF
async function enviarHoleritePorEmail(funcionaria, mesKey, dados) {
  if (!funcionaria.email) {
    alert(`${funcionaria.nome} ainda não tem e-mail cadastrado. Edite o cadastro dela (✏️) e preencha o campo de e-mail primeiro.`);
    return;
  }
  const { emailjsServiceId, emailjsTemplateId, emailjsPublicKey } = state.empresaConfig;
  if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) {
    alert('Configure o envio de e-mail primeiro — clique em "✉️ Configurar e-mail" no topo da tela de RH e cole as credenciais do EmailJS.');
    return;
  }
  try {
    await garantirJsPDF();
    await garantirEmailJS();
  } catch (e) {
    alert('Não consegui carregar as bibliotecas necessárias. Confira sua internet e tenta de novo.');
    return;
  }
  try {
    const doc = montarHoleritePDF(funcionaria, mesKey, dados);
    const pdfBlob = doc.output('blob');
    const caminhoArquivo = `${funcionaria.id}/${mesKey}.pdf`;
    const { error: erroUpload } = await sb.storage.from('holerites').upload(caminhoArquivo, pdfBlob, { contentType: 'application/pdf', upsert: true });
    if (erroUpload) throw new Error(`falha ao salvar o PDF: ${erroUpload.message}`);
    const trintaDiasSegundos = 60 * 60 * 24 * 30;
    const { data: linkData, error: erroLink } = await sb.storage.from('holerites').createSignedUrl(caminhoArquivo, trintaDiasSegundos);
    if (erroLink || !linkData) throw new Error(`falha ao gerar o link: ${erroLink?.message || 'erro desconhecido'}`);
    const mesLabelTexto = new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    await window.emailjs.send(emailjsServiceId, emailjsTemplateId, {
      to_email: funcionaria.email,
      to_name: funcionaria.nome,
      subject: mesLabelTexto,
      message: `seu holerite de ${mesLabelTexto}`,
      pdf_link: linkData.signedUrl,
    }, { publicKey: emailjsPublicKey });
    alert(`Holerite enviado por e-mail pra ${funcionaria.nome} (${funcionaria.email})! O link no e-mail é válido por 30 dias.`);
  } catch (err) {
    console.error(err);
    alert('Não consegui enviar o e-mail: ' + (err?.text || err?.message || 'erro desconhecido') + '. Confira se as credenciais do EmailJS estão certas e se o template usa a variável {{pdf_link}}.');
  }
}
// ---- Espelho de ponto em PDF (batidas dia a dia do mês, separado do holerite) ----
async function gerarEspelhoPontoPDF(funcionaria, mesKey) {
  try {
    await garantirJsPDF();
  } catch (e) {
    alert('Não consegui carregar a biblioteca de PDF. Confira sua internet e tenta de novo — se persistir, feche e abra o app.');
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
// abate as distribuições (levas) mais antigas primeiro (FIFO), e devolve exatamente de QUAIS
// levas tirou e quanto de cada — isso é guardado no lançamento, pra se ele for excluído depois,
// a devolução saber exatamente aonde devolver, em vez de adivinhar "a mais recente" (que pode
// ser uma leva diferente da que foi usada de verdade, se a costureira tiver mais de uma leva
// aberta do mesmo produto/cor ao mesmo tempo)
async function baixarDistribuicoesFIFO(costureiraId, produtoId, varianteId, quantidadeDevolvida) {
  let restante = quantidadeDevolvida;
  const abatidoPorDistribuicao = [];
  const abertas = state.distribuicoes
    .filter((d) => d.costureiraId === costureiraId && d.produtoId === produtoId && (d.varianteId || null) === (varianteId || null) && d.quantidadeDevolvida < d.quantidadeDistribuida)
    .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  for (const d of abertas) {
    if (restante <= 0) break;
    const disponivel = d.quantidadeDistribuida - d.quantidadeDevolvida;
    const abate = Math.min(disponivel, restante);
    const { error } = await sb.from('distribuicoes').update({ quantidade_devolvida: d.quantidadeDevolvida + abate }).eq('id', d.id);
    if (error) { console.error('Erro ao abater distribuição:', error); alert('Erro ao atualizar "peças em mãos": ' + error.message); return abatidoPorDistribuicao; }
    abatidoPorDistribuicao.push({ distribuicaoId: d.id, quantidade: abate });
    restante -= abate;
  }
  return abatidoPorDistribuicao;
}
// abate de UMA leva específica, escolhida na mão (por id) — pra quando a costureira tem mais
// de uma leva aberta da mesma cor/combinação, e a pessoa lançando sabe exatamente de qual
// veio essa peça (em vez de deixar o FIFO decidir sozinho, que pega sempre a mais antiga e
// pode escolher a leva errada quando tem mais de uma em aberto)
async function baixarDeDistribuicaoEspecifica(distribuicaoId, quantidade) {
  const d = state.distribuicoes.find((x) => x.id === distribuicaoId);
  if (!d) return [];
  const disponivel = d.quantidadeDistribuida - d.quantidadeDevolvida;
  const abate = Math.min(disponivel, quantidade);
  const abatidoPorDistribuicao = [];
  if (abate > 0) {
    const { error } = await sb.from('distribuicoes').update({ quantidade_devolvida: d.quantidadeDevolvida + abate }).eq('id', d.id);
    if (error) { console.error('Erro ao abater distribuição específica:', error); alert('Erro ao atualizar "peças em mãos": ' + error.message); return abatidoPorDistribuicao; }
    abatidoPorDistribuicao.push({ distribuicaoId: d.id, quantidade: abate });
  }
  const restante = quantidade - abate;
  if (restante > 0) {
    // sobrou mais do que essa leva específica tinha disponível — completa o resto pela fila
    // normal (FIFO), nas outras levas da mesma cor
    const breakdownExtra = await baixarDistribuicoesFIFO(d.costureiraId, d.produtoId, d.varianteId, restante);
    return [...abatidoPorDistribuicao, ...breakdownExtra];
  }
  return abatidoPorDistribuicao;
}
// desfaz devoluções já registradas. Se receber um "breakdown" (de qual lançamento exato ele
// veio), devolve EXATAMENTE pras mesmas levas, na mesma quantidade — sem adivinhar. Só cai na
// adivinhação "mais recente primeiro" (LIFO) pra lançamentos antigos, de antes desse controle
// existir, que não têm essa informação salva
async function restaurarDistribuicoesLIFO(costureiraId, produtoId, varianteId, quantidadeARestaurar, breakdown) {
  if (breakdown && breakdown.length > 0) {
    let restanteBreakdown = quantidadeARestaurar;
    for (const item of breakdown) {
      if (restanteBreakdown <= 0) break;
      const d = state.distribuicoes.find((x) => x.id === item.distribuicaoId);
      if (!d) continue; // leva foi excluída de vez, não tem como devolver nela — pula
      const restaura = Math.min(item.quantidade, d.quantidadeDevolvida, restanteBreakdown);
      if (restaura <= 0) continue;
      const { error } = await sb.from('distribuicoes').update({ quantidade_devolvida: d.quantidadeDevolvida - restaura }).eq('id', d.id);
      if (error) { console.error('Erro ao restaurar distribuição:', error); alert('Erro ao devolver peças pra "em mãos": ' + error.message); return restanteBreakdown; }
      restanteBreakdown -= restaura;
    }
    return restanteBreakdown;
  }
  let restante = quantidadeARestaurar;
  const comDevolucao = state.distribuicoes
    .filter((d) => d.costureiraId === costureiraId && d.produtoId === produtoId && (d.varianteId || null) === (varianteId || null) && d.quantidadeDevolvida > 0)
    .sort((a, b) => b.data.localeCompare(a.data));
  for (const d of comDevolucao) {
    if (restante <= 0) break;
    const restaura = Math.min(d.quantidadeDevolvida, restante);
    const { error } = await sb.from('distribuicoes').update({ quantidade_devolvida: d.quantidadeDevolvida - restaura }).eq('id', d.id);
    if (error) { console.error('Erro ao restaurar distribuição:', error); alert('Erro ao devolver peças pra "em mãos": ' + error.message); return restante; }
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
  const { error } = await deleteEmLotes('transacoes', ids);
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
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, custo_estimado: !!p.custoEstimado, valor_mao_obra: p.valorMaoObra || 0, tipo: p.tipo || 'unitario',
  }).select().single();
  if (error) { alert('Erro ao salvar produto: ' + error.message); return null; }
  return data;
}
async function updateProdutoEstoque(id, novoEstoque) {
  const { error } = await sb.from('produtos').update({ estoque_atual: novoEstoque }).eq('id', id);
  if (error) alert('Erro ao atualizar estoque: ' + error.message);
}
// desconta estoque de uma venda — se o produto for um kit (composto por outros produtos,
// ex: "Kit 2 Top Joy" = 2x Top Joy), desconta dos componentes de verdade, multiplicado pela
// quantidade de cada componente × quantidade vendida do kit, em vez de tentar descontar de
// um estoque próprio que o kit nem tem
// pra kit "2x do mesmo produto, cores variadas": o kit tem suas próprias "variantes" (as
// combinações, ex: "Amarelo Bebê + Branco"), mas quem guarda estoque de verdade é o produto
// unitário (ex: Top Joy). Essa função pega o nome da combinação, separa nas duas cores, e
// acha a variante correspondente no produto unitário — pra abater a cor certa de cada vez,
// em vez de sempre abater a mesma cor fixa configurada uma vez só na ficha técnica do kit
function resolverComponentesKitPorCombo(kitProdutoId, kitVarianteId) {
  const kitVariante = state.variantes.find((v) => v.id === kitVarianteId);
  if (!kitVariante) return null;
  const produtoBaseId = state.kitComponentes.find((k) => k.produtoKitId === kitProdutoId)?.componenteProdutoId;
  if (!produtoBaseId) return null;
  const coresDoProdutoBase = variantesDoProduto(produtoBaseId);
  const pedacos = kitVariante.nome.split('+').map((s) => s.trim()).filter(Boolean);
  if (pedacos.length === 0) return null;
  const resolvidos = [];
  for (const pedaco of pedacos) {
    const cor = coresDoProdutoBase.find((v) => v.nome.trim().toLowerCase() === pedaco.toLowerCase());
    if (!cor) return null; // não achou essa cor no produto unitário — não arrisca, cai no padrão fixo
    resolvidos.push(cor.id);
  }
  // agrupa (ex: "Azul Marinho + Azul Marinho" vira 1 entrada com quantidade 2, não 2 abates separados)
  const porVariante = new Map();
  resolvidos.forEach((varianteId) => porVariante.set(varianteId, (porVariante.get(varianteId) || 0) + 1));
  return { produtoBaseId, porVariante };
}
async function baixarEstoqueVenda(produto, varianteId, quantidadeVendida) {
  if (produto.ehKit) {
    const resolvido = varianteId ? resolverComponentesKitPorCombo(produto.id, varianteId) : null;
    if (resolvido) {
      // achou a combinação certa (ex: Amarelo Bebê + Branco) — abate cada cor do produto
      // unitário na quantidade certa, multiplicada por quantos kits foram vendidos
      for (const [varId, qtdNaCombo] of resolvido.porVariante.entries()) {
        const cor = state.variantes.find((v) => v.id === varId);
        if (cor) await updateVarianteEstoque(varId, cor.estoqueAtual - (qtdNaCombo * quantidadeVendida));
      }
      return;
    }
  }
  if (produto.ehKit) {
    const componentes = state.kitComponentes.filter((k) => k.produtoKitId === produto.id);
    for (const comp of componentes) {
      const qtdBaixar = comp.quantidade * quantidadeVendida;
      if (comp.componenteVarianteId) {
        const variante = state.variantes.find((v) => v.id === comp.componenteVarianteId);
        if (variante) await updateVarianteEstoque(variante.id, variante.estoqueAtual - qtdBaixar);
      } else {
        const componenteProduto = state.produtos.find((p) => p.id === comp.componenteProdutoId);
        if (componenteProduto) await updateProdutoEstoque(componenteProduto.id, componenteProduto.estoqueAtual - qtdBaixar);
      }
    }
  } else if (varianteId) {
    const variante = state.variantes.find((v) => v.id === varianteId);
    if (variante) await updateVarianteEstoque(variante.id, variante.estoqueAtual - quantidadeVendida);
  } else {
    await updateProdutoEstoque(produto.id, produto.estoqueAtual - quantidadeVendida);
  }
}
// salva os componentes de um kit — apaga os antigos e grava os novos de uma vez, e marca o
// produto como kit (ou desmarca, se a lista vier vazia)
async function salvarComponentesKit(produtoKitId, componentes) {
  const { error: errDelete } = await sb.from('kit_componentes').delete().eq('produto_kit_id', produtoKitId);
  if (errDelete) { alert('Erro ao limpar a composição antiga do kit: ' + errDelete.message + '\n\nNão continuei pra não duplicar os componentes.'); return; }
  if (componentes.length > 0) {
    const { error } = await sb.from('kit_componentes').insert(componentes.map((c) => ({
      produto_kit_id: produtoKitId, componente_produto_id: c.produtoId, componente_variante_id: c.varianteId || null, quantidade: c.quantidade,
    })));
    if (error) { alert('Erro ao salvar componentes do kit: ' + error.message); return; }
  }
  const { error: errProduto } = await sb.from('produtos').update({ eh_kit: componentes.length > 0 }).eq('id', produtoKitId);
  if (errProduto) alert('Erro ao marcar produto como kit: ' + errProduto.message);
}
// acumula pedidos/unidades/faturamento por plataforma+dia, de TODA venda importada — não
// depende de o SKU já estar vinculado a um produto, pra "pedidos" e "ticket médio" ficarem
// certos desde a hora da importação, sem esperar vincular nada. Tenta de novo automaticamente
// se alguma chamada falhar (acontece às vezes por excesso de chamadas seguidas), e avisa se
// mesmo assim não conseguir — pra não ficar um resumo incompleto sem ninguém saber
async function acumularResumoDiario(mapaResumo) {
  const falhas = [];
  for (const [chave, info] of mapaResumo.entries()) {
    const [plataformaNome, data] = chave.split('|');
    let sucesso = false;
    for (let tentativa = 0; tentativa < 3 && !sucesso; tentativa++) {
      if (tentativa > 0) await new Promise((resolve) => setTimeout(resolve, 600));
      const { data: existente, error: errSel } = await sb.from('vendas_resumo_diario').select('*').eq('plataforma_nome', plataformaNome || '').eq('data', data).maybeSingle();
      if (errSel) continue;
      if (existente) {
        const { error: errUp } = await sb.from('vendas_resumo_diario').update({
          pedidos: Number(existente.pedidos) + info.pedidos,
          unidades: Number(existente.unidades) + info.unidades,
          faturamento: Number(existente.faturamento) + info.faturamento,
        }).eq('id', existente.id);
        sucesso = !errUp;
      } else {
        const { error: errIns } = await sb.from('vendas_resumo_diario').insert({
          plataforma_nome: plataformaNome || null, data, pedidos: info.pedidos, unidades: info.unidades, faturamento: info.faturamento,
        });
        sucesso = !errIns;
      }
    }
    if (!sucesso) falhas.push(`${plataformaNome || 'sem plataforma'} (${data})`);
  }
  if (falhas.length > 0) {
    alert(`Aviso: o resumo de "Pedidos" pode ficar incompleto pra: ${falhas.join(', ')}. As vendas em si foram importadas normal (isso não afeta faturamento nem estoque) — só o contador de pedidos desses dias pode ficar menor do que deveria. Se notar isso, me avisa.`);
  }
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
  const novosIds = [];
  for (const [, info] of pendentesMap.entries()) {
    const sku = info.sku;
    const varianteNorm = (info.varianteTexto || '').trim().toLowerCase();
    const existente = state.vendasSkuPendentes.find((v) => v.sku.trim().toLowerCase() === sku.trim().toLowerCase() && (v.varianteTexto || '').trim().toLowerCase() === varianteNorm);
    if (existente) {
      const { error } = await sb.from('vendas_sku_pendentes').update({
        quantidade: existente.quantidade + info.qtd,
        faturamento: existente.faturamento + info.faturamento,
        pedidos: (existente.pedidos || 0) + (info.pedidos || info.qtd),
        taxa: (existente.taxa || 0) + (info.taxa || 0),
        ultima_data: info.ultimaData > existente.ultimaData ? info.ultimaData : existente.ultimaData,
      }).eq('id', existente.id);
      if (error) console.error(error);
    } else {
      const { data, error } = await sb.from('vendas_sku_pendentes').insert({
        sku, quantidade: info.qtd, faturamento: info.faturamento, pedidos: info.pedidos || info.qtd, taxa: info.taxa || 0, ultima_data: info.ultimaData, plataforma_nome: info.plataformaNome || null,
        descricao: info.descricao || null, variante_texto: info.varianteTexto || null,
      }).select('id').single();
      if (error) console.error(error);
      else if (data) novosIds.push(data.id);
    }
  }
  return novosIds;
}
// vincula um SKU pendente a um produto (e, opcionalmente, a uma cor específica): salva o
// SKU como apelido do produto ou da cor (pra próximos imports já entrarem automático) e
// aplica a baixa de estoque retroativa acumulada no lugar certo
// o texto da variação (ex: "Preto,Único 36 a 42") costuma vir com vírgula dentro (separando
// cor e tamanho) — como os vínculos salvos também são separados por vírgula, essa vírgula
// interna quebrava o vínculo no lugar errado e ele nunca mais batia depois. Troca a vírgula
// de dentro do texto por ponto-e-vírgula antes de usar, sem mexer na vírgula que separa
// vínculos diferentes
const normalizarVarianteTexto = (texto) => (texto || '').trim().replace(/,/g, ';');
// verifica se o SKU puro (sem o texto da variação) já está vinculado a outra cor DIFERENTE
// dessa — se estiver, não é seguro cadastrar o SKU puro aqui também (voltaria a ficar
// ambíguo, igual o bug que já corrigimos antes). Se não estiver, vale a pena cadastrar o SKU
// puro como vínculo extra: protege contra o texto da variação vir formatado diferente entre
// um import e outro (ex: "Vermelho,Único 36 a 42" vs "Vermelho, Único 36 a 42"), que senão
// faz o mesmo SKU parecer "novo" de novo e nunca sair da lista de pendentes
function skuBaseSeguroPraRegistrar(skuBase, produtoId, varianteIdAlvo) {
  const key = skuBase.trim().toLowerCase();
  return !state.variantes.some((v) => v.produtoId === produtoId && v.id !== varianteIdAlvo && (v.skuVariante || '').split(',').some((s) => s.trim().toLowerCase() === key));
}
async function vincularSkuPendente(pendenteId, produtoId, varianteId) {
  const pendente = state.vendasSkuPendentes.find((v) => v.id === pendenteId);
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (!pendente || !produto) return;
  // quando o SKU pendente tem um texto de variação (cor, ou combinação de cores no caso de
  // kit), salva o alias como "sku||variação" em vez do sku puro — assim, se o mesmo SKU for
  // reusado pra outras combinações no futuro (comum em kit com várias opções de cor), cada
  // combinação casa só com o vínculo certo, em vez de todas caírem no mesmo lugar
  const aliasSku = pendente.varianteTexto ? `${pendente.sku.trim()}||${normalizarVarianteTexto(pendente.varianteTexto)}` : pendente.sku.trim();
  const skuBase = pendente.sku.trim();
  if (produto.ehKit) {
    // kit não guarda estoque próprio — desconta direto dos componentes, multiplicado pela
    // quantidade de cada um. Se a combinação de cor foi identificada (varianteId aponta pra
    // uma "combo" do kit, ex: "Amarelo Bebê + Branco"), abate a cor certa do produto unitário
    const skusAtuais = (produto.sku || '').split(',').map((s) => s.trim()).filter(Boolean);
    const jaTemKit = (s) => skusAtuais.some((x) => x.toLowerCase() === s.toLowerCase());
    if (!jaTemKit(aliasSku)) skusAtuais.push(aliasSku);
    if (pendente.varianteTexto && !jaTemKit(skuBase) && skuBaseSeguroPraRegistrar(skuBase, produtoId, varianteId)) skusAtuais.push(skuBase);
    if (skusAtuais.join(', ') !== (produto.sku || '')) await updateProduto(produtoId, { ...produto, sku: skusAtuais.join(', ') });
    await baixarEstoqueVenda(produto, varianteId, pendente.quantidade);
    const novoTotalVendidoKit = (produto.totalVendido || 0) + pendente.quantidade;
    await registrarVendaProduto(produtoId, produto.estoqueAtual, novoTotalVendidoKit, pendente.ultimaData);
    await atualizarPrecoVendaMedio(produtoId, pendente.faturamento, pendente.quantidade);
    await baixarEstoquePorFichaTecnica(produtoId, pendente.quantidade, pendente.ultimaData);
    const { error: errDetalheKit } = await sb.from('vendas_detalhe').insert({
      produto_id: produtoId, variante_id: varianteId || null, plataforma_nome: pendente.plataformaNome || null, sku: pendente.sku,
      quantidade: pendente.quantidade, valor: pendente.faturamento, data: pendente.ultimaData, pedidos: pendente.pedidos || pendente.quantidade, taxa: pendente.taxa || 0,
    });
    if (errDetalheKit) { alert('Vinculei e já baixei o estoque, mas deu erro ao registrar o detalhe da venda (não vai aparecer no ranking/lucro): ' + errDetalheKit.message); return; }
    const { error: errDelPendenteKit } = await sb.from('vendas_sku_pendentes').delete().eq('id', pendenteId);
    if (errDelPendenteKit) alert('Vinculei certo, mas não consegui remover esse SKU da lista de pendentes: ' + errDelPendenteKit.message + '\n\nPode ficar duplicado se vincular de novo — exclui manualmente pela lixeira.');
    return;
  }
  if (varianteId) {
    const variante = state.variantes.find((v) => v.id === varianteId);
    if (variante) {
      const skusAtuaisCor = (variante.skuVariante || '').split(',').map((s) => s.trim()).filter(Boolean);
      const jaTemCor = (s) => skusAtuaisCor.some((x) => x.toLowerCase() === s.toLowerCase());
      if (!jaTemCor(aliasSku)) skusAtuaisCor.push(aliasSku);
      if (pendente.varianteTexto && !jaTemCor(skuBase) && skuBaseSeguroPraRegistrar(skuBase, produtoId, varianteId)) skusAtuaisCor.push(skuBase);
      if (skusAtuaisCor.join(', ') !== (variante.skuVariante || '')) await updateVarianteSku(varianteId, skusAtuaisCor.join(', '));
      await updateVarianteEstoque(varianteId, variante.estoqueAtual - pendente.quantidade);
    }
  } else {
    const skusAtuais = (produto.sku || '').split(',').map((s) => s.trim()).filter(Boolean);
    const jaTem = (s) => skusAtuais.some((x) => x.toLowerCase() === s.toLowerCase());
    if (!jaTem(aliasSku)) skusAtuais.push(aliasSku);
    if (pendente.varianteTexto && !jaTem(skuBase)) skusAtuais.push(skuBase);
    if (skusAtuais.join(', ') !== (produto.sku || '')) await updateProduto(produtoId, { ...produto, sku: skusAtuais.join(', ') });
  }
  // estoque geral do produto só é mexido quando não tem cor envolvida (produto sem variante)
  // — pode ficar negativo se vendeu mais do que tinha; volta a se ajustar sozinho quando
  // entrar produção nova (a próxima peça lançada soma em cima do saldo negativo)
  const novoEstoque = varianteId ? produto.estoqueAtual : produto.estoqueAtual - pendente.quantidade;
  const novoTotalVendido = (produto.totalVendido || 0) + pendente.quantidade;
  await registrarVendaProduto(produtoId, novoEstoque, novoTotalVendido, pendente.ultimaData);
  await atualizarPrecoVendaMedio(produtoId, pendente.faturamento, pendente.quantidade);
  await baixarEstoquePorFichaTecnica(produtoId, pendente.quantidade, pendente.ultimaData);
  const { error: errDetalhe } = await sb.from('vendas_detalhe').insert({
    produto_id: produtoId, variante_id: varianteId || null, plataforma_nome: pendente.plataformaNome || null, sku: pendente.sku,
    quantidade: pendente.quantidade, valor: pendente.faturamento, data: pendente.ultimaData, pedidos: pendente.pedidos || pendente.quantidade, taxa: pendente.taxa || 0,
  });
  if (errDetalhe) { alert('Vinculei e já baixei o estoque, mas deu erro ao registrar o detalhe da venda (não vai aparecer no ranking/lucro): ' + errDetalhe.message); return; }
  const { error } = await sb.from('vendas_sku_pendentes').delete().eq('id', pendenteId);
  if (error) alert('Erro ao remover SKU pendente: ' + error.message);
}
async function removerSkuPendente(id) {
  const { error } = await sb.from('vendas_sku_pendentes').delete().eq('id', id);
  if (error) alert('Erro ao remover SKU pendente: ' + error.message);
}
// guarda uma "foto" de como estava produtos/variantes/insumos ANTES do import, junto com
// os ids de tudo que foi criado — assim dá pra desfazer com segurança depois, sem duplicar
// nem deixar estoque errado, mesmo se algo der errado no meio do caminho
async function salvarImportacaoVendas(nomeArquivo, snapshot, transacaoIds, vendasDetalheIds, skuPendenteIds) {
  const { error } = await sb.from('importacoes_vendas').insert({
    nome_arquivo: nomeArquivo, snapshot, transacao_ids: transacaoIds, vendas_detalhe_ids: vendasDetalheIds, sku_pendente_ids: skuPendenteIds,
  });
  if (error) {
    console.error('Erro ao salvar histórico de importação: ' + error.message);
    alert('⚠️ A importação em si funcionou, mas não consegui salvar o histórico pra permitir desfazer depois (erro: ' + error.message + '). Se precisar reverter essa importação, use a ferramenta "Reverter por data" em Vendas.');
  }
}
// desfaz uma importação inteira: restaura estoque/total vendido/preço médio de produtos e
// variantes, restaura insumos, e apaga tudo que foi criado (lançamentos, detalhe de vendas,
// skus pendentes) — usa o snapshot gravado no momento da importação, não recalcula nada
async function desfazerImportacaoVendas(importacaoId) {
  const { data: importacao, error: errBusca } = await sb.from('importacoes_vendas').select('*').eq('id', importacaoId).single();
  if (errBusca || !importacao) { alert('Erro ao buscar a importação: ' + (errBusca?.message || 'não encontrada')); return false; }
  const snap = importacao.snapshot;
  for (const p of snap.produtos || []) {
    const { error: errP } = await sb.from('produtos').update({ estoque_atual: p.estoqueAtual, total_vendido: p.totalVendido, preco_venda_medio: p.precoVendaMedio }).eq('id', p.id);
    if (errP) { alert('Erro ao restaurar estoque de produto: ' + errP.message); return false; }
  }
  for (const v of snap.variantes || []) {
    const { error: errV } = await sb.from('variantes').update({ estoque_atual: v.estoqueAtual }).eq('id', v.id);
    if (errV) { alert('Erro ao restaurar estoque de variante: ' + errV.message); return false; }
  }
  for (const i of snap.insumos || []) {
    const { error: errI } = await sb.from('insumos').update({ quantidade_disponivel: i.quantidadeDisponivel, custo_medio_unitario: i.custoMedioUnitario }).eq('id', i.id);
    if (errI) { alert('Erro ao restaurar insumo: ' + errI.message); return false; }
  }
  if (importacao.transacao_ids?.length) {
    const { error: errTx, sobrou } = await deleteEmLotes('transacoes', importacao.transacao_ids);
    if (errTx) { alert('Erro ao apagar lançamentos dessa importação: ' + errTx.message); return false; }
    if (sobrou > 0) alert(`Aviso: tentei apagar ${importacao.transacao_ids.length} lançamento(s) dessa importação, mas ${sobrou} continuam lá mesmo depois de tentar de novo várias vezes. Pode ter alguma permissão bloqueando — confere no Supabase.`);
  }
  if (importacao.vendas_detalhe_ids?.length) {
    const { error: errVd, sobrou: sobrouVd } = await deleteEmLotes('vendas_detalhe', importacao.vendas_detalhe_ids);
    if (errVd) { alert('Erro ao apagar detalhe de vendas dessa importação: ' + errVd.message); return false; }
    if (sobrouVd > 0) alert(`Aviso: tentei apagar ${importacao.vendas_detalhe_ids.length} detalhe(s) de venda dessa importação, mas ${sobrouVd} continuam lá mesmo depois de tentar de novo várias vezes.`);
  }
  if (importacao.sku_pendente_ids?.length) {
    const { error: errSp } = await deleteEmLotes('vendas_sku_pendentes', importacao.sku_pendente_ids);
    if (errSp) { alert('Erro ao apagar SKUs pendentes dessa importação: ' + errSp.message); return false; }
  }
  const { error } = await sb.from('importacoes_vendas').update({ desfeita: true }).eq('id', importacaoId);
  if (error) { alert('Erro ao marcar importação como desfeita: ' + error.message); return false; }
  return true;
}
// pra importações antigas, feitas antes de existir o recurso de desfazer automático (sem
// snapshot salvo) — reconstrói o que dá pra reverter numa data específica: apaga os
// lançamentos de venda/taxa e o detalhe de vendas daquele dia, e devolve o estoque exato
// pra produtos sem cor. Produtos com cor ficam de fora da devolução automática, porque o
// sistema nunca guardou qual cor específica vendeu — só fica listado pra redistribuir na mão
function calcularPreviaReversaoPorData(dataInicio, dataFim) {
  const fim = dataFim || dataInicio;
  const vendasDoDia = state.vendasDetalhe.filter((v) => v.data >= dataInicio && v.data <= fim);
  const txVendaDoDia = state.tx.filter((t) => t.data >= dataInicio && t.data <= fim && t.tipo === 'entrada' && t.categoria.startsWith('Venda'));
  // só inclui aqui o que nasce JUNTO da importação de vendas (a taxa de cada venda é criada
  // na mesma hora que a venda). Cupom e Ads são importados em arquivos separados, então reverter
  // uma data de vendas não deve apagar esses — se precisar removê-los, é direto no Financeiro
  const txTaxaDoDia = state.tx.filter((t) => t.data >= dataInicio && t.data <= fim && t.tipo === 'saida' && t.categoria === 'Taxas de marketplace');
  const pendentesDoDia = state.vendasSkuPendentes.filter((v) => v.ultimaData >= dataInicio && v.ultimaData <= fim);
  // agrupa por produto + cor (quando a venda já tem a cor salva, dá pra devolver o estoque
  // certinho na cor certa — só cai em "sem saber a cor" pra vendas registradas ANTES desse
  // campo existir, ou quando realmente o produto não tem variante)
  const porChave = {};
  vendasDoDia.forEach((v) => {
    const chave = `${v.produtoId}|${v.varianteId || ''}`;
    if (!porChave[chave]) porChave[chave] = { produtoId: v.produtoId, varianteId: v.varianteId || null, qtd: 0 };
    porChave[chave].qtd += v.quantidade;
  });
  const semCor = [];
  const comCorConhecida = [];
  const comCorDesconhecida = [];
  Object.values(porChave).forEach((item) => {
    const produto = state.produtos.find((p) => p.id === item.produtoId);
    const vs = variantesDoProduto(item.produtoId);
    const nome = produto?.nome || 'Produto removido';
    if (vs.length === 0) {
      semCor.push({ produtoId: item.produtoId, nome, qtd: item.qtd });
    } else if (item.varianteId) {
      const variante = state.variantes.find((v) => v.id === item.varianteId);
      comCorConhecida.push({ produtoId: item.produtoId, varianteId: item.varianteId, nome: `${nome} — ${variante?.nome || 'cor removida'}`, qtd: item.qtd });
    } else {
      // venda antiga, registrada antes de guardar a cor — não tem como saber qual foi
      comCorDesconhecida.push({ produtoId: item.produtoId, nome, qtd: item.qtd });
    }
  });
  const comCor = comCorDesconhecida; // mantido pra não quebrar quem já usava esse nome
  return { vendasDoDia, txVendaDoDia, txTaxaDoDia, semCor, comCorConhecida, comCor, pendentesDoDia, totalValor: txVendaDoDia.reduce((a, t) => a + t.valor, 0) };
}
// apaga uma lista grande de ids em lotes pequenos — o Supabase recusa (Bad Request) quando
// a lista de ids na URL fica grande demais de uma vez só (acontece com 200+ registros).
// depois de tentar apagar tudo, CONFERE de verdade (via select) quais ids ainda existem, e
// tenta de novo só esses — até 3 vezes. Antes disso a pessoa tinha que repetir na mão até dar
// certo; agora o próprio sistema insiste sozinho quando esbarra num limite temporário do banco
async function deleteEmLotes(tabela, ids, tamanhoLote = 100) {
  let restantes = [...new Set(ids)]; // remove duplicado, se algum vier repetido na lista
  for (let tentativa = 0; tentativa < 3 && restantes.length > 0; tentativa++) {
    for (let i = 0; i < restantes.length; i += tamanhoLote) {
      const lote = restantes.slice(i, i + tamanhoLote);
      const { error } = await sb.from(tabela).delete().in('id', lote);
      if (error) return { error, count: ids.length - restantes.length };
    }
    // confere de verdade quem ainda existe, em vez de confiar só na resposta do delete
    const aindaExistem = [];
    for (let i = 0; i < restantes.length; i += tamanhoLote) {
      const lote = restantes.slice(i, i + tamanhoLote);
      const { data, error } = await sb.from(tabela).select('id').in('id', lote);
      if (error) return { error, count: ids.length - restantes.length };
      aindaExistem.push(...(data || []).map((r) => r.id));
    }
    restantes = aindaExistem;
    if (restantes.length > 0) await new Promise((resolve) => setTimeout(resolve, 800)); // respira antes de tentar de novo
  }
  return { error: null, count: ids.length - restantes.length, sobrou: restantes.length };
}
async function reverterVendasPorData(dataInicio, dataFim, apagarPendentesTambem) {
  const { vendasDoDia, txVendaDoDia, txTaxaDoDia, semCor, comCorConhecida, pendentesDoDia } = calcularPreviaReversaoPorData(dataInicio, dataFim);
  for (const item of semCor) {
    const produto = state.produtos.find((p) => p.id === item.produtoId);
    if (produto) {
      const { error: errEstoque } = await sb.from('produtos').update({
        estoque_atual: produto.estoqueAtual + item.qtd,
        total_vendido: Math.max(0, (produto.totalVendido || 0) - item.qtd),
      }).eq('id', produto.id);
      if (errEstoque) { alert(`Erro ao devolver estoque de "${item.nome}": ${errEstoque.message}`); return false; }
    }
  }
  // produto com cor CONHECIDA (venda salva com a variante certa) — devolve na cor certa, igual
  // já fazia com "sem cor". Só cai em manual mesmo quando a venda é antiga e não tem essa info.
  for (const item of comCorConhecida) {
    const variante = state.variantes.find((v) => v.id === item.varianteId);
    const produto = state.produtos.find((p) => p.id === item.produtoId);
    if (variante) {
      const { error: errEstoqueVar } = await sb.from('variantes').update({
        estoque_atual: variante.estoqueAtual + item.qtd,
      }).eq('id', variante.id);
      if (errEstoqueVar) { alert(`Erro ao devolver estoque de "${item.nome}": ${errEstoqueVar.message}`); return false; }
    }
    if (produto) {
      const { error: errTotalVendido } = await sb.from('produtos').update({
        total_vendido: Math.max(0, (produto.totalVendido || 0) - item.qtd),
      }).eq('id', produto.id);
      if (errTotalVendido) console.error('Erro ao ajustar total vendido:', errTotalVendido);
    }
  }
  const idsVenda = vendasDoDia.map((v) => v.id);
  const idsTx = [...txVendaDoDia, ...txTaxaDoDia].map((t) => t.id);
  if (idsVenda.length) {
    const { error: errVenda, sobrou } = await deleteEmLotes('vendas_detalhe', idsVenda);
    if (errVenda) { alert('Erro ao apagar detalhe de vendas: ' + errVenda.message); return false; }
    if (sobrou > 0) { alert(`Aviso: tentei apagar ${idsVenda.length} registro(s) de detalhe de vendas, mas ${sobrou} continuam lá mesmo depois de tentar de novo várias vezes. Pode ter alguma permissão bloqueando — confere no Supabase.`); }
  }
  if (idsTx.length) {
    const { error: errTx, sobrou: sobrouTx } = await deleteEmLotes('transacoes', idsTx);
    if (errTx) { alert('Erro ao apagar lançamentos: ' + errTx.message); return false; }
    if (sobrouTx > 0) { alert(`Aviso: tentei apagar ${idsTx.length} lançamento(s), mas ${sobrouTx} continuam lá mesmo depois de tentar de novo várias vezes. Pode ter alguma permissão bloqueando — confere no Supabase.`); }
  }
  const { error: errResumo } = await sb.from('vendas_resumo_diario').delete().gte('data', dataInicio).lte('data', dataFim || dataInicio);
  if (errResumo) console.error('Erro ao apagar resumo diário desse período:', errResumo);
  if (apagarPendentesTambem && pendentesDoDia.length) {
    const { error: errPendentes } = await sb.from('vendas_sku_pendentes').delete().in('id', pendentesDoDia.map((v) => v.id));
    if (errPendentes) { alert('Erro ao apagar SKUs pendentes: ' + errPendentes.message); return false; }
  }
  return true;
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
    const novoEstoque = produto.estoqueAtual - qtdTotal;
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
// mesma coisa que lancarVendaManual, mas pra quando a cliente levou VÁRIOS modelos numa
// venda só — cada item do carrinho vira sua própria linha de detalhe/preço médio (pra não
// misturar o preço de produtos diferentes), mas o dinheiro entra como 1 lançamento só no
// Financeiro (é 1 venda de verdade, só com vários itens dentro)
async function lancarVendaManualMultipla(itens, frete, canal, data) {
  if (!itens || itens.length === 0) return;
  const canalLabel = (canal || '').trim() || 'Venda direta';
  const valorTotalGeral = itens.reduce((a, it) => a + it.valor, 0);
  const descricaoPartes = itens.map((it) => `${it.produtoNome} x${it.qtdTotal}`);
  await addTx({
    tipo: 'entrada', valor: valorTotalGeral, categoria: `Venda ${canalLabel}`,
    descricao: descricaoPartes.join(', '), data,
  });
  if (frete > 0) {
    await addTx({
      tipo: 'entrada', valor: frete, categoria: 'Reembolso de frete',
      descricao: `Frete — ${descricaoPartes.join(', ')}`, data,
    });
  }
  const detalhesBatch = [];
  for (const it of itens) {
    const produto = state.produtos.find((p) => p.id === it.produtoId);
    if (!produto) continue;
    const vs = variantesDoProduto(it.produtoId);
    if (vs.length > 0) {
      for (const v of vs) {
        const qtdCor = it.coresQtd?.[v.id] || 0;
        if (qtdCor > 0) await updateVarianteEstoque(v.id, v.estoqueAtual - qtdCor);
      }
      const novoTotalVendido = (produto.totalVendido || 0) + it.qtdTotal;
      await registrarVendaProduto(it.produtoId, produto.estoqueAtual, novoTotalVendido, data);
    } else {
      const novoEstoque = produto.estoqueAtual - it.qtdTotal;
      const novoTotalVendido = (produto.totalVendido || 0) + it.qtdTotal;
      await registrarVendaProduto(it.produtoId, novoEstoque, novoTotalVendido, data);
    }
    await atualizarPrecoVendaMedio(it.produtoId, it.valor, it.qtdTotal);
    await baixarEstoquePorFichaTecnica(it.produtoId, it.qtdTotal, data);
    detalhesBatch.push({
      produtoId: it.produtoId, plataformaId: null, plataformaNome: canalLabel,
      sku: (produto.sku || '').split(',')[0]?.trim() || null, quantidade: it.qtdTotal, valor: it.valor, data,
    });
  }
  // insumos por pedido (envelope, etiqueta de rastreio) contam 1x pro PEDIDO inteiro — não
  // multiplica pela quantidade de modelos diferentes que vieram juntos na mesma caixa
  const insumosEnvio = state.insumos.filter((i) => i.usadoNoEnvio);
  for (const insumo of insumosEnvio) {
    await baixarInsumo(insumo.id, insumo.qtdVendaManual);
  }
  await addVendasDetalheBatch(detalhesBatch);
}
async function updateProduto(id, p) {
  const { error } = await sb.from('produtos').update({
    nome: p.nome, sku: p.sku || null, estoque_atual: p.estoqueAtual, estoque_minimo: p.estoqueMinimo, custo_unitario: p.custoUnitario, custo_estimado: !!p.custoEstimado, valor_mao_obra: p.valorMaoObra || 0, tipo: p.tipo || 'unitario',
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
// custo total = tecido/corte + mão de obra + (insumos da ficha × custo) + (produtos componentes × custo total deles, recursivo)
// pra kits (produto.tipo === 'kit'), os componentes vêm de kit_componentes (a mesma composição
// com cor que desconta o estoque de verdade quando vende) — não da ficha técnica genérica —
// pra não ter duas fontes de composição desencontradas (uma só de custo, outra só de estoque)
function calcularCustoTotalProduto(produtoId, visitados) {
  visitados = visitados || new Set();
  if (visitados.has(produtoId)) return 0; // evita loop infinito se alguém criar uma referência circular
  // cada chamada recursiva recebe sua PRÓPRIA cópia do caminho percorrido (visitados + esse
  // produto) — assim, quando um kit repete o mesmo produto base em vários slots (ex: 4 cores
  // do mesmo "Top Joy"), cada slot consegue contar o custo dele, em vez do 2º em diante ser
  // barrado por engano como se fosse referência circular
  const proximoVisitados = new Set(visitados);
  proximoVisitados.add(produtoId);
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (!produto) return 0;
  let total = (produto.custoUnitario || 0) + (produto.valorMaoObra || 0);
  fichaTecnicaDoProduto(produtoId).forEach((item) => {
    if (item.tipoItem === 'insumo') {
      const insumo = state.insumos.find((i) => i.id === item.insumoId);
      if (insumo) total += insumo.custoMedioUnitario * item.quantidade;
    } else if (item.tipoItem === 'produto' && produto.tipo !== 'kit') {
      total += calcularCustoTotalProduto(item.componenteProdutoId, proximoVisitados) * item.quantidade;
    }
  });
  if (produto.tipo === 'kit') {
    state.kitComponentes.filter((k) => k.produtoKitId === produtoId).forEach((k) => {
      total += calcularCustoTotalProduto(k.componenteProdutoId, proximoVisitados) * k.quantidade;
    });
  }
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
  if (error) { alert('Erro ao excluir ficha técnica: ' + error.message); return; }
  // pra kits, a composição de verdade (com cor) mora em kit_componentes, não em ficha_tecnica_itens
  // — precisa limpar os dois, senão o kit continua descontando estoque da composição antiga
  const produto = state.produtos.find((p) => p.id === produtoId);
  if (produto?.tipo === 'kit') await salvarComponentesKit(produtoId, []);
}
// desconta do estoque os insumos (momento = venda) e produtos-componentes da ficha técnica,
// proporcional à quantidade vendida
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
        const novoEstoque = componente.estoqueAtual - qtdConsumida;
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

async function updatePlataformaTaxa(id, taxaPercentual, taxaFixa, taxaFaixas) {
  const { error } = await sb.from('plataformas').update({
    taxa_percentual: taxaPercentual, taxa_fixa: taxaFixa, taxa_faixas: taxaFaixas || [],
  }).eq('id', id);
  if (error) alert('Erro ao salvar taxa: ' + error.message);
}
// corrige retroativamente vendas que ficaram com taxa zerada (ex: SKU vinculado manualmente
// antes da coluna de taxa existir, ou import de um período sem faixa configurada ainda) —
// usa a config de taxa ATUAL de cada plataforma pra estimar o que devia ter sido cobrado
async function recalcularTaxasFaltantes() {
  const semTaxa = state.vendasDetalhe.filter((v) => (!v.taxa || v.taxa === 0) && v.plataformaNome && v.valor > 0 && v.quantidade > 0);
  if (semTaxa.length === 0) { alert('Não achei nenhuma venda com taxa zerada — já tá tudo certo.'); return; }
  let corrigidas = 0;
  let semPlataformaConfigurada = 0;
  for (const v of semTaxa) {
    const plataforma = state.plataformas.find((p) => p.nome.trim().toLowerCase() === v.plataformaNome.trim().toLowerCase());
    if (!plataforma) { semPlataformaConfigurada++; continue; }
    const valorUnitario = v.valor / v.quantidade;
    const { pct, fixa } = taxaDaPlataformaParaValor(plataforma, valorUnitario);
    if (pct <= 0 && fixa <= 0) { semPlataformaConfigurada++; continue; }
    const taxaEstimada = Math.round((v.valor * (pct / 100) + fixa * v.quantidade) * 100) / 100;
    if (taxaEstimada <= 0) continue;
    const { error } = await sb.from('vendas_detalhe').update({ taxa: taxaEstimada }).eq('id', v.id);
    if (error) continue;
    // a taxa de vendas_detalhe é usada pelo Lucro bruto da aba Vendas, mas o DRE e o Financeiro
    // olham pra um LANÇAMENTO separado (categoria "Taxas de marketplace") - sem isso, o DRE
    // continuava sem essa despesa mesmo depois de corrigido aqui. Cria o lançamento que faltava
    const { error: errTx } = await sb.from('transacoes').insert({
      tipo: 'saida', valor: taxaEstimada, categoria: 'Taxas de marketplace', natureza: 'variavel',
      descricao: `Taxa recalculada (correção retroativa) ${plataforma.nome} — SKU ${v.sku}`, data: v.data,
    });
    if (!errTx) corrigidas++;
  }
  const avisoIncompleto = semPlataformaConfigurada > 0 ? (' ' + semPlataformaConfigurada + ' venda(s) não deu pra corrigir — plataforma sem taxa cadastrada ou nome da plataforma não bate com nenhuma cadastrada (confere em Financeiro → ⚙️ Taxas).') : '';
  alert('Pronto! ' + corrigidas + ' venda(s) corrigida(s) com a taxa estimada pela faixa atual da plataforma (já lançada no Financeiro/DRE também).' + avisoIncompleto);
  await loadData();
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
    cpf: dados.cpf || null, cargo: dados.cargo || null, matricula: dados.matricula || null, email: dados.email || null,
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
  if (error) { alert('Erro ao bater ponto: ' + error.message); return false; }
  return true;
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
      funcionaria_id: funcionariaId, data: todayStr(), mes_referencia: data.slice(0, 7), tipo: 'debito', horas: -horasParciais,
      descricao: `${formatarHorasMin(horasParciais)} usadas do saldo em ${dataFmt}${motivo ? ' — ' + motivo : ''}`,
    });
    if (errBanco) console.error(errBanco);
  }
}
async function removeAbono(id) {
  const { error } = await sb.from('abonos_ponto').delete().eq('id', id);
  if (error) alert('Erro ao remover abono: ' + error.message);
}
// edita um lançamento manual do banco de horas (corrige tipo/horas/descrição de algo já lançado)
async function updateBancoHorasLancamento(id, tipo, horas, descricao, mesReferencia) {
  const { error } = await sb.from('banco_horas_lancamentos').update({
    tipo, horas: tipo === 'debito' ? -Math.abs(horas) : Math.abs(horas), descricao: descricao || null, mes_referencia: mesReferencia || null,
  }).eq('id', id);
  if (error) alert('Erro ao editar lançamento: ' + error.message);
}
async function removeBancoHorasLancamento(id) {
  const { error } = await sb.from('banco_horas_lancamentos').delete().eq('id', id);
  if (error) alert('Erro ao remover lançamento: ' + error.message);
}
// fecha o holerite de um mês: grava o registro congelado, lança a saída no Financeiro
// (se as horas extras forem pagas em dinheiro), e movimenta o banco de horas (crédito se
// escolheu banco pras extras, débito sempre que tem falta não abonada)
// registra um adiantamento/vale — lança a saída no Financeiro na data escolhida (pode ser uma
// data passada, tipo ontem) e guarda o vínculo com a funcionária + mês, pra descontar
// automático quando fechar o holerite daquele mês
async function registrarAdiantamento(funcionariaId, data, valor, motivo) {
  const funcionaria = state.funcionarias.find((f) => f.id === funcionariaId);
  const tx = await addTx({
    tipo: 'saida', valor, categoria: 'Funcionários — salário', natureza: 'fixo',
    descricao: `Adiantamento/vale — ${funcionaria?.nome || ''}${motivo ? ` (${motivo})` : ''}`, data,
  });
  const { error } = await sb.from('adiantamentos').insert({
    funcionaria_id: funcionariaId, data, valor, motivo: motivo || null, transacao_id: tx ? tx.id : null,
  });
  if (error) alert('Erro ao registrar adiantamento: ' + error.message);
}
async function removerAdiantamento(id) {
  const a = state.adiantamentos.find((x) => x.id === id);
  if (a?.transacaoId) await removeTx(a.transacaoId);
  const { error } = await sb.from('adiantamentos').delete().eq('id', id);
  if (error) alert('Erro ao remover adiantamento: ' + error.message);
}
async function fecharHolerite(funcionaria, mesKey, resumo, modoHorasExtras, valorVtFinal, valorVrFinal, dataPagamento) {
  const dataLancamento = dataPagamento || todayStr();
  // adiantamento/vale já pago nesse mês desconta do total — já saiu da conta antes, não pode
  // sair de novo no fechamento
  const totalAdiantamentosMes = state.adiantamentos.filter((a) => a.funcionariaId === funcionaria.id && a.data.slice(0, 7) === mesKey).reduce((acc, a) => acc + a.valor, 0);
  const resumoFerias = calcularValorFerias(funcionaria, mesKey);
  const valorFeriasComTerco = resumoFerias.valorFeriasGozadas + resumoFerias.tercoFerias;
  const valorAbonoComTerco = resumoFerias.valorAbono + resumoFerias.tercoAbono;
  const totalPagar = resumo.salarioBase
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras : 0)
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras100 : 0)
    + valorVtFinal + valorVrFinal + valorFeriasComTerco + valorAbonoComTerco - totalAdiantamentosMes;
  const { error: errHolerite } = await sb.from('holerites').upsert({
    funcionaria_id: funcionaria.id, mes: mesKey, dias_trabalhados: resumo.diasTrabalhados,
    salario_base: resumo.salarioBase, horas_extras: resumo.horasExtras, valor_horas_extras: resumo.valorHorasExtras,
    horas_extras_100: resumo.horasExtras100, valor_horas_extras_100: resumo.valorHorasExtras100,
    modo_horas_extras: modoHorasExtras, horas_faltantes: resumo.horasFaltantes,
    valor_vt: valorVtFinal, valor_vr: valorVrFinal, total_pagar: totalPagar,
    valor_ferias: resumoFerias.valorFeriasGozadas, valor_abono_pecuniario: resumoFerias.valorAbono,
    dias_ferias_gozados: resumoFerias.diasGozados, dias_vendidos: resumoFerias.diasVendidos,
    emitido_por: state.papel,
  }, { onConflict: 'funcionaria_id,mes' });
  if (errHolerite) { alert('Erro ao fechar holerite: ' + errHolerite.message); return; }

  const mesLabelTexto = new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  // o adiantamento desconta primeiro do salário/extras (a parte mais provável de ter sido
  // "adiantada"), sem deixar o valor lançado ficar negativo
  const valorSalarioEExtrasBruto = resumo.salarioBase
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras : 0)
    + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras100 : 0);
  const valorSalarioEExtras = Math.max(0, valorSalarioEExtrasBruto - totalAdiantamentosMes);
  const valorBeneficios = valorVtFinal + valorVrFinal;
  if (valorSalarioEExtras > 0) {
    await addTx({
      tipo: 'saida', valor: valorSalarioEExtras, categoria: 'Funcionários — salário', natureza: 'fixo',
      descricao: `Holerite ${funcionaria.nome} — ${mesLabelTexto}${totalAdiantamentosMes > 0 ? ` (já descontado ${fmt(totalAdiantamentosMes)} de adiantamento)` : ''}`, data: dataLancamento,
    });
  }
  if (valorBeneficios > 0) {
    await addTx({
      tipo: 'saida', valor: valorBeneficios, categoria: 'Funcionários — encargos/benefícios', natureza: 'fixo',
      descricao: `Auxílio Transporte + Alimentação ${funcionaria.nome} — ${mesLabelTexto}`, data: dataLancamento,
    });
  }
  if (valorFeriasComTerco + valorAbonoComTerco > 0) {
    const partes = [];
    if (valorFeriasComTerco > 0) partes.push(`${resumoFerias.diasGozados} dia(s) de recesso`);
    if (valorAbonoComTerco > 0) partes.push(`${resumoFerias.diasVendidos} dia(s) vendido(s)`);
    await addTx({
      tipo: 'saida', valor: valorFeriasComTerco + valorAbonoComTerco, categoria: 'Funcionários — recesso/dias vendidos', natureza: 'fixo',
      descricao: `Recesso ${funcionaria.nome} — ${partes.join(' + ')}, com adicional — ${mesLabelTexto}`, data: dataLancamento,
    });
  }

  if (modoHorasExtras === 'banco' && resumo.horasExtras > 0) {
    const { error } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionaria.id, data: dataLancamento, mes_referencia: mesKey, tipo: 'credito', horas: resumo.horasExtras,
      descricao: `Horas extras de ${mesLabelTexto} convertidas em banco de horas`,
    });
    if (error) console.error(error);
  }
  if (modoHorasExtras === 'banco' && resumo.horasExtras100 > 0) {
    // domingo/feriado credita em dobro no banco de horas (1h trabalhada = 2h de folga depois)
    const { error } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionaria.id, data: dataLancamento, mes_referencia: mesKey, tipo: 'credito', horas: resumo.horasExtras100 * 2,
      descricao: `Horas de domingo/feriado de ${mesLabelTexto} convertidas em banco de horas (em dobro)`,
    });
    if (error) console.error(error);
  }
  if (resumo.horasFaltantes > 0) {
    const { error } = await sb.from('banco_horas_lancamentos').insert({
      funcionaria_id: funcionaria.id, data: dataLancamento, mes_referencia: mesKey, tipo: 'debito', horas: -resumo.horasFaltantes,
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
async function salvarConfigEmailJS(serviceId, templateId, publicKey) {
  const { error } = await sb.from('empresa_config').upsert({
    id: 1, emailjs_service_id: serviceId || null, emailjs_template_id: templateId || null, emailjs_public_key: publicKey || null,
  });
  if (error) alert('Erro ao salvar configuração de e-mail: ' + error.message);
}
// a funcionária confirma (assina eletronicamente, desenhando o nome na tela) o holerite
// dela, pelo próprio celular — fica registrado com data/hora + a imagem da assinatura
async function confirmarAssinaturaHolerite(id, imagemBase64) {
  const { error } = await sb.from('holerites').update({ assinado_em: new Date().toISOString(), assinatura_imagem: imagemBase64 || null }).eq('id', id);
  if (error) alert('Erro ao confirmar: ' + error.message);
}
async function addFeriasTirada(funcionariaId, dataInicio, dataFim, diasVendidos, mesReferenciaPagamento) {
  const { error } = await sb.from('ferias_tiradas').insert({
    funcionaria_id: funcionariaId, data_inicio: dataInicio, data_fim: dataFim,
    dias_vendidos: diasVendidos || 0, mes_referencia_pagamento: mesReferenciaPagamento || null,
  });
  if (error) alert('Erro ao registrar recesso: ' + error.message);
}
async function updateFeriasTirada(id, dataInicio, dataFim, diasVendidos, mesReferenciaPagamento) {
  const { error } = await sb.from('ferias_tiradas').update({
    data_inicio: dataInicio, data_fim: dataFim, dias_vendidos: diasVendidos || 0, mes_referencia_pagamento: mesReferenciaPagamento || null,
  }).eq('id', id);
  if (error) alert('Erro ao atualizar recesso: ' + error.message);
}
// valor do dia pra cálculo de férias/abono — mensalista usa salário÷30 (padrão CLT); por
// hora usa a média de horas dos dias que ela trabalha na semana (pra não pegar só um dia
// específico que pode não ser representativo)
function valorDiaFerias(funcionaria) {
  if (funcionaria.tipoPagamento === 'mensal') return (funcionaria.salarioMensal || 0) / 30;
  const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => (funcionaria.jornadaSemanal[d] ? funcionaria.jornadaSemanal[d].trabalha : (d >= 1 && d <= 5)));
  if (dias.length === 0) return 0;
  const totalMinutos = dias.reduce((a, d) => a + minutosEsperadosDoDiaSemana(funcionaria, d).minutos, 0);
  const mediaHorasDia = (totalMinutos / dias.length) / 60;
  return mediaHorasDia * (funcionaria.valorHora || 0);
}
// calcula férias gozadas + abono pecuniário (venda de dias) de um mês específico, cada um
// com o 1/3 constitucional — usa o "mês de referência de pagamento" quando cadastrado,
// senão cai no mês em que as férias começam (regra de pagar até 2 dias antes de começar)
function calcularValorFerias(funcionaria, mesKey) {
  const registros = state.feriasTiradas.filter((v) => v.funcionariaId === funcionaria.id && (v.mesReferenciaPagamento || v.dataInicio.slice(0, 7)) === mesKey);
  const valorDia = valorDiaFerias(funcionaria);
  let diasGozados = 0;
  let diasVendidos = 0;
  registros.forEach((v) => {
    diasGozados += Math.round((new Date(v.dataFim + 'T00:00:00') - new Date(v.dataInicio + 'T00:00:00')) / 86400000) + 1;
    diasVendidos += v.diasVendidos || 0;
  });
  const valorFeriasGozadas = diasGozados * valorDia;
  const tercoFerias = valorFeriasGozadas / 3;
  const valorAbono = diasVendidos * valorDia;
  const tercoAbono = valorAbono / 3;
  return { diasGozados, diasVendidos, valorDia, valorFeriasGozadas, tercoFerias, valorAbono, tercoAbono, total: valorFeriasGozadas + tercoFerias + valorAbono + tercoAbono };
}
async function removeFeriasTirada(id) {
  const { error } = await sb.from('ferias_tiradas').delete().eq('id', id);
  if (error) alert('Erro ao remover registro de recesso: ' + error.message);
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
  'aquisitivo': { label: '🔵 Acumulando', color: 'var(--text-muted)' },
  'em-dia': { label: '🟢 Em dia', color: 'var(--teal)' },
  'vencendo': { label: '🟡 Vencendo em breve', color: 'var(--amber)' },
  'vencidas': { label: '🔴 Atrasadas', color: 'var(--red)' },
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
// formata o CNPJ no padrão XX.XXX.XXX/XXXX-XX — sem mascarar, porque CNPJ é registro
// público de empresa, normal aparecer completo em documentos comerciais (nota, recibo etc)
function formatarCnpj(cnpj) {
  const digitos = (cnpj || '').replace(/\D/g, '');
  if (digitos.length !== 14) return cnpj || '';
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
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
  return minutosEsperadosDoDiaSemana(funcionaria, diaSemana);
}
// mesma lógica de jornadaEsperadaDoDia, mas recebe o dia da semana (0=domingo..6=sábado)
// direto, sem precisar de uma data real — usado quando só importa "quanto ela trabalha
// numa terça", não uma terça específica do calendário (ex: cálculo do valor do dia de férias)
function minutosEsperadosDoDiaSemana(funcionaria, diaSemana) {
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
  if (porTipo.volta_almoco && porTipo.saida) horasTrabalhadas += (porTipo.saida - porTipo.volta_almoco) / 3600000;
  // se bateu só entrada e saída (sem almoço registrado), calcula direto
  if (porTipo.entrada && porTipo.saida && !porTipo.saida_almoco && !porTipo.volta_almoco) {
    horasTrabalhadas = (porTipo.saida - porTipo.entrada) / 3600000;
  }
  const esperado = jornadaEsperadaDoDia(funcionaria, dataStr);
  const jornadaEsperada = esperado.minutos / 60;
  const completo = !!(porTipo.entrada && porTipo.saida);
  return { horasTrabalhadas, jornadaEsperada, diferenca: horasTrabalhadas - jornadaEsperada, completo, porTipo, diaTrabalhavel: esperado.trabalha };
}
// resume o mês inteiro pra fechar o holerite: dias trabalhados, horas extras, horas
// faltantes (só as não abonadas), e o salário base (mensal fixo ou por hora trabalhada)
// extrato do banco de horas de um mês: quanto ela já tinha antes, quanto creditou/debitou
// dentro do mês, e o saldo final — pra mostrar aberto no holerite, não só o total corrido
function calcularExtratoBancoHoras(funcionariaId, mesKey) {
  const primeiroDiaMes = `${mesKey}-01`;
  const [ano, mes] = mesKey.split('-').map(Number);
  const ultimoDiaMes = `${mesKey}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;
  const lancamentos = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === funcionariaId);
  // usa o "mês de referência" quando ele existir (guardado separado da data real do
  // lançamento) — assim um saldo de julho que só foi lançado em agosto (ex: fechamento de
  // folha feito com atraso) continua contando como "de julho", sem precisar mexer na data
  // real do registro (que fica intacta, pra auditoria)
  const chaveMes = (b) => b.mesReferencia || b.data.slice(0, 7);
  const saldoAnterior = lancamentos.filter((b) => chaveMes(b) < mesKey).reduce((a, b) => a + b.horas, 0);
  const doMes = lancamentos.filter((b) => chaveMes(b) === mesKey);
  const produzido = doMes.filter((b) => b.horas > 0).reduce((a, b) => a + b.horas, 0);
  const consumido = doMes.filter((b) => b.horas < 0).reduce((a, b) => a + Math.abs(b.horas), 0);
  const saldoFinal = saldoAnterior + produzido - consumido;
  return { saldoAnterior, produzido, consumido, saldoFinal };
}
// conta quantos dias de atestado, abono/folga e férias caíram dentro do mês — pro
// resumo da jornada no holerite
function calcularResumoOcorrencias(funcionariaId, mesKey) {
  const abonosNoMes = state.abonosPonto.filter((a) => a.funcionariaId === funcionariaId && a.data.slice(0, 7) === mesKey);
  const diasAtestado = abonosNoMes.filter((a) => a.tipo === 'atestado').length;
  const diasAbono = abonosNoMes.filter((a) => a.tipo !== 'atestado').length;
  const [ano, mes] = mesKey.split('-').map(Number);
  const inicioMes = `${mesKey}-01`;
  const fimMes = `${mesKey}-${String(new Date(ano, mes, 0).getDate()).padStart(2, '0')}`;
  const diasFerias = state.feriasTiradas
    .filter((v) => v.funcionariaId === funcionariaId && v.dataInicio <= fimMes && v.dataFim >= inicioMes)
    .reduce((acc, v) => {
      const inicio = v.dataInicio < inicioMes ? inicioMes : v.dataInicio;
      const fim = v.dataFim > fimMes ? fimMes : v.dataFim;
      const dias = Math.round((new Date(fim + 'T00:00:00') - new Date(inicio + 'T00:00:00')) / 86400000) + 1;
      return acc + Math.max(0, dias);
    }, 0);
  return { diasAtestado, diasAbono, diasFerias };
}
// conta quantos sábados caem entre duas datas (inclusive) e calcula o débito de
// compensação — NUNCA desconta um sábado que ainda não aconteceu (mesmo que já esteja
// dentro do mês corrente), só os que já passaram até hoje. E nunca conta mais que 4
// sábados por mês civil, mesmo que o mês tenha 5 — assim a funcionária nunca paga a mais só
// porque o calendário desse mês específico "sobrou" um sábado a mais (isso sobe 4h por
// semana que passa, sempre travando em 16h no total, nunca chegando em 20h)
function calcularDebitoCompensacaoSabado(funcionaria, dataInicioStr, dataFimStr) {
  if (!funcionaria.horasCompensacaoSemanal || funcionaria.horasCompensacaoSemanal <= 0) return 0;
  const hoje = todayStr();
  const fimReal = dataFimStr > hoje ? hoje : dataFimStr;
  if (fimReal < dataInicioStr) return 0;
  const sabadosPorMes = {};
  const cursor = new Date(dataInicioStr + 'T00:00:00');
  const fim = new Date(fimReal + 'T00:00:00');
  while (cursor <= fim) {
    if (cursor.getDay() === 6) {
      const mesKeyCursor = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      sabadosPorMes[mesKeyCursor] = (sabadosPorMes[mesKeyCursor] || 0) + 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  let totalSabados = 0;
  Object.values(sabadosPorMes).forEach((qtd) => { totalSabados += Math.min(qtd, 4); });
  return totalSabados * funcionaria.horasCompensacaoSemanal;
}
function calcularResumoHolerite(funcionaria, mesKey) {
  const [ano, mes] = mesKey.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  let diasTrabalhados = 0;
  let horasExtras = 0;
  let horasExtras100 = 0;
  let horasFaltantes = 0;
  let horasTrabalhadasTotal = 0;
  for (let dia = 1; dia <= ultimoDia; dia++) {
    const dataStr = `${mesKey}-${String(dia).padStart(2, '0')}`;
    if (funcionaria.dataAdmissao && dataStr < funcionaria.dataAdmissao) continue;
    const pontosDoDia = state.pontos.filter((p) => p.funcionariaId === funcionaria.id && p.data === dataStr);
    if (pontosDoDia.length === 0) continue;
    const calc = calcularHorasDia(pontosDoDia, funcionaria, dataStr);
    // dia incompleto (ex: bateu entrada e saída de almoço, mas foi embora passando mal e não
    // bateu o resto) NÃO é mais ignorado — conta as horas que ela realmente trabalhou (pelos
    // pontos que existem) e o resto da jornada vira falta, igual um dia normal. Só não desconta
    // se tiver abono pra esse dia — assim você decide, o sistema não assume sozinho
    diasTrabalhados++;
    horasTrabalhadasTotal += calc.horasTrabalhadas;
    // domingo ou feriado: todas as horas trabalhadas nesse dia pagam 100% (dobra), não entram
    // na conta normal de extra/falta
    const ehDomingo = new Date(dataStr + 'T00:00:00').getDay() === 0;
    const ehFeriado = state.feriados.some((fer) => fer.data === dataStr);
    if (ehDomingo || ehFeriado) {
      horasExtras100 += calc.horasTrabalhadas;
      continue;
    }
    if (calc.diferenca >= 0) {
      horasExtras += calc.diferenca;
    } else {
      const abono = state.abonosPonto.find((a) => a.funcionariaId === funcionaria.id && a.data === dataStr);
      if (!abono) {
        horasFaltantes += Math.abs(calc.diferenca);
      } else if (abono.horas != null) {
        // abono parcial: só abate a quantidade de horas informada, o resto continua contando
        horasFaltantes += Math.max(0, Math.abs(calc.diferenca) - abono.horas);
      }
      // abono sem horas definidas = dia inteiro abonado, não soma nada
    }
  }
  // as horas extras normais do mês abatem as faltas do mesmo mês antes de decidir se
  // sobra alguma coisa "a compensar" — sem isso, um dia com falta pequena virava débito
  // mesmo que ela tivesse feito bem mais hora extra em outros dias do mesmo mês. As horas
  // de domingo/feriado (100%) ficam de fora dessa conta, são um direito à parte.
  const horasExtrasBrutas = horasExtras;
  const horasFaltantesBrutas = horasFaltantes;
  horasExtras = Math.max(0, horasExtrasBrutas - horasFaltantesBrutas);
  horasFaltantes = Math.max(0, horasFaltantesBrutas - horasExtrasBrutas);

  // compensação de sábado (ou outro dia não trabalhado) acertada no fim do mês, em vez de
  // embutida na jornada de cada dia — desconta do líquido de extra/falta já calculado.
  // Só conta os sábados que já passaram (nunca um sábado futuro dentro do mês corrente)
  const debitoCompensacaoSabado = calcularDebitoCompensacaoSabado(funcionaria, `${mesKey}-01`, `${mesKey}-${String(ultimoDia).padStart(2, '0')}`);
  if (debitoCompensacaoSabado > 0) {
    const liquido = horasExtras - horasFaltantes - debitoCompensacaoSabado;
    horasExtras = Math.max(0, liquido);
    horasFaltantes = Math.max(0, -liquido);
  }

  const salarioBase = funcionaria.tipoPagamento === 'mensal' ? (funcionaria.salarioMensal || 0) : horasTrabalhadasTotal * (funcionaria.valorHora || 0);
  const valorHorasExtras = horasExtras * (funcionaria.valorHora || 0) * (1 + (funcionaria.percentualHoraExtra || 0) / 100);
  const valorHorasExtras100 = horasExtras100 * (funcionaria.valorHora || 0) * 2;
  const valorVt = funcionaria.valorVtDia || 0;
  const valorVr = funcionaria.valorVrDia || 0;
  // saldo antes da compensação de sábado (pra mostrar de onde veio o número final, sem ambiguidade)
  const saldoAntesCompensacao = horasExtrasBrutas - horasFaltantesBrutas;
  // quanto do banco de horas foi usado nesse mês (soma dos abonos parciais com horas definidas)
  const horasBancoUsadas = state.abonosPonto
    .filter((a) => a.funcionariaId === funcionaria.id && a.data.slice(0, 7) === mesKey && a.horas != null)
    .reduce((acc, a) => acc + a.horas, 0);
  // quanto do banco de horas foi pago em dinheiro nesse mês (via "Pagar saldo em dinheiro") —
  // só informativo, não soma no total do holerite porque já é um lançamento separado no Financeiro
  const horasBancoPagasDinheiro = state.bancoHorasLancamentos
    .filter((b) => b.funcionariaId === funcionaria.id && b.data.slice(0, 7) === mesKey && b.descricao && b.descricao.startsWith('Pago em dinheiro'))
    .reduce((acc, b) => acc + Math.abs(b.horas), 0);
  const valorBancoPagoDinheiro = state.tx
    .filter((t) => t.tipo === 'saida' && monthKey(t.data) === mesKey && t.descricao && t.descricao.startsWith(`Pagamento de banco de horas — ${funcionaria.nome}`))
    .reduce((acc, t) => acc + t.valor, 0);
  return { diasTrabalhados, horasExtras, horasExtras100, horasFaltantes, horasTrabalhadasTotal, salarioBase, valorHorasExtras, valorHorasExtras100, valorVt, valorVr, debitoCompensacaoSabado, horasBancoUsadas, horasBancoPagasDinheiro, valorBancoPagoDinheiro, saldoAntesCompensacao };
}
// procura, nos últimos N dias, dias em que ela deveria ter trabalhado mas falta alguma
// das 4 batidas — hoje só conta a partir do horário de saída esperado. Separa o que já
// tem solicitação pendente daquilo que ainda não foi nem solicitado.
function verificarPontosEsquecidos(funcionaria, diasParaTras) {
  diasParaTras = diasParaTras || 14;
  const resultado = [];
  const hoje = new Date(todayStr() + 'T00:00:00');
  const agora = new Date();
  for (let i = 0; i <= diasParaTras; i++) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const dataStr = d.toISOString().slice(0, 10);
    if (funcionaria.dataAdmissao && dataStr < funcionaria.dataAdmissao) continue;
    const esperado = jornadaEsperadaDoDia(funcionaria, dataStr);
    if (!esperado.trabalha) continue;
    if (i === 0) {
      const configHoje = (funcionaria.jornadaSemanal || {})[d.getDay()];
      const saidaEsperada = configHoje?.saida || funcionaria.jornadaSaida;
      const [hS, mS] = saidaEsperada.split(':').map(Number);
      const limiteHoje = new Date(hoje);
      limiteHoje.setHours(hS, mS, 0, 0);
      if (agora < limiteHoje) continue;
    }
    const pontosDoDia = state.pontos.filter((p) => p.funcionariaId === funcionaria.id && p.data === dataStr);
    const tiposBatidos = new Set(pontosDoDia.map((p) => p.tipo));
    const tiposFaltandoTotal = ORDEM_PONTOS.filter((t) => !tiposBatidos.has(t));
    if (tiposFaltandoTotal.length === 0) continue;
    if (state.abonosPonto.some((a) => a.funcionariaId === funcionaria.id && a.data === dataStr)) continue;
    const tiposPendentesAprovacao = tiposFaltandoTotal.filter((t) =>
      state.solicitacoesPonto.some((s) => s.funcionariaId === funcionaria.id && s.data === dataStr && s.tipo === t && s.status === 'pendente')
    );
    const tiposSemSolicitacao = tiposFaltandoTotal.filter((t) => !tiposPendentesAprovacao.includes(t));
    resultado.push({ data: dataStr, tiposSemSolicitacao, tiposPendentesAprovacao });
  }
  return resultado.sort((a, b) => b.data.localeCompare(a.data));
}
async function addSolicitacaoPonto(funcionariaId, data, tipo, horarioISO, motivo) {
  const { error } = await sb.from('solicitacoes_ponto').insert({
    funcionaria_id: funcionariaId, data, tipo, horario_solicitado: horarioISO, motivo: motivo || null, status: 'pendente',
  });
  if (error) alert('Erro ao enviar solicitação: ' + error.message);
}
async function aprovarSolicitacaoPonto(solicitacao) {
  const { error: errPonto } = await sb.from('pontos').insert({
    funcionaria_id: solicitacao.funcionariaId, data: solicitacao.data, tipo: solicitacao.tipo, horario: solicitacao.horarioSolicitado, origem: 'solicitacao',
  });
  if (errPonto) { alert('Erro ao criar a batida: ' + errPonto.message); return; }
  const { error } = await sb.from('solicitacoes_ponto').update({ status: 'aprovado', respondido_em: new Date().toISOString() }).eq('id', solicitacao.id);
  if (error) alert('Erro ao aprovar solicitação: ' + error.message);
}
async function rejeitarSolicitacaoPonto(id) {
  const { error } = await sb.from('solicitacoes_ponto').update({ status: 'rejeitado', respondido_em: new Date().toISOString() }).eq('id', id);
  if (error) alert('Erro ao recusar solicitação: ' + error.message);
}

// ---- Costureiras & Produção ----
// acha o menor número de identificação livre entre as costureiras ATIVAS no momento — se
// uma costureira sai (fica inativa), o número dela volta a ficar disponível pra uma nova
// costureira, evitando uma lista de números que só cresce. A unicidade que realmente
// importa (nunca duas fichas com o mesmo número de série) fica garantida em
// proximoNumeroSerieFicha, que olha pelo texto do número + ano, não pela costureira em si —
// então mesmo reaproveitando "02" pra outra pessoa, as fichas nunca colidem
function proximoNumeroIdentificacaoDisponivel() {
  const usados = new Set(state.costureiras.filter((c) => c.ativa && c.numeroIdentificacao).map((c) => c.numeroIdentificacao));
  let n = 1;
  while (usados.has(String(n).padStart(2, '0'))) n++;
  return String(n).padStart(2, '0');
}
async function addCostureira(nome) {
  const numeroIdentificacao = proximoNumeroIdentificacaoDisponivel();
  const { error } = await sb.from('costureiras').insert({ nome, ativa: true, numero_identificacao: numeroIdentificacao });
  if (error) alert('Erro ao adicionar costureira: ' + error.message);
}
async function updateCostureira(id, nome, ativa, metaSemanal, numeroIdentificacao) {
  const { error } = await sb.from('costureiras').update({ nome, ativa, meta_semanal: metaSemanal, numero_identificacao: numeroIdentificacao || null }).eq('id', id);
  if (error) alert('Erro ao atualizar costureira: ' + error.message);
}
// só pra costureiras antigas, cadastradas antes dessa função existir, que ficaram sem
// número — gera um novo automaticamente, igual seria se ela tivesse acabado de ser criada
async function gerarNumeroIdentificacaoRetroativo(costureiraId) {
  const numeroIdentificacao = proximoNumeroIdentificacaoDisponivel();
  const { error } = await sb.from('costureiras').update({ numero_identificacao: numeroIdentificacao }).eq('id', costureiraId);
  if (error) alert('Erro ao gerar número: ' + error.message);
}
async function removeCostureira(id) {
  const { error } = await sb.from('costureiras').delete().eq('id', id);
  if (error) alert('Erro ao remover costureira: ' + error.message);
}
// origemVarianteId: por padrão, undefined = abate a mesma cor da peça lançada. Mas se a peça
// veio de um corte de cor mista (ex: "Preto + Marrom" cortado junto), dá pra passar a cor da
// LEVA em mãos (diferente da cor da peça em si), e o abate da fila de "em mãos" usa essa —
// null explícito = abater da leva "sem cor" (produto sem variante)
async function registrarProducao(costureiraId, produtoId, quantidade, data, varianteId, jaPago, origemVarianteId, motivoDefeito, valorAjuste, origemDistribuicaoId) {
  const varianteParaAbater = origemVarianteId !== undefined ? origemVarianteId : varianteId;
  const { data: linhaCriada, error } = await sb.from('producoes').insert({ costureira_id: costureiraId, produto_id: produtoId, quantidade, data, pago: !!jaPago, variante_id: varianteId || null, abate_variante_id: varianteParaAbater || null, motivo_defeito: motivoDefeito || null, valor_ajuste: valorAjuste !== undefined ? valorAjuste : null }).select('id').single();
  if (error) { alert('Erro ao registrar produção: ' + error.message); return; }
  // só peça BOA entregue (quantidade > 0) entra no estoque de venda — defeito nunca chegou a
  // virar peça vendável, então não pode tirar estoque que nunca foi somado
  if (quantidade > 0) {
    if (varianteId) {
      const variante = state.variantes.find((v) => v.id === varianteId);
      if (variante) await updateVarianteEstoque(varianteId, variante.estoqueAtual + quantidade);
    } else {
      const produto = state.produtos.find((p) => p.id === produtoId);
      if (produto) await updateProdutoEstoque(produtoId, produto.estoqueAtual + quantidade);
    }
  }
  // já a fila de "peças em mãos" da costureira desconta sempre, seja peça boa ou defeito — nos
  // dois casos a peça saiu das mãos dela (ou virou produto, ou foi descartada como defeito).
  // guarda de QUAIS levas tirou, pra se esse lançamento for excluído depois, saber devolver
  // certinho pra elas — sem precisar adivinhar. Se a pessoa escolheu uma leva ESPECÍFICA (por
  // data, quando tem mais de uma leva aberta da mesma cor), abate exatamente dessa, sem FIFO
  if (quantidade !== 0 && linhaCriada) {
    const breakdown = origemDistribuicaoId
      ? await baixarDeDistribuicaoEspecifica(origemDistribuicaoId, Math.abs(quantidade))
      : await baixarDistribuicoesFIFO(costureiraId, produtoId, varianteParaAbater, Math.abs(quantidade));
    if (breakdown && breakdown.length > 0) {
      const { error: errBreakdown } = await sb.from('producoes').update({ abate_distribuicoes: breakdown }).eq('id', linhaCriada.id);
      if (errBreakdown) console.error('Erro ao salvar de qual leva veio o abate:', errBreakdown);
    }
  }
  // peças de verdade entregues (não defeito) já consomem os insumos de "produção" da ficha técnica, tipo etiqueta
  if (quantidade > 0) await baixarInsumosProducao(produtoId, quantidade, data);
}
async function marcarProducaoPaga(ids) {
  // mesmo cuidado do deleteEmLotes: lista grande de ids na URL dá Bad Request, então atualiza em lotes
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const { error } = await sb.from('producoes').update({ pago: true }).in('id', lote);
    if (error) { alert('Erro ao marcar produção como paga: ' + error.message); return; }
  }
}
async function removeProducao(id) {
  const p = state.producoes.find((x) => x.id === id);
  let avisoManual = false;
  if (p) {
    // só desfaz estoque se essa peça tinha entrado como peça boa (quantidade > 0) — defeito
    // nunca soma estoque, então remover ele também não deve tirar estoque
    if (p.quantidade > 0) {
      if (p.varianteId) {
        const variante = state.variantes.find((v) => v.id === p.varianteId);
        if (variante) await updateVarianteEstoque(variante.id, variante.estoqueAtual - p.quantidade);
      } else {
        const produto = state.produtos.find((x) => x.id === p.produtoId);
        if (produto) await updateProdutoEstoque(produto.id, Math.max(0, produto.estoqueAtual - p.quantidade));
      }
    }
    // devolve a peça pra fila de "em mãos" da costureira (desfaz o abate feito no lançamento) —
    // se souber exatamente de quais levas ele tirou (abateDistribuicoes), devolve certinho pra
    // elas, sem adivinhar. Lançamentos de ANTES dessa coluna existir não têm essa info salva —
    // nesse caso cai no aviso manual (pra não arriscar devolver pra leva errada)
    if (p.abateVarianteId === undefined && !p.abateDistribuicoes) {
      avisoManual = true;
    } else if (p.quantidade !== 0) {
      await restaurarDistribuicoesLIFO(p.costureiraId, p.produtoId, p.abateVarianteId, Math.abs(p.quantidade), p.abateDistribuicoes);
    }
  }
  const { error } = await sb.from('producoes').delete().eq('id', id);
  if (error) { alert('Erro ao remover lançamento: ' + error.message); return; }
  if (avisoManual) {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    alert(`Lançamento removido e estoque do produto desfeito. Mas esse lançamento é de antes de eu conseguir salvar de qual leva ele veio, então NÃO mexi na fila de "peças em mãos" — pra não arriscar devolver pra leva errada.\n\nSe esse lançamento tinha sido abatido de uma leva de cor mista, confere e ajusta na mão em Produção → ${produto?.nome || 'esse produto'} → "Peças em mãos" (✏️ do lado da leva certa).`);
  }
}
async function updateProducao(id, novo) {
  const antigo = state.producoes.find((p) => p.id === id);
  if (!antigo) return;
  const { error } = await sb.from('producoes').update({ produto_id: novo.produtoId, quantidade: novo.quantidade, data: novo.data }).eq('id', id);
  if (error) { alert('Erro ao editar lançamento: ' + error.message); return; }
  // lançamento de antes da coluna abate_variante_id existir: não dá pra saber com certeza de
  // qual leva ele tirou, então não mexe na fila de "em mãos" pra não arriscar bagunçar a leva
  // errada — só avisa pra conferir na mão
  if (antigo.abateVarianteId === undefined && !antigo.abateDistribuicoes) {
    if (novo.quantidade !== antigo.quantidade) {
      alert('Quantidade atualizada, mas esse lançamento é de antes de eu conseguir salvar de qual leva ele veio — não mexi na fila de "peças em mãos" pra não arriscar. Confere e ajusta na mão se precisar.');
    }
  } else {
    const varianteAbatida = antigo.abateVarianteId;
    if (antigo.produtoId === novo.produtoId) {
      // mesma "chave" de distribuição (produto + variante abatida não muda) — só ajusta a diferença
      const delta = novo.quantidade - antigo.quantidade;
      if (delta > 0) await baixarDistribuicoesFIFO(antigo.costureiraId, antigo.produtoId, varianteAbatida, delta);
      else if (delta < 0) await restaurarDistribuicoesLIFO(antigo.costureiraId, antigo.produtoId, varianteAbatida, Math.abs(delta), antigo.abateDistribuicoes);
    } else {
      // trocou de produto: desfaz tudo do produto antigo e refaz no novo (só produtos sem cor
      // trocam de produto na edição, então não tem variante abatida específica pra manter)
      if (antigo.quantidade !== 0) await restaurarDistribuicoesLIFO(antigo.costureiraId, antigo.produtoId, varianteAbatida, Math.abs(antigo.quantidade), antigo.abateDistribuicoes);
      if (novo.quantidade !== 0) await baixarDistribuicoesFIFO(antigo.costureiraId, novo.produtoId, null, Math.abs(novo.quantidade));
    }
  }
  // lançamentos com cor (variante) não trocam de produto na edição — só ajusta a quantidade na mesma cor
  // só peça boa (quantidade > 0) conta pro estoque — por isso o ajuste usa max(0, quantidade) dos
  // dois lados: cobre trocar de produção pra defeito (ou vice-versa) sem sujar o estoque
  const deltaEstoque = Math.max(0, novo.quantidade) - Math.max(0, antigo.quantidade);
  if (antigo.varianteId) {
    const variante = state.variantes.find((v) => v.id === antigo.varianteId);
    if (variante && deltaEstoque !== 0) await updateVarianteEstoque(variante.id, Math.max(0, variante.estoqueAtual + deltaEstoque));
    return;
  }
  if (antigo.produtoId === novo.produtoId) {
    const produto = state.produtos.find((p) => p.id === novo.produtoId);
    if (produto && deltaEstoque !== 0) await updateProdutoEstoque(produto.id, Math.max(0, produto.estoqueAtual + deltaEstoque));
  } else {
    const produtoAntigo = state.produtos.find((p) => p.id === antigo.produtoId);
    if (produtoAntigo && antigo.quantidade > 0) await updateProdutoEstoque(produtoAntigo.id, Math.max(0, produtoAntigo.estoqueAtual - antigo.quantidade));
    const produtoNovo = state.produtos.find((p) => p.id === novo.produtoId);
    if (produtoNovo && novo.quantidade > 0) await updateProdutoEstoque(produtoNovo.id, produtoNovo.estoqueAtual + novo.quantidade);
  }
}

async function garantirRecorrentes() {
  const hojeMonth = todayStr().slice(0, 7);
  // categorias já geradas por outro fluxo automático (parcela de empréstimo, salário e
  // benefícios do holerite) nunca devem virar molde recorrente — se ficarem marcadas como
  // recorrente (por edição antiga ou erro), geram lançamentos fantasmas todo mês, duplicando
  // com o que o próprio sistema já lança sozinho. Trava aqui também, além da trava na hora
  // de salvar, pra nunca mais duplicar de novo.
  const templates = state.tx.filter((t) => t.recorrente && !CATEGORIAS_SEM_RECORRENTE_MANUAL.includes(t.categoria));
  for (const t of templates) {
    const dia = Number(t.data.slice(8, 10));
    let cursor = addMonths(monthKey(t.data), 1);
    let iter = 0;
    while (cursor <= hojeMonth && iter < 36) {
      const jaExiste = state.tx.some((x) => x.recorrenteOrigemId === t.id && monthKey(x.data) === cursor);
      if (!jaExiste) {
        const diaFinal = Math.min(dia, daysInMonth(cursor));
        const novaData = `${cursor}-${String(diaFinal).padStart(2, '0')}`;
        const { error: errRecorrente } = await sb.from('transacoes').insert({
          tipo: t.tipo, valor: t.valor, categoria: t.categoria, natureza: t.natureza || null, descricao: t.descricao || null,
          data: novaData, recorrente: false, recorrente_origem_id: t.id,
        });
        if (errRecorrente) console.error('Erro ao gerar lançamento recorrente:', errRecorrente);
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas_sku_pendentes' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas_detalhe' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'abonos_ponto' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'holerites' }, loadData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feriados' }, loadData)
    .subscribe();
}

// ==================== COMPUTED ====================
function getComputed() {
  // saldo real de caixa: só conta o que já aconteceu até hoje, não despesas/receitas
  // futuras já cadastradas adiantado (ex: aluguel do mês que vem lançado hoje)
  const saldoTotal = state.tx.filter((t) => t.data <= todayStr() && t.categoria !== 'Crédito grátis Ads').reduce((acc, t) => acc + (t.tipo === 'entrada' ? t.valor : -t.valor), 0);
  const txMes = state.tx.filter((t) => t.data >= state.periodoInicio && t.data <= state.periodoFim);
  const entradasMes = txMes.filter((t) => t.tipo === 'entrada' && t.categoria !== 'Crédito grátis Ads').reduce((a, t) => a + t.valor, 0);
  const saidasMes = txMes.filter((t) => t.tipo === 'saida').reduce((a, t) => a + t.valor, 0);
  const custoFixo = txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'fixo').reduce((a, t) => a + t.valor, 0);
  const custoVariavel = txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'variavel').reduce((a, t) => a + t.valor, 0);

  const produtosStatus = state.produtos.map((p) => {
    const estoqueReal = estoqueEfetivo(p);
    const precisaRepor = estoqueReal <= p.estoqueMinimo;
    const qtdSugerida = Math.max(p.estoqueMinimo * 2 - estoqueReal, p.estoqueMinimo || 1);
    const custoTotalUnitario = calcularCustoTotalProduto(p.id);
    const custoRepor = qtdSugerida * custoTotalUnitario;
    let status = 'ok';
    if (estoqueReal <= 0) status = 'critico';
    else if (precisaRepor) status = saldoTotal >= custoRepor ? 'pode-cortar' : 'aguarde';
    const diasSemVender = p.ultimaVenda ? Math.floor((Date.now() - new Date(p.ultimaVenda + 'T00:00:00').getTime()) / 86400000) : null;
    return { ...p, estoqueAtual: estoqueReal, precisaRepor, qtdSugerida, custoRepor, custoTotalUnitario, status, diasSemVender };
  });

  const PARADO_DIAS = 30;
  const produtosParados = produtosStatus
    .filter((p) => p.ativo !== false && p.estoqueAtual > 0 && (p.diasSemVender === null || p.diasSemVender >= PARADO_DIAS))
    .sort((a, b) => (b.diasSemVender ?? 99999) - (a.diasSemVender ?? 99999));

  // produtos que não têm NENHUMA cor cadastrada — cada venda desse SKU cai direto no estoque
  // geral (sem passar por variante nenhuma). Se na vida real o produto tem cor, isso é sinal de
  // que faltou cadastrar as variantes — daí toda venda vinculada erra a cor
  const produtosSemCor = produtosStatus.filter((p) => p.ativo !== false && p.tipo !== 'kit' && variantesDoProduto(p.id).length === 0);

  // contas a vencer: saídas com data futura (ainda não contam no saldo atual),
  // dentro dos próximos 7 dias, pra você se antecipar
  const hoje = todayStr();
  const JANELA_VENCIMENTO = 7;
  const contasAVencer = state.tx
    .filter((t) => t.tipo === 'saida' && t.data > hoje)
    .map((t) => ({ ...t, diasParaVencer: Math.round((new Date(t.data + 'T00:00:00') - new Date(hoje + 'T00:00:00')) / 86400000) }))
    .filter((t) => t.diasParaVencer <= JANELA_VENCIMENTO)
    .sort((a, b) => a.diasParaVencer - b.diasParaVencer);

  // contas vencidas que ninguém confirmou como pagas — a data já chegou/passou, mas o
  // pagamento nunca foi confirmado clicando em "marcar como pago"; alerta em vermelho
  // porque pode ter sido esquecida (diferente da contasAVencer, que é só o aviso prévio)
  const contasVencidasNaoConfirmadas = state.tx
    .filter((t) => t.tipo === 'saida' && t.data <= hoje && t.pago === false)
    .map((t) => ({ ...t, diasVencida: Math.round((new Date(hoje + 'T00:00:00') - new Date(t.data + 'T00:00:00')) / 86400000) }))
    .sort((a, b) => b.diasVencida - a.diasVencida);

  // valor real do estoque: matéria-prima + insumos parados + peças prontas (custo total: tecido+corte+mão de obra+insumos)
  const valorInsumos = state.insumos.reduce((a, i) => a + i.quantidadeDisponivel * i.custoMedioUnitario, 0);
  const valorMateriaPrima = state.materiaPrima.reduce((a, m) => a + m.rolosDisponiveis * m.custoMedioRolo, 0) + valorInsumos;
  const valorPecasProntas = produtosStatus.reduce((a, p) => a + p.estoqueAtual * p.custoTotalUnitario, 0);
  const valorEstoqueTotal = valorMateriaPrima + valorPecasProntas;
  const materiaPrimaDetalhe = state.materiaPrima
    .filter((m) => m.rolosDisponiveis > 0)
    .map((m) => [`${m.cor} (${m.rolosDisponiveis} rolo(s))`, m.rolosDisponiveis * m.custoMedioRolo])
    .concat(state.insumos.filter((i) => i.quantidadeDisponivel > 0).map((i) => [`${i.nome} (${i.quantidadeDisponivel} ${i.unidade})`, i.quantidadeDisponivel * i.custoMedioUnitario]))
    .sort((a, b) => b[1] - a[1]);
  const pecasProntasDetalhe = produtosStatus
    .filter((p) => p.estoqueAtual > 0)
    .map((p) => [`${p.nome} (${p.estoqueAtual} un)`, p.estoqueAtual * p.custoTotalUnitario])
    .sort((a, b) => b[1] - a[1]);

  return { saldoTotal, txMes, entradasMes, saidasMes, custoFixo, custoVariavel, produtosStatus, produtosParados, produtosSemCor, contasAVencer, contasVencidasNaoConfirmadas, valorMateriaPrima, valorPecasProntas, valorEstoqueTotal, materiaPrimaDetalhe, pecasProntasDetalhe };
}

// ==================== RENDER ====================
// valor que uma peça (produção ou defeito) conta pro que se deve à costureira — normalmente é
// quantidade × valor da peça, mas defeitos podem ter um valor customizado (valorAjuste): pode
// ser 0 (defeito não é culpa dela, não desconta nada) ou um valor maior que o normal (ela
// estragou o tecido, desconta o prejuízo, não só a mão de obra daquela peça)
function valorProducaoItem(p) {
  if (p.valorAjuste !== null && p.valorAjuste !== undefined) return p.valorAjuste;
  const produto = state.produtos.find((x) => x.id === p.produtoId);
  return p.quantidade * (produto ? produto.valorMaoObra : 0);
}
// tela agregada: quanto tem em produção (em mãos de QUALQUER costureira, cortado e ainda
// não devolvido pronto) por modelo + cor — pra ver de cara "500 - Top Joy GG - Preto" sem
// precisar abrir costureira por costureira somando na cabeça
function renderPecasPorModelo() {
  const porModelo = {};
  state.distribuicoes.forEach((d) => {
    const restante = d.quantidadeDistribuida - d.quantidadeDevolvida;
    if (restante <= 0) return;
    const produto = state.produtos.find((p) => p.id === d.produtoId);
    const variante = d.varianteId ? state.variantes.find((v) => v.id === d.varianteId) : null;
    const chave = `${d.produtoId}||${d.varianteId || 'sem-cor'}`;
    if (!porModelo[chave]) {
      porModelo[chave] = { nomeProduto: produto?.nome || 'Produto removido', nomeVariante: variante?.nome || null, qtd: 0, porCostureira: {} };
    }
    porModelo[chave].qtd += restante;
    const costureira = state.costureiras.find((cc) => cc.id === d.costureiraId);
    const nomeCost = costureira?.nome || 'Costureira removida';
    porModelo[chave].porCostureira[nomeCost] = (porModelo[chave].porCostureira[nomeCost] || 0) + restante;
  });
  const lista = Object.values(porModelo).sort((a, b) => b.qtd - a.qtd);
  const totalGeral = lista.reduce((a, m) => a + m.qtd, 0);

  return `
    <div class="section-title-wrap"><button class="icon-btn-ghost" id="voltarPecasPorModelo">← Voltar</button></div>
    <div class="section-title-wrap">
      <div>
        <div class="section-title">Peças em produção por modelo</div>
        <div class="section-subtitle">${totalGeral} peças no total, somando todas as costureiras</div>
      </div>
    </div>
    ${lista.length === 0 ? `<div class="empty-state">Nenhuma peça em produção no momento.</div>` : `
      <div class="tx-list">
        ${lista.map((m, idx) => `
          <div class="tx-row" style="cursor:pointer;flex-direction:column;align-items:stretch" data-toggle-modelo="${idx}">
            <div style="display:flex;align-items:center;gap:10px;width:100%">
              <div class="tx-dot" style="background:var(--teal)"></div>
              <div style="flex:1">
                <div class="tx-categoria">${esc(m.nomeProduto)}${m.nomeVariante ? ` — ${esc(m.nomeVariante)}` : ''}</div>
                <div class="tx-desc">${Object.keys(m.porCostureira).length} costureira(s) com essa peça em mãos</div>
              </div>
              <div class="tx-valor" style="color:var(--teal)">${m.qtd}</div>
            </div>
            ${state.modeloExpandido === idx ? `
              <div style="margin-top:8px;padding-left:24px;display:flex;flex-direction:column;gap:5px;border-left:2px solid var(--border)">
                ${Object.entries(m.porCostureira).sort((a, b) => b[1] - a[1]).map(([nome, qtd]) => `
                  <div style="display:flex;justify-content:space-between;padding-left:10px;font-size:13px;color:var(--text-muted)">
                    <span>${esc(nome)}</span><span>${qtd}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `}
  `;
}
// ---- Produção (visão do dono) ----
function renderProducaoDono(c) {
  if (state.costureiraDetalheId) return renderCostureiraDetalhe(state.costureiraDetalheId);
  if (state.mostrarPecasPorModelo) return renderPecasPorModelo();

  const naoPagas = state.producoes.filter((p) => !p.pago);
  const porCostureira = {};
  naoPagas.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const nomeProduto = produto?.nome || 'Produto removido';
    const valorItem = valorProducaoItem(p);
    if (!porCostureira[p.costureiraId]) porCostureira[p.costureiraId] = { qtd: 0, valor: 0, ids: [], porProduto: {} };
    porCostureira[p.costureiraId].qtd += Math.max(0, p.quantidade);
    porCostureira[p.costureiraId].valor += valorItem;
    porCostureira[p.costureiraId].ids.push(p.id);
    if (!porCostureira[p.costureiraId].porProduto[nomeProduto]) porCostureira[p.costureiraId].porProduto[nomeProduto] = { qtd: 0, valor: 0 };
    porCostureira[p.costureiraId].porProduto[nomeProduto].qtd += Math.max(0, p.quantidade);
    porCostureira[p.costureiraId].porProduto[nomeProduto].valor += valorItem;
  });

  // resumo geral: total de peças em mãos (todas costureiras) + total previsão de pagamento
  const totalPecasEmProducao = state.distribuicoes.reduce((a, d) => a + Math.max(0, d.quantidadeDistribuida - d.quantidadeDevolvida), 0);
  const totalPrevisaoPagamento = Object.values(porCostureira).reduce((a, info) => a + info.valor, 0);

  // peças em mãos (cortadas, distribuídas, ainda não devolvidas prontas) POR costureira —
  // pra dar um alerta visual rápido de quem já ficou sem material pra costurar e precisa
  // receber corte novo, sem precisar entrar no histórico de cada uma pra descobrir
  const emMaosPorCostureira = {};
  state.distribuicoes.forEach((d) => {
    const restante = d.quantidadeDistribuida - d.quantidadeDevolvida;
    if (restante <= 0) return;
    emMaosPorCostureira[d.costureiraId] = (emMaosPorCostureira[d.costureiraId] || 0) + restante;
  });

  // produção boa (não defeito) desta semana, por costureira — pra comparar com a meta semanal
  const inicioSemanaAtual = inicioDaSemana(todayStr());
  const producaoSemanaPorCostureira = {};
  state.producoes.filter((p) => p.quantidade > 0 && p.data >= inicioSemanaAtual).forEach((p) => {
    producaoSemanaPorCostureira[p.costureiraId] = (producaoSemanaPorCostureira[p.costureiraId] || 0) + p.quantidade;
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
    <div class="stats-grid">
      <div class="stat-card" style="cursor:pointer" id="abrirPecasPorModelo">
        <div class="stat-icon" style="background:rgba(255,182,39,0.1)">🧵</div>
        <div class="stat-label">Peças em produção</div>
        <div class="stat-value">${totalPecasEmProducao}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,46,126,0.1)">💰</div>
        <div class="stat-label">Previsão de pagamento</div>
        <div class="stat-value">${fmt(totalPrevisaoPagamento)}</div>
      </div>
    </div>

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
      <div style="display:flex;gap:8px;align-items:center">
        ${renderControleColunas('costureiras')}
        <button class="icon-btn" id="toggleCostureiraForm">＋ Costureira</button>
      </div>
    </div>

    ${state.showCostureiraForm ? `
      <div class="form-card">
        <input type="text" id="novaCostureiraNome" placeholder="Nome da costureira" />
        <div class="form-hint">O número de identificação (usado nas fichas de corte) é gerado automaticamente ao salvar.</div>
        <button class="confirm-btn" id="salvarCostureira">Adicionar</button>
      </div>
    ` : ''}

    ${state.costureiras.length === 0 ? `<div class="empty-state">Nenhuma costureira cadastrada ainda.</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('costureiras', 220)};gap:10px;margin-bottom:28px">
        ${state.costureiras.map((cost) => {
          if (state.editingCostureiraId === cost.id) {
            return `
              <div class="form-card" style="grid-column:1 / -1">
                <input type="text" id="editCostNome-${cost.id}" placeholder="Nome da costureira" value="${esc(cost.nome)}" />
                <div class="form-hint">Número de identificação (usado nas fichas de corte):</div>
                <input type="text" id="editCostNumero-${cost.id}" placeholder="ex: 02" value="${esc(cost.numeroIdentificacao || '')}" />
                <input type="text" id="editCostMeta-${cost.id}" placeholder="Meta de peças por semana (ex: 1500)" value="${cost.metaSemanal || ''}" inputmode="numeric" />
                <label class="checkbox-label"><input type="checkbox" id="editCostAtiva-${cost.id}" ${cost.ativa ? 'checked' : ''} /> Costureira ativa</label>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-costureira="${cost.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-costureira="${cost.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          const producaoSemana = producaoSemanaPorCostureira[cost.id] || 0;
          const emMaosCost = emMaosPorCostureira[cost.id] || 0;
          const meta = cost.metaSemanal || 0;
          const pct = meta > 0 ? Math.round((producaoSemana / meta) * 100) : null;
          return `
            <div class="produto-card" style="cursor:pointer" data-abrir-costureira="${cost.id}">
              <div class="produto-header">
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="tx-dot" style="background:${cost.ativa ? 'var(--teal)' : 'var(--text-muted)'}"></div>
                  <div class="produto-nome">${cost.numeroIdentificacao ? `<span style="color:var(--text-muted)">${esc(cost.numeroIdentificacao)} —</span> ` : ''}${esc(cost.nome)}</div>
                </div>
                <div style="display:flex;gap:2px">
                  ${!cost.numeroIdentificacao ? `<button class="trash-btn" title="Gerar número de identificação" data-gerar-numero-costureira="${cost.id}">🔢</button>` : ''}
                  <button class="trash-btn" data-editar-costureira="${cost.id}">✏️</button>
                  <button class="trash-btn" data-remover-costureira="${cost.id}">🗑</button>
                </div>
              </div>
              ${cost.ativa ? (emMaosCost > 0
                ? `<div style="margin-top:8px;display:inline-block;padding:3px 10px;border-radius:6px;background:rgba(0,212,160,0.14);color:var(--teal);font-size:12px;font-weight:700">📦 ${emMaosCost} peças em mãos</div>`
                : `<div style="margin-top:8px;display:inline-block;padding:3px 10px;border-radius:6px;background:rgba(255,71,87,0.16);color:var(--red);font-size:12px;font-weight:700">⚠️ Sem peças — precisa de corte</div>`
              ) : ''}
              ${meta > 0 ? `
                <div class="custo-bar" style="margin-top:8px">
                  <div class="custo-bar-fill" style="width:${Math.min(100, pct)}%;background:${pct >= 100 ? 'var(--teal)' : 'var(--pink)'}"></div>
                </div>
                <div class="produto-meta" style="margin-top:4px;margin-left:0">${producaoSemana} / ${meta} peças esta semana · ${pct}%</div>
              ` : `<div class="form-hint" style="margin-top:8px;margin-bottom:0">${producaoSemana} peças esta semana · sem meta definida (✏️ pra definir)</div>`}
            </div>
          `;
        }).join('')}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Pagamento pendente</div><div class="section-subtitle">Produção ainda não paga, por costureira</div></div>
      ${renderControleColunas('pagamentoPendente')}
    </div>

    ${Object.keys(porCostureira).length === 0 ? `<div class="empty-state">Nenhuma produção pendente de pagamento 🎉</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('pagamentoPendente', 260)};gap:10px">
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
              <div class="form-row" style="margin-top:10px">
                <input type="text" id="descontoVale-${costureiraId}" placeholder="Desconto de vale (opcional)" />
                <input type="date" id="dataPagamento-${costureiraId}" value="${todayStr()}" style="max-width:150px" />
              </div>
              <button class="confirm-btn" style="margin-top:6px" data-pagar-costureira="${costureiraId}" data-ids="${info.ids.join(',')}" data-valor="${info.valor}" data-nome="${esc(costureira?.nome || '')}">✅ Pagar ${fmt(info.valor)}</button>
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
  const totalPago = entradas.filter((p) => p.pago).reduce((acc, p) => acc + valorProducaoItem(p), 0);
  const pendentes = entradas.filter((p) => !p.pago);
  // conta só peças BOAS aqui — defeito já tem sua própria contagem separada (não faz sentido
  // "peças pendentes" cair quando registra um defeito, são duas coisas diferentes)
  const totalPendenteQtd = pendentes.reduce((a, p) => a + Math.max(0, p.quantidade), 0);
  const totalPendenteValor = pendentes.reduce((acc, p) => acc + valorProducaoItem(p), 0);

  // resumo agrupado por produto, só do que ainda está pendente (a semana em aberto)
  const porProdutoPendente = {};
  pendentes.forEach((p) => {
    const produto = state.produtos.find((x) => x.id === p.produtoId);
    const nome = produto?.nome || 'Produto removido';
    if (!porProdutoPendente[nome]) porProdutoPendente[nome] = { qtd: 0, valor: 0 };
    porProdutoPendente[nome].qtd += Math.max(0, p.quantidade);
    porProdutoPendente[nome].valor += valorProducaoItem(p);
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
    const valorItem = valorProducaoItem(p);
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
    if (!emMaosMap[chaveId]) emMaosMap[chaveId] = { nome, qtd: 0, produtoId: d.produtoId, varianteId: d.varianteId || null, lotes: [] };
    emMaosMap[chaveId].qtd += restante;
    emMaosMap[chaveId].lotes.push({ data: d.data, qtd: restante, distribuicaoId: d.id, numeroSerie: d.numeroSerie });
  });
  Object.values(emMaosMap).forEach((item) => item.lotes.sort((a, b) => b.data.localeCompare(a.data)));
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

  const LABELS_MOTIVO_DEFEITO = { costureira: '🧵 Erro da costureira', corte: '✂️ Erro de corte/tecido', outro: '❓ Outro motivo', null: '— Sem motivo registrado (lançamento antigo)' };
  const porMotivoDefeito = {};
  defeitos.forEach((p) => {
    const chave = p.motivoDefeito || 'null';
    if (!porMotivoDefeito[chave]) porMotivoDefeito[chave] = { qtd: 0, descontado: 0 };
    porMotivoDefeito[chave].qtd += Math.abs(p.quantidade);
    porMotivoDefeito[chave].descontado += Math.abs(Math.min(0, valorProducaoItem(p)));
  });
  const resumoMotivoDefeitos = Object.entries(porMotivoDefeito).sort((a, b) => b[1].qtd - a[1].qtd);

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
            <div style="flex:1">
              <div class="tx-categoria">${esc(item.nome)}</div>
              <div class="tx-desc">${item.lotes.map((l) => `${l.qtd} em ${new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}${l.numeroSerie ? ` <strong style="color:var(--text)">· ficha ${esc(l.numeroSerie)}</strong>` : ''}`).join(' · ')}</div>
            </div>
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

    ${resumoMotivoDefeitos.length > 0 ? `
      <div class="section-title-wrap">
        <div><div class="section-title">Defeitos por motivo</div><div class="section-subtitle">Pra mapear se o problema é dela, do corte, ou outra coisa</div></div>
      </div>
      <div class="tx-list" style="margin-bottom:28px">
        ${resumoMotivoDefeitos.map(([chave, info]) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:var(--red)"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(LABELS_MOTIVO_DEFEITO[chave] || chave)}</div></div>
            <div class="tx-valor" style="color:var(--red)">${info.qtd} peças${info.descontado > 0 ? ` · ${fmt(info.descontado)} descontado` : ' · sem desconto'}</div>
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
        ${(() => {
          if (!window.__prodFormProdutoId) return '';
          const emMaosDoProduto = emMaosLista.filter((item) => item.produtoId === window.__prodFormProdutoId);
          if (emMaosDoProduto.length === 0) return '';
          // cada LEVA individual vira uma opção própria (não o grupo somado) — assim, se a
          // costureira tiver mais de um corte de cor mista em aberto do mesmo produto, dá pra
          // escolher exatamente qual leva/data abater, em vez do sistema decidir sozinho pela
          // mais antiga (o que podia abater da leva errada quando tinha mais de uma aberta)
          const lotesFlat = [];
          emMaosDoProduto.forEach((item) => {
            item.lotes.forEach((lote) => {
              lotesFlat.push({ ...lote, nome: item.nome });
            });
          });
          lotesFlat.sort((a, b) => b.data.localeCompare(a.data));
          return `
            <select id="detalheOrigemDistribuicao">
              <option value="">Abater automático (mesma cor que a peça)</option>
              ${lotesFlat.map((lote) => `<option value="lote:${lote.distribuicaoId}">Abater de: ${esc(lote.nome)} — ${lote.qtd} em mãos, corte de ${new Date(lote.data + 'T00:00:00').toLocaleDateString('pt-BR')}${lote.numeroSerie ? ` (ficha ${esc(lote.numeroSerie)})` : ''}</option>`).join('')}
            </select>
            <div class="form-hint" style="margin-top:-4px">Se essa peça veio de um corte de cor mista (ex: cortou "Preto + Marrom" junto e agora tá devolvendo só o Marrom), escolhe aqui a leva certa pra abater — mesmo lançando a peça na cor pura. Se tiver mais de um corte da mesma combinação em datas diferentes, escolhe a data certa.</div>
          `;
        })()}
        <input type="text" id="detalheQuantidade" placeholder="Quantidade de peças" inputmode="numeric" />
        ${tipo === 'defeito' ? `
          <select id="detalheMotivoDefeito">
            <option value="">Selecione o motivo do defeito</option>
            <option value="costureira" ${window.__prodFormMotivoDefeito === 'costureira' ? 'selected' : ''}>🧵 Erro da costureira (desconta dela)</option>
            <option value="corte" ${window.__prodFormMotivoDefeito === 'corte' ? 'selected' : ''}>✂️ Erro de corte/tecido danificado (NÃO desconta dela)</option>
            <option value="outro" ${window.__prodFormMotivoDefeito === 'outro' ? 'selected' : ''}>❓ Outro motivo (NÃO desconta dela)</option>
          </select>
          ${window.__prodFormMotivoDefeito === 'costureira' ? `
            <input type="text" id="detalheValorDesconto" placeholder="Valor a descontar (em branco = valor normal da peça)" />
            <div class="form-hint" style="margin-top:-4px">Pode colocar um valor maior que o normal da peça, se quiser cobrar o tecido estragado também.</div>
          ` : ''}
        ` : ''}
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

    <div class="section-title-wrap">
      <div><div class="section-title">Resumo por dia</div></div>
      <button class="icon-btn-ghost" id="toggleResumoPorDia">${state.mostrarResumoPorDia ? '▲ Ocultar' : '▼ Exibir'}</button>
    </div>
    ${state.mostrarResumoPorDia ? (resumoPorDia.length === 0 ? `<div class="empty-state">Nenhum lançamento no filtro selecionado.</div>` : `
      <div class="tx-list" style="margin-bottom:28px">
        ${resumoPorDia.map(([dia, info]) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${dia}</div></div>
            <div class="tx-valor" style="color:${info.qtd >= 0 ? 'var(--teal)' : 'var(--red)'}">${info.qtd} peças · ${fmt(info.valor)}</div>
          </div>
        `).join('')}
      </div>
    `) : ''}

    <div class="section-title-wrap"><div><div class="section-title">Detalhado</div></div></div>
    ${entradasFiltradas.length === 0 ? `<div class="empty-state">Nenhum lançamento no filtro selecionado.</div>` : `
      <div class="tx-list">
        ${entradasFiltradas.map((p) => {
          const produto = state.produtos.find((x) => x.id === p.produtoId);
          const valor = valorProducaoItem(p);
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
                <div class="tx-categoria">${esc(produto?.nome || 'Produto removido')}${p.varianteId ? ` — ${esc(state.variantes.find((v) => v.id === p.varianteId)?.nome || '')}` : ''}${ehDefeito ? ` ⚠️ Defeito${p.motivoDefeito ? ` (${esc(LABELS_MOTIVO_DEFEITO[p.motivoDefeito] || p.motivoDefeito)})` : ''}` : ''}</div>
                <div class="tx-desc">${p.quantidade} peças · ${fmt(valor)}${p.pago ? ' · pago' : ' · pendente'}</div>
                <div class="tx-date" style="display:inline-block;margin-top:2px;padding:2px 7px;border-radius:4px;background:rgba(255,214,10,0.16);color:#ffd60a;font-weight:600">${p.data}</div>
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

// ---- Modo Ponto (funcionária bate o próprio ponto) ----
const ORDEM_PONTOS = ['entrada', 'saida_almoco', 'volta_almoco', 'saida'];
const LABEL_PONTO = { entrada: 'Entrada', saida_almoco: 'Saída Almoço', volta_almoco: 'Volta Almoço', saida: 'Saída' };

function renderModoPonto(app) {
  const funcionaria = state.funcionarias.find((f) => f.id === state.funcionariaLogadaId);
  if (!funcionaria) {
    localStorage.removeItem('rj_papel');
    localStorage.removeItem('rj_funcionaria_id');
    localStorage.removeItem('rj_ponto_expira_em');
    sessionStorage.removeItem('rj_papel_sessao');
    sessionStorage.removeItem('rj_funcionaria_id_sessao');
    state.papel = null;
    state.funcionariaLogadaId = null;
    render();
    return;
  }

  const hoje = todayStr();
  const pontosHoje = state.pontos
    .filter((p) => p.funcionariaId === funcionaria.id && p.data === hoje)
    .sort((a, b) => new Date(a.horario) - new Date(b.horario));
  const tiposJaBatidos = new Set(pontosHoje.map((p) => p.tipo));
  const proximoTipo = ORDEM_PONTOS.find((t) => !tiposJaBatidos.has(t));
  const agora = new Date();
  const horaAtual = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataFormatada = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="brand-row"><div class="brand-dot"></div><span class="brand-name">ROSA JULIETA</span></div>
        <div class="brand-sub">Olá, ${esc(funcionaria.nome)}</div>
      </div>
      <button class="icon-btn-ghost" id="sairPonto">Sair</button>
    </div>
    <div class="content" style="max-width:420px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:13px;color:var(--text-muted);text-transform:capitalize">${dataFormatada}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:40px;font-weight:700;margin-top:4px">${horaAtual}</div>
      </div>

      ${proximoTipo ? `
        <button class="confirm-btn" id="baterPonto" data-tipo="${proximoTipo}" style="padding:20px;font-size:16px;margin-bottom:24px">
          🕐 Bater ${LABEL_PONTO[proximoTipo]}
        </button>
      ` : `
        <div class="empty-state" style="margin-bottom:24px">✅ Jornada de hoje completa!</div>
      `}

      ${(() => {
        const mesAtual = todayStr().slice(0, 7);
        const resumoMes = calcularResumoHolerite(funcionaria, mesAtual);
        const saldoMes = resumoMes.horasExtras + resumoMes.horasExtras100 - resumoMes.horasFaltantes;
        const extratoBancoMesPonto = calcularExtratoBancoHoras(funcionaria.id, mesAtual);
        const saldoTempoRealPonto = extratoBancoMesPonto.saldoAnterior + saldoMes;
        return `
          <div class="stats-grid" style="margin-bottom:24px">
            <div class="stat-card">
              <div class="stat-icon" style="background:${saldoMes >= 0 ? 'rgba(0,212,160,0.1)' : 'rgba(255,71,87,0.1)'}">⏱️</div>
              <div class="stat-label">Saldo do mês</div>
              <div class="stat-value" style="color:${saldoMes >= 0 ? 'var(--teal)' : 'var(--red)'}">${saldoMes >= 0 ? '+' : '-'}${formatarHorasMin(saldoMes)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:${saldoTempoRealPonto >= 0 ? 'rgba(0,212,160,0.1)' : 'rgba(255,71,87,0.1)'}">🏦</div>
              <div class="stat-label">Banco de horas (total)</div>
              <div class="stat-value" style="color:${saldoTempoRealPonto >= 0 ? 'var(--teal)' : 'var(--red)'}">${saldoTempoRealPonto >= 0 ? '+' : '-'}${formatarHorasMin(saldoTempoRealPonto)}</div>
              <div class="form-hint" style="margin-top:2px;font-size:10px">Já soma o saldo de meses anteriores + esse mês, em tempo real</div>
            </div>
          </div>
        `;
      })()}

      ${(() => {
        const dias = verificarPontosEsquecidos(funcionaria);
        const diasComAlgo = dias.filter((e) => e.tiposSemSolicitacao.length > 0 || e.tiposPendentesAprovacao.length > 0);
        if (diasComAlgo.length === 0) return '';
        return `
          <div class="form-card" style="border-color:var(--red)55;margin-bottom:24px">
            <div style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:6px">⚠️ Ponto pendente</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Preencha o horário certo e o motivo — a gestão vai aprovar.</div>
            ${diasComAlgo.map((e) => `
              <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px">
                <div style="font-size:12.5px;font-weight:600;margin-bottom:4px">${new Date(e.data + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
                ${e.tiposPendentesAprovacao.map((t) => `<div style="font-size:12px;color:var(--amber);padding:2px 0">⏳ ${LABEL_PONTO[t]} — aguardando aprovação</div>`).join('')}
                ${e.tiposSemSolicitacao.map((t) => {
                  const chave = `${e.data}_${t}`;
                  if (state.showSolicitarPontoId === chave) {
                    return `
                      <div class="entrada-box" style="margin-top:6px">
                        <div class="form-hint" style="margin-bottom:2px">${LABEL_PONTO[t]} — horário certo</div>
                        <input type="time" id="solicitarHora-${chave}" value="08:00" />
                        <input type="text" id="solicitarMotivo-${chave}" placeholder="Motivo (ex: esqueci, celular sem bateria...)" />
                        <div class="form-row">
                          <button class="confirm-btn" data-enviar-solicitacao="${chave}" data-func="${funcionaria.id}" data-data="${e.data}" data-tipo="${t}">Enviar</button>
                          <button class="toggle-btn" data-cancelar-solicitacao="1">Cancelar</button>
                        </div>
                      </div>
                    `;
                  }
                  return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0">
                      <span style="font-size:12px;color:var(--text-muted)">${LABEL_PONTO[t]} — sem batida</span>
                      <button class="trash-btn" data-abrir-solicitacao="${chave}">✏️ Corrigir</button>
                    </div>
                  `;
                }).join('')}
              </div>
            `).join('')}
          </div>
        `;
      })()}

      ${(() => {
        const pendente = state.holerites.find((h) => h.funcionariaId === funcionaria.id && !h.assinadoEm);
        if (!pendente) return '';
        const mesLabelTexto = new Date(pendente.mes + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return `
          <div class="form-card" style="border-color:var(--amber)55;margin-bottom:24px">
            <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:6px">📄 Holerite de ${mesLabelTexto}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Total: <strong style="color:var(--text)">${fmt(pendente.totalPagar)}</strong></div>
            <button class="icon-btn-ghost" style="margin-bottom:10px" data-baixar-pdf-holerite="${pendente.id}">🖨️ Ver PDF antes de assinar</button>
            <div class="form-hint" style="margin-bottom:4px">Assine com o dedo aqui embaixo:</div>
            <canvas id="assinaturaCanvas" width="335" height="150" style="background:#fff;border-radius:8px;width:100%;touch-action:none;cursor:crosshair;display:block"></canvas>
            <div class="form-row" style="margin-top:8px">
              <button class="toggle-btn" id="limparAssinatura">Limpar</button>
              <button class="confirm-btn" data-confirmar-assinatura="${pendente.id}">✅ Confirmar assinatura</button>
            </div>
          </div>
        `;
      })()}

      <div class="section-title-wrap"><div><div class="section-title">Hoje</div></div></div>
      ${pontosHoje.length === 0 ? `<div class="empty-state">Nenhuma batida ainda hoje.</div>` : `
        <div class="tx-list">
          ${pontosHoje.map((p) => `
            <div class="tx-row">
              <div class="tx-dot" style="background:var(--teal)"></div>
              <div style="flex:1"><div class="tx-categoria">${LABEL_PONTO[p.tipo] || p.tipo}</div></div>
              <div class="tx-valor">${new Date(p.horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('sairPonto').addEventListener('click', () => {
    localStorage.removeItem('rj_papel');
    localStorage.removeItem('rj_funcionaria_id');
    localStorage.removeItem('rj_ponto_expira_em');
    sessionStorage.removeItem('rj_papel_sessao');
    sessionStorage.removeItem('rj_funcionaria_id_sessao');
    state.papel = null;
    state.funcionariaLogadaId = null;
    render();
  });

  const baterBtn = document.getElementById('baterPonto');
  if (baterBtn) baterBtn.addEventListener('click', async () => {
    if (baterBtn.disabled) return; // já está processando, ignora clique duplicado
    const tipo = baterBtn.dataset.tipo;
    if (tiposJaBatidos.has(tipo)) {
      const jaBatido = pontosHoje.find((p) => p.tipo === tipo);
      const horaJaBatida = jaBatido ? new Date(jaBatido.horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
      if (!confirm(`Você já registrou ${LABEL_PONTO[tipo]} hoje às ${horaJaBatida}.\n\nTem certeza que quer registrar de novo? Isso vai criar um segundo registro do mesmo tipo.`)) return;
    } else if (!confirm(`Confirmar ${LABEL_PONTO[tipo]} agora (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})?`)) return;
    baterBtn.disabled = true;
    const textoOriginal = baterBtn.textContent;
    baterBtn.textContent = 'Registrando...';
    const sucesso = await registrarPonto(funcionaria.id, tipo);
    if (!sucesso) {
      baterBtn.disabled = false;
      baterBtn.textContent = textoOriginal;
      return;
    }
    await loadData();
  });

  document.querySelectorAll('[data-abrir-solicitacao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.showSolicitarPontoId = btn.dataset.abrirSolicitacao; render(); });
  });
  document.querySelectorAll('[data-cancelar-solicitacao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.showSolicitarPontoId = null; render(); });
  });
  document.querySelectorAll('[data-enviar-solicitacao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const chave = btn.dataset.enviarSolicitacao;
      const funcionariaId = btn.dataset.func;
      const data = btn.dataset.data;
      const tipo = btn.dataset.tipo;
      const hora = document.getElementById(`solicitarHora-${chave}`).value;
      const motivo = document.getElementById(`solicitarMotivo-${chave}`).value.trim();
      if (!hora) { alert('Preencha o horário.'); return; }
      const horarioISO = new Date(`${data}T${hora}:00`).toISOString();
      await addSolicitacaoPonto(funcionariaId, data, tipo, horarioISO, motivo);
      state.showSolicitarPontoId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-baixar-pdf-holerite]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const holerite = state.holerites.find((h) => h.id === btn.dataset.baixarPdfHolerite);
      if (!holerite) return;
      const horasBancoUsadas = state.abonosPonto.filter((a) => a.funcionariaId === holerite.funcionariaId && a.data.slice(0, 7) === holerite.mes && a.horas != null).reduce((acc, a) => acc + a.horas, 0);
      const horasBancoPagasDinheiro = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === holerite.funcionariaId && b.data.slice(0, 7) === holerite.mes && b.descricao && b.descricao.startsWith('Pago em dinheiro')).reduce((acc, b) => acc + Math.abs(b.horas), 0);
      const valorBancoPagoDinheiro = state.tx.filter((t) => t.tipo === 'saida' && monthKey(t.data) === holerite.mes && t.descricao && t.descricao.startsWith(`Pagamento de banco de horas — ${funcionaria.nome}`)).reduce((acc, t) => acc + t.valor, 0);
      gerarHoleritePDF(funcionaria, holerite.mes, { ...holerite, horasBancoUsadas, horasBancoPagasDinheiro, valorBancoPagoDinheiro });
    });
  });

  // canvas de assinatura — desenha com o dedo (touch) ou mouse
  const assinaturaCanvas = document.getElementById('assinaturaCanvas');
  if (assinaturaCanvas) {
    const ctx = assinaturaCanvas.getContext('2d');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    let desenhando = false;
    let temTraço = false;
    const posicao = (e) => {
      const rect = assinaturaCanvas.getBoundingClientRect();
      const escalaX = assinaturaCanvas.width / rect.width;
      const escalaY = assinaturaCanvas.height / rect.height;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (clientX - rect.left) * escalaX, y: (clientY - rect.top) * escalaY };
    };
    const iniciar = (e) => { desenhando = true; temTraço = true; const p = posicao(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const desenhar = (e) => { if (!desenhando) return; const p = posicao(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const parar = () => { desenhando = false; };
    assinaturaCanvas.addEventListener('mousedown', iniciar);
    assinaturaCanvas.addEventListener('mousemove', desenhar);
    assinaturaCanvas.addEventListener('mouseup', parar);
    assinaturaCanvas.addEventListener('mouseleave', parar);
    assinaturaCanvas.addEventListener('touchstart', iniciar, { passive: false });
    assinaturaCanvas.addEventListener('touchmove', desenhar, { passive: false });
    assinaturaCanvas.addEventListener('touchend', parar);

    const limparBtn = document.getElementById('limparAssinatura');
    if (limparBtn) limparBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, assinaturaCanvas.width, assinaturaCanvas.height);
      temTraço = false;
    });

    document.querySelectorAll('[data-confirmar-assinatura]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!temTraço) { alert('Assine com o dedo na tela antes de confirmar.'); return; }
        if (!confirm('Confirmar essa assinatura? Fica registrada com data e hora, em nome dela.')) return;
        const imagemBase64 = assinaturaCanvas.toDataURL('image/png');
        await confirmarAssinaturaHolerite(btn.dataset.confirmarAssinatura, imagemBase64);
        await loadData();
      });
    });
  }
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
    const valorItem = valorProducaoItem(p);
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
    if ((window.__prodSupTipo || 'producao') === 'producao' && varianteSelect && !varianteId) { alert('Selecione a cor.'); return; }
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
// ---- Preferência de colunas por grade (salva no aparelho) ----
function getColunasConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('rj_layout_colunas') || '{}'); } catch (e) { saved = {}; }
  return saved;
}
function salvarColunasConfig(chave, valor) {
  const config = getColunasConfig();
  config[chave] = valor;
  localStorage.setItem('rj_layout_colunas', JSON.stringify(config));
}
function gridColumnsStyle(chave, minWidthPx) {
  const valor = getColunasConfig()[chave] || 'auto';
  if (valor === 'auto') return `repeat(auto-fill, minmax(${minWidthPx}px, 1fr))`;
  return `repeat(${valor}, 1fr)`;
}
function renderControleColunas(chave) {
  const valor = getColunasConfig()[chave] || 'auto';
  return `
    <select class="controle-colunas" data-colunas-chave="${chave}" style="width:auto;font-size:11.5px;padding:6px 10px">
      <option value="auto" ${valor === 'auto' ? 'selected' : ''}>↕️ Auto</option>
      <option value="1" ${valor === '1' ? 'selected' : ''}>▤ Lista (1 col)</option>
      <option value="2" ${valor === '2' ? 'selected' : ''}>▦ 2 colunas</option>
      <option value="3" ${valor === '3' ? 'selected' : ''}>▦ 3 colunas</option>
      <option value="4" ${valor === '4' ? 'selected' : ''}>▦ 4 colunas</option>
    </select>
  `;
}
// ---- Materiais (matéria-prima + insumos) ----
function renderMateriais(c) {
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Matéria-prima</div><div class="section-subtitle">Rolos de tecido em estoque, por cor</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${renderControleColunas('materiais')}
        <button class="icon-btn" id="toggleCompraTecido">＋ Comprar</button>
      </div>
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
        <div class="form-hint" style="margin-bottom:2px">Forma de pagamento</div>
        <select id="tecidoCartaoSelect" data-toggle-parcelas-select="tecidoParcelasBox">
          <option value="">Outro (à vista, PIX, boleto...)</option>
          ${state.cartoesCredito.filter((cc) => cc.ativo !== false).map((cc) => `<option value="${cc.id}">${esc(cc.nome)}</option>`).join('')}
        </select>
        <div id="tecidoParcelasBox" style="display:none">
          <div class="form-hint" style="margin-bottom:2px">💳 Em quantas vezes? (1 = à vista, sem parcelar)</div>
          <input type="text" id="tecidoNumParcelas" placeholder="Número de parcelas" inputmode="numeric" value="1" />
          <div class="form-hint">A data de cada parcela é calculada sozinha, pelo fechamento/vencimento do cartão — não pela data da compra.</div>
        </div>
        <button class="confirm-btn" id="salvarCompraTecido">Registrar compra</button>
      </div>
    ` : ''}

    ${state.materiaPrima.length === 0 ? `<div class="empty-state">Nenhum tecido cadastrado ainda.</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('materiais', 150)};gap:10px;margin-bottom:28px">
        ${state.materiaPrima.map((m) => {
          if (state.editingMateriaPrimaId === m.id) {
            return `
              <div class="form-card" style="grid-column:1 / -1">
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
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:8px;height:8px;min-width:8px;border-radius:50%;background:${m.rolosDisponiveis > 0 ? 'var(--teal)' : 'var(--red)'}"></div>
              <div style="font-size:13px;font-weight:600;color:var(--text);line-height:1.3">${esc(m.cor)}</div>
            </div>
            <div style="font-size:20px;font-weight:700;color:var(--text)">${m.rolosDisponiveis}<span style="font-size:12px;font-weight:400;color:var(--text-muted)"> rolo(s)</span></div>
            <div style="font-size:12px;color:var(--text-muted)">${fmt(m.custoMedioRolo)}/rolo</div>
            <div style="display:flex;gap:6px;margin-top:2px">
              <button class="trash-btn" data-editar-mp="${m.id}">✏️</button>
              <button class="trash-btn" data-remover-mp="${m.id}">🗑</button>
            </div>
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
        <select id="insumoSelect">
          <option value="" ${!window.__insumoSelecionado ? 'selected' : ''}>Selecione o insumo...</option>
          ${state.insumos.map((i) => `<option value="${esc(i.nome)}" ${window.__insumoSelecionado === i.nome ? 'selected' : ''}>${esc(i.nome)} (${i.quantidadeDisponivel} ${esc(i.unidade)} em estoque)</option>`).join('')}
          <option value="__novo__" ${window.__insumoNovo ? 'selected' : ''}>➕ Novo insumo</option>
        </select>
        ${window.__insumoNovo ? `<input type="text" id="insumoNomeNovo" placeholder="Nome do novo insumo (ex: Zíper 20cm)" value="${esc(window.__insumoNomeNovoTexto || '')}" />` : ''}
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
        <div class="form-hint" style="margin-bottom:2px">Forma de pagamento</div>
        <select id="insumoCartaoSelect" data-toggle-parcelas-select="insumoParcelasBox">
          <option value="">Outro (à vista, PIX, boleto...)</option>
          ${state.cartoesCredito.filter((cc) => cc.ativo !== false).map((cc) => `<option value="${cc.id}">${esc(cc.nome)}</option>`).join('')}
        </select>
        <div id="insumoParcelasBox" style="display:none">
          <div class="form-hint" style="margin-bottom:2px">💳 Em quantas vezes? (1 = à vista, sem parcelar)</div>
          <input type="text" id="insumoNumParcelas" placeholder="Número de parcelas" inputmode="numeric" value="1" />
          <div class="form-hint">A data de cada parcela é calculada sozinha, pelo fechamento/vencimento do cartão.</div>
        </div>
        <button class="confirm-btn" id="salvarCompraInsumo">Registrar compra</button>
      </div>
    ` : ''}

    ${state.insumos.length === 0 ? `<div class="empty-state">Nenhum insumo cadastrado ainda.</div>` : `
      <div class="tx-list">
        ${state.insumos.map((i) => {
          if (state.editingInsumoId === i.id) {
            return `
              <div class="form-card">
                <input type="text" id="editInsumoNome-${i.id}" placeholder="Nome" value="${esc(i.nome)}" />
                <input type="text" id="editInsumoQtd-${i.id}" placeholder="Quantidade disponível" value="${i.quantidadeDisponivel}" />
                <input type="text" id="editInsumoMinimo-${i.id}" placeholder="Quantidade mínima (alerta)" value="${i.quantidadeMinima || ''}" />
                <div class="form-hint">Preencha o valor TOTAL pago por essa quantidade — o custo médio é calculado sozinho.</div>
                <div class="form-row">
                  <input type="text" id="editInsumoValorTotal-${i.id}" placeholder="Valor total pago (R$)" inputmode="decimal" />
                  <input type="text" id="editInsumoCusto-${i.id}" placeholder="Custo médio por unidade (R$)" value="${i.custoMedioUnitario.toFixed(2).replace('.', ',')}" />
                </div>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-insumo="${i.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-insumo="${i.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          return `
          <div class="tx-row">
            <div class="tx-dot" style="background:${i.quantidadeDisponivel <= 0 ? 'var(--red)' : (i.quantidadeMinima > 0 && i.quantidadeDisponivel <= i.quantidadeMinima) ? 'var(--amber)' : 'var(--teal)'}"></div>
            <div style="flex:1"><div class="tx-categoria">${esc(i.nome)}${i.usadoNoEnvio ? ' <span style="font-size:10px;font-weight:600;color:var(--amber);border:1px solid var(--amber)55;border-radius:4px;padding:1px 5px;vertical-align:middle">POR PEDIDO</span>' : ''}</div><div class="tx-desc">${fmt(i.custoMedioUnitario)}/${esc(i.unidade)} (média)${i.quantidadeMinima > 0 ? ` · mín. ${i.quantidadeMinima}` : ''}</div></div>
            ${state.showBaixaInsumoId === i.id ? `
              <input type="text" id="baixaQtd-${i.id}" placeholder="Qtd usada" style="width:70px;margin-right:6px" />
              <button class="confirm-btn" style="width:auto;padding:8px 10px" data-confirmar-baixa="${i.id}">OK</button>
            ` : `
              <div class="tx-valor" style="margin-right:6px">${i.quantidadeDisponivel} ${esc(i.unidade)}</div>
              <button class="trash-btn" data-abrir-baixa="${i.id}">➖</button>
            `}
            <button class="trash-btn" data-toggle-envio="${i.id}" data-envio="${i.usadoNoEnvio}" title="${i.usadoNoEnvio ? 'Descontar por peça (produção/venda), não por pedido' : 'Marcar como usado 1x por pedido enviado (ex: envelope, etiqueta de rastreio)'}">${i.usadoNoEnvio ? '📦✅' : '📦'}</button>
            ${i.usadoNoEnvio ? `<button class="trash-btn" data-config-envio="${i.id}" title="Quantidade por plataforma">⚙️</button>` : ''}
            <button class="trash-btn" data-editar-insumo="${i.id}">✏️</button>
            <button class="trash-btn" data-remover-insumo="${i.id}">🗑</button>
          </div>
          ${state.configEnvioInsumoId === i.id ? `
            <div class="entrada-box">
              <div class="form-hint">Quantas unidades de "${esc(i.nome)}" cada plataforma usa por pedido? Deixa em 1 se for igual pra todas (padrão).</div>
              ${state.plataformas.map((plat) => `
                <div class="form-row">
                  <div style="flex:1;display:flex;align-items:center;font-size:13px">${esc(plat.nome)}</div>
                  <input type="text" id="qtdEnvio-${i.id}-${plat.id}" value="${qtdInsumoPorPedido(i.id, plat.id)}" inputmode="numeric" style="flex:0 0 70px" />
                </div>
              `).join('')}
              <div class="form-row" style="border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
                <div style="flex:1;display:flex;align-items:center;font-size:13px">🧾 Venda manual <span style="color:var(--text-muted);margin-left:6px">(atacado, feira etc)</span></div>
                <input type="text" id="qtdEnvioManual-${i.id}" value="${i.qtdVendaManual}" inputmode="numeric" style="flex:0 0 70px" />
              </div>
              <div class="form-row">
                <button class="confirm-btn" data-salvar-qtd-envio="${i.id}">Salvar</button>
                <button class="toggle-btn" data-cancelar-qtd-envio="1">Cancelar</button>
              </div>
            </div>
          ` : ''}
        `;
        }).join('')}
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
      <div style="display:flex;gap:8px;align-items:center">
        ${renderControleColunas('corteAguardando')}
        <button class="icon-btn" id="toggleOrdemCorte">＋ Enviar corte</button>
      </div>
    </div>

    ${state.showOrdemCorteForm ? `
      <div class="form-card">
        <div class="form-row">
          <button class="toggle-btn ${(window.__ordemTipo || 'principal') === 'principal' ? 'active-teal' : ''}" data-ordem-tipo="principal">✂️ Corte principal</button>
          <button class="toggle-btn ${window.__ordemTipo === 'retalho' ? 'active-pink' : ''}" data-ordem-tipo="retalho">♻️ Corte de retalhos</button>
        </div>
        ${(window.__ordemTipo || 'principal') === 'principal' ? `
          <div class="form-hint" style="margin-bottom:2px">Mandando mais de uma cor pro mesmo corte (cortadas juntas)? Adiciona uma linha pra cada cor.</div>
          ${Array.from({ length: window.__numCoresOrdemCorte || 1 }, (_, i) => `
            <div style="border-top:${i > 0 ? '1px solid var(--border)' : 'none'};padding-top:${i > 0 ? '8px' : '0'};margin-top:${i > 0 ? '8px' : '0'}">
              <select id="ordemCor-${i}">
                <option value="">Selecione a cor</option>
                ${state.materiaPrima.map((m) => `<option value="${esc(m.cor)}" data-custo="${m.custoMedioRolo}">${esc(m.cor)} (${m.rolosDisponiveis} disponível)</option>`).join('')}
              </select>
              <div class="form-row">
                <input type="text" id="ordemRolos-${i}" placeholder="Quantidade de rolos enviados" inputmode="numeric" />
                <input type="text" id="ordemValor-${i}" placeholder="Valor do tecido usado (R$)" />
              </div>
            </div>
          `).join('')}
          <button class="entrada-btn" type="button" id="adicionarCorOrdemCorte">＋ Adicionar outra cor</button>
          <input type="text" id="ordemValorCorte" placeholder="Valor do corte, se pagar à parte (opcional) — total do lote, dividido entre as cores" style="margin-top:8px" />
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
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('corteAguardando', 240)};gap:10px;margin-bottom:20px">
        ${(() => {
          // agrupa por grupoId (cores cortadas juntas viram 1 card só); ordens sem grupo
          // continuam cada uma com seu próprio card, como sempre foi
          const jaRenderizado = new Set();
          const cartoes = [];
          aguardando.forEach((o) => {
            if (jaRenderizado.has(o.id)) return;
            if (o.grupoId) {
              const doGrupo = aguardando.filter((x) => x.grupoId === o.grupoId);
              doGrupo.forEach((x) => jaRenderizado.add(x.id));
              cartoes.push({ tipo: 'grupo', ordens: doGrupo });
            } else {
              jaRenderizado.add(o.id);
              cartoes.push({ tipo: 'individual', ordens: [o] });
            }
          });
          return cartoes.map(({ tipo, ordens: ordensDoCartao }) => {
            const o = ordensDoCartao[0];
            if (state.editingOrdemCorteId === o.id) {
              return `
                <div class="form-card" style="grid-column:1 / -1">
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

            if (tipo === 'grupo') {
              const chaveGrupo = o.grupoId;
              const expandidoGrupo = state.grupoConcluindoId === chaveGrupo;
              const totalRolosGrupo = ordensDoCartao.reduce((a, x) => a + x.quantidadeRolos, 0);
              const totalTecidoGrupo = ordensDoCartao.reduce((a, x) => a + x.valorTecido, 0);
              const totalCorteGrupo = ordensDoCartao.reduce((a, x) => a + x.valorCorte, 0);
              return `
              <div class="produto-card" style="border-color:var(--teal)55${expandidoGrupo ? ';grid-column:1 / -1' : ''}">
                <div class="produto-header">
                  <div>
                    <div class="produto-nome">🔗 ${ordensDoCartao.map((x) => esc(x.cor)).join(' + ')} — ${totalRolosGrupo} rolo(s)</div>
                    <div class="produto-sku">Enviado em ${o.dataEnvio} · ${fmt(totalTecidoGrupo + totalCorteGrupo)} no total · 🟡 Aguardando resultado</div>
                  </div>
                </div>
                <div class="prod-breakdown" style="margin-top:6px">
                  ${ordensDoCartao.map((x) => `<div class="prod-breakdown-item"><span>${esc(x.cor)} — ${x.quantidadeRolos} rolo(s)</span><span>${fmt(x.valorTecido + x.valorCorte)}<button class="trash-btn" style="padding:2px 4px" data-editar-ordem="${x.id}">✏️</button><button class="trash-btn" style="padding:2px 4px" data-remover-ordem="${x.id}">🗑</button></span></div>`).join('')}
                </div>
                ${expandidoGrupo ? `
                  <div class="entrada-box">
                    <div class="form-hint">Quantas peças de cada modelo saíram desse corte (total, sem separar por cor — o sistema divide o custo sozinho, proporcional aos rolos de cada cor)?</div>
                    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `
                      <div class="form-row">
                        <select id="grupoItemProduto-${chaveGrupo}-${i}">
                          <option value="">Modelo (opcional)</option>
                          ${state.produtos.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}
                        </select>
                        <input type="text" id="grupoItemQtd-${chaveGrupo}-${i}" placeholder="Peças (total, misturadas)" inputmode="numeric" />
                      </div>
                    `).join('')}
                    <div class="form-row">
                      <button class="confirm-btn" data-confirmar-conclusao-grupo="${chaveGrupo}">Salvar resultado</button>
                      <button class="toggle-btn" data-cancelar-conclusao-grupo="1">Cancelar</button>
                    </div>
                  </div>
                ` : `<button class="entrada-btn" data-abrir-conclusao-grupo="${chaveGrupo}">📋 Registrar resultado do corte</button>`}
              </div>
              `;
            }

            const expandido = state.ordemConcluindoId === o.id;
            return `
            <div class="produto-card" style="border-color:var(--amber)55${expandido ? ';grid-column:1 / -1' : ''}">
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
              ${expandido ? `
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
          }).join('');
        })()}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Cortes concluídos</div></div>
      ${renderControleColunas('corteConcluidos')}
    </div>
    ${concluidas.length === 0 ? `<div class="empty-state">Nenhum corte concluído ainda.</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('corteConcluidos', 240)};gap:10px">
        ${(() => {
          const jaRenderizadoConcluido = new Set();
          const listaDeduplicada = [];
          concluidas.forEach((o) => {
            if (jaRenderizadoConcluido.has(o.id)) return;
            if (o.grupoId) {
              const doGrupo = concluidas.filter((x) => x.grupoId === o.grupoId);
              doGrupo.forEach((x) => jaRenderizadoConcluido.add(x.id));
              // usa como card principal quem realmente tem os itens registrados (o "representante"
              // escolhido lá na hora de fechar o resultado do corte em grupo)
              const comItens = doGrupo.find((x) => state.ordensCorteItens.some((i) => i.ordemId === x.id));
              listaDeduplicada.push(comItens || doGrupo[0]);
            } else {
              jaRenderizadoConcluido.add(o.id);
              listaDeduplicada.push(o);
            }
          });
          return listaDeduplicada;
        })().map((o) => {
          if (state.editingOrdemCorteId === o.id) {
            return `
              <div class="form-card" style="grid-column:1 / -1">
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
          const outrasDoGrupoConcluida = o.grupoId ? state.ordensCorte.filter((x) => x.grupoId === o.grupoId && x.id !== o.id) : [];
          const membrosDoGrupo = [o, ...outrasDoGrupoConcluida];
          // se for corte em grupo (várias cores juntas), o custo e o rendimento consideram
          // o lote inteiro — os itens ficam registrados numa ordem só, mas o custo é de
          // todas as cores que entraram no corte misturado
          const totalPecas = o.grupoId
            ? membrosDoGrupo.reduce((a, m) => a + state.ordensCorteItens.filter((i) => i.ordemId === m.id).reduce((a2, i) => a2 + i.quantidade, 0), 0)
            : itens.reduce((a, i) => a + i.quantidade, 0);
          const custoTotal = o.grupoId
            ? membrosDoGrupo.reduce((a, m) => a + m.valorTecido + m.valorCorte, 0)
            : o.valorTecido + o.valorCorte;
          const totalRolosCombo = o.grupoId ? membrosDoGrupo.reduce((a, m) => a + m.quantidadeRolos, 0) : o.quantidadeRolos;
          const custoPorPeca = totalPecas > 0 ? custoTotal / totalPecas : 0;
          const rendimento = totalRolosCombo > 0 ? totalPecas / totalRolosCombo : null;
          const outrasDaCor = concluidas.filter((x) => x.id !== o.id && x.cor === o.cor && x.tipo === 'principal');
          const rendimentosAnteriores = outrasDaCor.map((x) => {
            const its = state.ordensCorteItens.filter((i) => i.ordemId === x.id);
            const tot = its.reduce((a, i) => a + i.quantidade, 0);
            return x.quantidadeRolos > 0 ? tot / x.quantidadeRolos : null;
          }).filter((v) => v !== null);
          const mediaAnterior = rendimentosAnteriores.length ? rendimentosAnteriores.reduce((a, v) => a + v, 0) / rendimentosAnteriores.length : null;

          return `
            <div class="produto-card"${state.distribuindoOrdemId === o.id ? ' style="grid-column:1 / -1"' : ''}>
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${outrasDoGrupoConcluida.length > 0 ? `🔗 ${membrosDoGrupo.map((x) => esc(x.cor)).join(' + ')} — ${totalRolosCombo} rolo(s)` : `${o.tipo === 'retalho' ? '♻️ ' : ''}${esc(o.cor)}${o.quantidadeRolos > 0 ? ` — ${o.quantidadeRolos} rolo(s)` : ''}`}</div>
                  <div class="produto-sku">${o.dataEnvio} → ${o.dataConclusao} · ${fmt(custoTotal)} no total</div>
                  ${outrasDoGrupoConcluida.length > 0 ? `<div style="font-size:11px;color:var(--teal);margin-top:2px">${membrosDoGrupo.map((x) => `${esc(x.cor)} (${fmt(x.valorTecido + x.valorCorte)})`).join(' + ')}</div>` : ''}
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-editar-ordem="${o.id}">✏️</button>
                  <button class="trash-btn" data-remover-ordem="${o.id}">🗑</button>
                </div>
              </div>
              <div class="prod-breakdown">
                ${itens.map((i) => {
                  const produto = state.produtos.find((p) => p.id === i.produtoId);
                  const jaDistribuido = state.distribuicoes.filter((d) => d.ordemItemId === i.id).reduce((a, d) => a + d.quantidadeDistribuida, 0);
                  const restante = i.quantidade - jaDistribuido;
                  const status = restante <= 0
                    ? `<span style="color:var(--teal)">✅ distribuído</span>`
                    : `<span style="color:var(--amber)">⚠️ faltam ${restante}</span>`;
                  return `<div class="prod-breakdown-item"><span>${esc(produto?.nome || 'Produto removido')}</span><span>${i.quantidade} peças · ${status}</span></div>`;
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
                        ${restante > 0 ? `
                          <div class="form-row">
                            <select id="distCostureira-${i.id}">
                              <option value="">Costureira</option>
                              ${state.costureiras.filter((c) => c.ativa).map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}
                            </select>
                            <input type="text" id="distQtd-${i.id}" placeholder="Quantidade" inputmode="numeric" max="${restante}" />
                          </div>
                          <select id="distVariante-${i.id}" data-dist-variante-select="${i.id}">
                            <option value="">Sem cor específica</option>
                            ${vs.map((v) => `<option value="${v.id}">${esc(v.nome)}</option>`).join('')}
                            <option value="__nova__">➕ Nova cor</option>
                            ${vs.length > 1 ? `<option value="__misto__">🔀 Corte misturado (dividir entre cores já cadastradas)</option>` : ''}
                          </select>
                          <input type="text" id="distVarianteNova-${i.id}" placeholder="Nome da nova cor" style="display:none;margin-top:6px" />
                          <div id="distMisto-${i.id}" style="display:none;margin-top:6px">
                            <div class="form-hint" style="margin-bottom:6px">Quantas peças dessa distribuição são de cada cor:</div>
                            ${vs.map((v) => `
                              <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
                                <div style="flex:none;font-size:13px;white-space:nowrap;min-width:120px">${esc(v.nome)}</div>
                                <input type="text" id="distMistoQtd-${i.id}-${v.id}" placeholder="Qtd" inputmode="numeric" style="flex:none;width:70px" />
                              </div>
                            `).join('')}
                          </div>
                          <button class="entrada-btn" data-confirmar-distribuicao="${i.id}" data-produto="${i.produtoId}" data-restante="${restante}">＋ Adicionar distribuição</button>
                        ` : `
                          <div class="empty-state" style="margin-bottom:0;padding:12px 0">✅ Distribuição completa — nada mais pra distribuir desse modelo</div>
                        `}
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
  const circunferencia = 2 * Math.PI * 50;
  const arcoFixo = (pctFixo / 100) * circunferencia;
  const arcoVariavel = (pctVariavel / 100) * circunferencia;

  // maiores categorias de gasto no mês (fixo + variável juntos, ordenado)
  const porCategoria = {};
  c.txMes.filter((t) => t.tipo === 'saida').forEach((t) => {
    if (!porCategoria[t.categoria]) porCategoria[t.categoria] = { valor: 0, natureza: t.natureza };
    porCategoria[t.categoria].valor += t.valor;
  });
  const categoriasOrdenadas = Object.entries(porCategoria).sort((a, b) => b[1].valor - a[1].valor);
  const maiorValor = categoriasOrdenadas.length ? categoriasOrdenadas[0][1].valor : 1;

  return `
    <div class="form-card">
      <div class="section-title" style="margin-bottom:2px">Custos fixos x variáveis</div>
      <div class="section-subtitle" style="margin-bottom:14px">Baseado nos lançamentos do mês selecionado</div>
      ${c.custoFixo + c.custoVariavel === 0 ? `<div class="empty-state">Nenhuma saída lançada neste mês ainda.</div>` : `
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:22px">
          <svg viewBox="0 0 120 120" width="110" height="110" style="flex-shrink:0">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface2)" stroke-width="16" />
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--pink)" stroke-width="16"
              stroke-dasharray="${arcoFixo} ${circunferencia}" stroke-linecap="round" transform="rotate(-90 60 60)" />
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--teal)" stroke-width="16"
              stroke-dasharray="${arcoVariavel} ${circunferencia}" stroke-dashoffset="${-arcoFixo}" stroke-linecap="round" transform="rotate(-90 60 60)" />
          </svg>
          <div style="flex:1;min-width:150px">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Total de saídas no mês</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700;margin-bottom:10px">${fmt(c.custoFixo + c.custoVariavel)}</div>
            <div class="custo-legend">
              <div class="custo-legend-item"><span class="legend-dot" style="background:var(--pink)"></span>Fixos — ${fmt(c.custoFixo)} (${pctFixo}%)</div>
              <div class="custo-legend-item"><span class="legend-dot" style="background:var(--teal)"></span>Variáveis — ${fmt(c.custoVariavel)} (${pctVariavel}%)</div>
            </div>
          </div>
        </div>

        <div class="section-title" style="margin-bottom:10px;font-size:13px">Maiores categorias de gasto</div>
        <div style="display:flex;flex-direction:column;gap:9px">
          ${categoriasOrdenadas.slice(0, 8).map(([cat, info]) => `
            <div>
              <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">
                <span>${esc(cat)}</span>
                <span style="color:var(--text-muted);font-family:'IBM Plex Mono',monospace">${fmt(info.valor)}</span>
              </div>
              <div style="height:8px;border-radius:4px;background:var(--surface2);overflow:hidden">
                <div style="height:100%;width:${Math.max(4, (info.valor / maiorValor) * 100)}%;background:${info.natureza === 'fixo' ? 'var(--pink)' : 'var(--teal)'}"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}
// semáforo de contas a vencer: verde longe do prazo, âmbar alerta, vermelho vence hoje/amanhã
function renderContasAVencer(c) {
  const corUrgencia = (dias) => (dias <= 1 ? 'var(--red)' : dias <= 3 ? 'var(--amber)' : 'var(--teal)');
  return `
    ${c.contasVencidasNaoConfirmadas.length > 0 ? `
      <div class="section-title-wrap">
        <div><div class="section-title" style="color:var(--red)">🔴 Vencidas sem confirmação</div><div class="section-subtitle">A data já passou e ninguém marcou como pago — confere se não foi esquecida</div></div>
      </div>
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('contasVencidas', 240)};gap:8px;margin-bottom:24px">
        ${c.contasVencidasNaoConfirmadas.map((t) => `
          <div class="alert-card" style="border-color:var(--red)">
            <div class="alert-card-row">
              <div class="alert-dot" style="background:var(--red)"></div>
              <div style="flex:1">
                <div class="alert-name">${esc(t.categoria)}</div>
                ${t.descricao ? `<div class="alert-meta" style="margin-top:0">${esc(t.descricao)}</div>` : ''}
                <div class="alert-status" style="color:var(--red)">${t.diasVencida === 0 ? '🔴 Venceu hoje' : `🔴 Venceu há ${t.diasVencida} dia(s)`} — ${fmt(t.valor)}</div>
              </div>
            </div>
            <button class="confirm-btn" style="background:var(--teal);margin-top:8px" data-marcar-pago="${t.id}">✅ Marcar como pago</button>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="section-title-wrap">
      <div><div class="section-title">Contas a vencer</div><div class="section-subtitle">Próximos 7 dias — ainda não descontadas do saldo</div></div>
      ${renderControleColunas('contasAVencer')}
    </div>
    ${c.contasAVencer.length === 0 ? `<div class="empty-state">Nenhuma conta vencendo nos próximos 7 dias 🎉</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('contasAVencer', 240)};gap:8px;margin-bottom:20px">
        ${c.contasAVencer.map((t) => `
          <div class="alert-card" style="border-color:${corUrgencia(t.diasParaVencer)}55">
            <div class="alert-card-row">
              <div class="alert-dot" style="background:${corUrgencia(t.diasParaVencer)}"></div>
              <div style="flex:1">
                <div class="alert-name">${esc(t.categoria)}</div>
                ${t.descricao ? `<div class="alert-meta" style="margin-top:0">${esc(t.descricao)}</div>` : ''}
                <div class="alert-status" style="color:${corUrgencia(t.diasParaVencer)}">${t.diasParaVencer === 0 ? '📅 Vence hoje' : t.diasParaVencer === 1 ? '📅 Vence amanhã' : `📅 Vence em ${t.diasParaVencer} dias`} — ${fmt(t.valor)}</div>
              </div>
            </div>
            <button class="confirm-btn" style="background:var(--teal);margin-top:8px" data-marcar-pago="${t.id}">✅ Marcar como pago</button>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

// ---- Empréstimos ----
function renderEmprestimos(c) {
  const hoje = todayStr();
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Empréstimos</div><div class="section-subtitle">Saldo devedor e parcelas</div></div>
      <button class="icon-btn-ghost" id="toggleEmprestimoForm">＋ Novo empréstimo</button>
    </div>

    ${state.showEmprestimoForm ? `
      <div class="form-card">
        <input type="text" id="empDescricao" placeholder="Descrição (ex: Capital de giro)" />
        <input type="text" id="empInstituicao" placeholder="Instituição/Banco (opcional)" />
        <div class="form-row">
          <input type="text" id="empValorRecebido" placeholder="Valor recebido (R$)" inputmode="decimal" />
          <input type="date" id="empDataRecebimento" value="${hoje}" />
        </div>
        <div class="form-row">
          <input type="text" id="empNumParcelas" placeholder="Número de parcelas" inputmode="numeric" />
          <input type="text" id="empValorParcela" placeholder="Valor de cada parcela (R$)" inputmode="decimal" />
        </div>
        <div class="form-hint">O valor da parcela pode ser diferente do (valor recebido ÷ parcelas) por causa dos juros — coloca o valor exato que sai do banco todo mês. Se deixar em branco, calcula dividindo igual.</div>
        <div class="form-hint" style="margin-bottom:2px">Data da 1ª parcela</div>
        <input type="date" id="empDataPrimeiraParcela" value="${hoje}" />
        <button class="confirm-btn" id="salvarEmprestimo">Criar empréstimo</button>
      </div>
    ` : ''}

    ${state.emprestimos.length === 0 ? `<div class="empty-state">Nenhum empréstimo cadastrado.</div>` : `
      <div class="produto-list" style="margin-bottom:20px">
        ${state.emprestimos.map((e) => {
          const parcelas = state.emprestimoParcelas.filter((p) => p.emprestimoId === e.id).sort((a, b) => a.numero - b.numero);
          const pagas = parcelas.filter((p) => p.dataVencimento <= hoje);
          const restantes = parcelas.filter((p) => p.dataVencimento > hoje);
          const saldoDevedor = restantes.reduce((a, p) => a + p.valor, 0);
          const proxima = restantes[0];
          if (state.editingEmprestimoValorId === e.id) {
            return `
              <div class="form-card">
                <div class="produto-nome" style="margin-bottom:4px">${esc(e.descricao)}${e.instituicao ? ' — ' + esc(e.instituicao) : ''}</div>
                <div class="form-hint">Corrige o valor que realmente caiu na sua conta (o "valor liberado" do banco pode ser menor que o "valor contratado", por causa de IOF/tarifas). Isso não muda as parcelas nem os juros, só o lançamento de entrada no Financeiro.</div>
                <input type="text" id="editEmpValorRecebido-${e.id}" placeholder="Valor recebido (R$)" value="${e.valorRecebido.toFixed(2).replace('.', ',')}" />
                <div class="form-hint" style="margin-bottom:2px">Data que o dinheiro realmente caiu na conta</div>
                <input type="date" id="editEmpDataRecebimento-${e.id}" value="${e.dataRecebimento}" />
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-valor-emprestimo="${e.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-valor-emprestimo="1">Cancelar</button>
                </div>
              </div>
            `;
          }
          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(e.descricao)}${e.instituicao ? ' — ' + esc(e.instituicao) : ''}</div>
                  <div class="produto-sku">Recebido ${fmt(e.valorRecebido)} em ${new Date(e.dataRecebimento + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-editar-valor-emprestimo="${e.id}">✏️</button>
                  <button class="trash-btn" data-remover-emprestimo="${e.id}">🗑</button>
                </div>
              </div>
              <div class="produto-meta" style="margin-left:0;margin-top:6px">Parcelas: <strong style="color:var(--text)">${pagas.length}/${parcelas.length} pagas</strong></div>
              <div class="produto-meta" style="margin-left:0;margin-top:4px">Total restante a pagar <span style="font-size:10px">(com juros das parcelas futuras)</span>: <strong style="color:var(--amber)">${fmt(saldoDevedor)}</strong></div>
              ${proxima ? `<div class="produto-meta" style="margin-left:0;margin-top:4px">Próxima parcela: <strong style="color:var(--text)">${fmt(proxima.valor)}</strong> em ${new Date(proxima.dataVencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</div>` : `<div class="produto-meta" style="margin-left:0;margin-top:4px;color:var(--teal)">✅ Quitado</div>`}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

// ---- Cartões de crédito ----
function renderCartoes(c) {
  const hoje = todayStr();
  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Cartões de Crédito</div><div class="section-subtitle">Faturas e limite disponível</div></div>
      <button class="icon-btn-ghost" id="toggleCartaoForm">＋ Novo cartão</button>
    </div>

    ${state.showCartaoForm ? `
      <div class="form-card">
        <input type="text" id="cartNome" placeholder="Nome do cartão (ex: Nubank Empresarial)" />
        <input type="text" id="cartLimite" placeholder="Limite (R$)" inputmode="decimal" />
        <div class="form-row">
          <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Dia de fechamento</div><input type="text" id="cartFechamento" placeholder="ex: 20" inputmode="numeric" /></div>
          <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Dia de vencimento</div><input type="text" id="cartVencimento" placeholder="ex: 27" inputmode="numeric" /></div>
        </div>
        <button class="confirm-btn" id="salvarCartao">Adicionar</button>
      </div>
    ` : ''}

    ${state.cartoesCredito.length === 0 ? `<div class="empty-state">Nenhum cartão cadastrado.</div>` : `
      <div class="produto-list">
        ${state.cartoesCredito.map((cart) => {
          if (state.editingCartaoId === cart.id) {
            return `
              <div class="form-card">
                <input type="text" id="editCartNome-${cart.id}" placeholder="Nome" value="${esc(cart.nome)}" />
                <input type="text" id="editCartLimite-${cart.id}" placeholder="Limite" value="${cart.limite.toFixed(2).replace('.', ',')}" />
                <div class="form-row">
                  <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Fechamento</div><input type="text" id="editCartFechamento-${cart.id}" value="${cart.diaFechamento}" inputmode="numeric" /></div>
                  <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Vencimento</div><input type="text" id="editCartVencimento-${cart.id}" value="${cart.diaVencimento}" inputmode="numeric" /></div>
                </div>
                <label class="checkbox-label"><input type="checkbox" id="editCartAtivo-${cart.id}" ${cart.ativo !== false ? 'checked' : ''} /> Ativo</label>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-cartao="${cart.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-cartao="${cart.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          const txCartao = state.tx.filter((t) => t.cartaoId === cart.id && t.tipo === 'saida');
          const comprometido = txCartao.filter((t) => !t.pago).reduce((a, t) => a + t.valor, 0);
          const disponivel = Math.max(0, cart.limite - comprometido);
          const porFatura = {};
          txCartao.forEach((t) => { porFatura[t.data] = (porFatura[t.data] || 0) + t.valor; });
          const faturasFuturas = Object.entries(porFatura).filter(([data]) => data > hoje).sort((a, b) => a[0].localeCompare(b[0]));
          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(cart.nome)}${cart.ativo === false ? ' (inativo)' : ''}</div>
                  <div class="produto-sku">Fecha dia ${cart.diaFechamento}, vence dia ${cart.diaVencimento}</div>
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-editar-cartao="${cart.id}">✏️</button>
                  <button class="trash-btn" data-remover-cartao="${cart.id}">🗑</button>
                </div>
              </div>
              <div class="produto-meta" style="margin-left:0;margin-top:6px">Limite: <strong style="color:var(--text)">${fmt(cart.limite)}</strong></div>
              <div class="produto-meta" style="margin-left:0;margin-top:4px">Comprometido (faturas em aberto): <strong style="color:var(--amber)">${fmt(comprometido)}</strong></div>
              <div class="produto-meta" style="margin-left:0;margin-top:4px">Disponível: <strong style="color:${disponivel > 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(disponivel)}</strong></div>
              ${faturasFuturas.length > 0 ? `
                <div class="form-hint" style="margin-top:10px;margin-bottom:4px">Próximas faturas</div>
                <div class="prod-breakdown">
                  ${faturasFuturas.map(([data, valor]) => `<div class="prod-breakdown-item"><span>${new Date(data + 'T00:00:00').toLocaleDateString('pt-BR')}</span><span>${fmt(valor)}</span></div>`).join('')}
                </div>
              ` : ''}
              <button class="icon-btn-ghost" style="margin-top:10px" data-toggle-lancamentos-cartao="${cart.id}">${state.showLancamentosCartaoId === cart.id ? '▲ Fechar lançamentos' : `🧾 Ver/editar lançamentos${txCartao.length > 0 ? ` (${txCartao.length})` : ''}`}</button>
              ${state.showLancamentosCartaoId === cart.id ? `
                <div class="tx-list" style="margin-top:8px">
                  ${txCartao.length === 0 ? `<div class="empty-state">Nenhum lançamento nesse cartão ainda.</div>` : [...txCartao].sort((a, b) => b.data.localeCompare(a.data)).map((t) => renderTxRow(t)).join('')}
                </div>
              ` : ''}
              ${state.showCompraCartaoId === cart.id ? `
                <div class="entrada-box">
                  <input type="text" id="compCartDescricao-${cart.id}" placeholder="Descrição (ex: Máquina de costura nova)" />
                  <select id="compCartCategoria-${cart.id}"><option value="">Selecione a categoria</option>${categoriaOptionsHtml()}</select>
                  <div class="form-row">
                    <input type="text" id="compCartValor-${cart.id}" placeholder="Valor total (R$)" inputmode="decimal" />
                    <input type="date" id="compCartData-${cart.id}" value="${hoje}" />
                  </div>
                  <input type="text" id="compCartParcelas-${cart.id}" placeholder="Número de parcelas (1 = à vista)" inputmode="numeric" value="1" />
                  <div class="form-row">
                    <button class="confirm-btn" data-salvar-compra-cartao="${cart.id}">Lançar compra</button>
                    <button class="toggle-btn" data-cancelar-compra-cartao="1">Cancelar</button>
                  </div>
                </div>
              ` : `<button class="entrada-btn" data-abrir-compra-cartao="${cart.id}">＋ Nova compra nesse cartão</button>`}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

// ---- Gate de acesso ----
function renderGate(app) {
  const modoPonto = window.__gateModoPonto;
  app.innerHTML = `
    <div class="gate-wrap">
      <div class="brand-row" style="justify-content:center;margin-bottom:24px">
        <div class="brand-dot"></div><span class="brand-name">ROSA JULIETA</span>
      </div>
      <div class="gate-card">
        ${modoPonto ? `
          <div class="section-title" style="margin-bottom:4px">Bater ponto</div>
          <div class="section-subtitle" style="margin-bottom:16px">Digite seu PIN pessoal</div>
          <input type="password" id="gatePin" inputmode="numeric" placeholder="PIN" />
          <label class="checkbox-label" style="margin-top:6px"><input type="checkbox" id="gateLembrarPin" checked /> Lembrar meu PIN por 15 dias neste aparelho</label>
          <button class="confirm-btn" id="gateEntrarPin" style="margin-top:10px">Entrar</button>
          <div id="gateErroPin" style="color:var(--red);font-size:12px;margin-top:8px;display:none">PIN inválido, tente de novo.</div>
          <button class="sair-link" id="gateVoltarCodigo" style="margin-top:14px">← Voltar pro código de acesso</button>
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:10.5px;color:var(--text-muted);font-family:'IBM Plex Mono',monospace">
            ${(() => {
              const papelLS = localStorage.getItem('rj_papel');
              const expiraLS = localStorage.getItem('rj_ponto_expira_em');
              const papelSess = sessionStorage.getItem('rj_papel_sessao');
              if (papelLS === 'ponto' && expiraLS) {
                const restante = Math.round((Number(expiraLS) - Date.now()) / 86400000);
                return `diag: sessão salva (localStorage), expira em ${restante} dia(s)`;
              }
              if (papelLS === 'ponto') return 'diag: sessão salva (localStorage), sem prazo definido';
              if (papelSess === 'ponto') return 'diag: sessão salva só nesta aba (sessionStorage)';
              return 'diag: nenhuma sessão salva no momento';
            })()}
          </div>
        ` : `
          <div class="section-title" style="margin-bottom:4px">Código de acesso</div>
          <div class="section-subtitle" style="margin-bottom:16px">Digite o código que você recebeu</div>
          <input type="password" id="gateCodigo" placeholder="Código" />
          <button class="confirm-btn" id="gateEntrar" style="margin-top:10px">Entrar</button>
          <div id="gateErro" style="color:var(--red);font-size:12px;margin-top:8px;display:none">Código inválido, tente de novo.</div>
          <button class="sair-link" id="gateIrPonto" style="margin-top:14px">🕐 Sou funcionária, bater ponto</button>
        `}
      </div>
    </div>
  `;
  const tentar = async () => {
    const valor = document.getElementById('gateCodigo').value.trim();
    let papel = null;
    if (valor === CODIGO_DONO) papel = 'dono';
    else if (valor === CODIGO_SUPERVISORA) papel = 'supervisora';
    if (papel) {
      localStorage.setItem('rj_papel', papel);
      state.papel = papel;
      state.loading = true;
      render();
      // só busca o resto dos dados (financeiro, estoque, produção etc.) agora que o
      // código foi confirmado — antes disso nada além das funcionárias é carregado
      await loadData();
      await garantirRecorrentes();
      setupRealtime();
    } else {
      document.getElementById('gateErro').style.display = 'block';
    }
  };
  if (!modoPonto) {
    document.getElementById('gateEntrar').addEventListener('click', tentar);
    document.getElementById('gateCodigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') tentar(); });
    document.getElementById('gateIrPonto').addEventListener('click', () => { window.__gateModoPonto = true; render(); });
  } else {
    const tentarPin = async () => {
      const pin = document.getElementById('gatePin').value.trim();
      const lembrar = document.getElementById('gateLembrarPin').checked;
      const funcionaria = state.funcionarias.find((f) => f.pin === pin && f.ativa !== false);
      if (funcionaria) {
        if (lembrar) {
          const expiraEm = Date.now() + 15 * 24 * 60 * 60 * 1000;
          localStorage.setItem('rj_papel', 'ponto');
          localStorage.setItem('rj_funcionaria_id', funcionaria.id);
          localStorage.setItem('rj_ponto_expira_em', String(expiraEm));
          sessionStorage.removeItem('rj_papel_sessao');
          sessionStorage.removeItem('rj_funcionaria_id_sessao');
        } else {
          sessionStorage.setItem('rj_papel_sessao', 'ponto');
          sessionStorage.setItem('rj_funcionaria_id_sessao', funcionaria.id);
          localStorage.removeItem('rj_papel');
          localStorage.removeItem('rj_funcionaria_id');
          localStorage.removeItem('rj_ponto_expira_em');
        }
        state.papel = 'ponto';
        state.funcionariaLogadaId = funcionaria.id;
        window.__gateModoPonto = false;
        state.loading = true;
        render();
        // agora que o PIN foi validado, busca o resto (pontos batidos, férias etc.)
        await loadData();
        await garantirRecorrentes();
        setupRealtime();
      } else {
        document.getElementById('gateErroPin').style.display = 'block';
      }
    };
    document.getElementById('gateEntrarPin').addEventListener('click', tentarPin);
    document.getElementById('gatePin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tentarPin(); });
    document.getElementById('gateVoltarCodigo').addEventListener('click', () => { window.__gateModoPonto = false; render(); });
  }
}

function render() {
  // indicador pequeno de "sincronizando", num elemento próprio fora do #app — assim não some
  // toda vez que o #app é redesenhado, e não precisa cobrir a tela inteira feito o loading
  // inicial. Sem isso, qualquer ação (bater ponto, lançar produção) processava em silêncio,
  // dando a impressão de estar travado
  let syncEl = document.getElementById('sync-indicator');
  if (!syncEl) {
    syncEl = document.createElement('div');
    syncEl.id = 'sync-indicator';
    syncEl.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(20,20,20,0.92);color:#fff;padding:6px 12px;border-radius:20px;font-size:12px;z-index:99999;display:none;align-items:center;gap:6px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    syncEl.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff2e7e"></span> Salvando...';
    document.body.appendChild(syncEl);
  }
  syncEl.style.display = (state.sincronizando && !state.loading) ? 'flex' : 'none';

  const app = document.getElementById('app');
  if (state.loading) {
    app.innerHTML = `<div class="loading-wrap"><div class="spinner"></div></div>`;
    return;
  }
  if (!state.papel) {
    renderGate(app);
    return;
  }
  if (state.papel === 'ponto') {
    renderModoPonto(app);
    return;
  }
  // supervisora usa a mesma navegação por abas, só que travada em Estoque e Produção —
  // sem acesso a Financeiro, Vendas, RH, DRE, nem ao saldo de caixa da empresa
  if (state.papel === 'supervisora' && state.tab !== 'estoque' && state.tab !== 'producao') {
    state.tab = 'estoque';
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
        <div class="brand-sub"><span class="sync-dot"></span>${state.papel === 'supervisora' ? 'Estoque e Produção' : 'Painel de Gestão'}</div>
      </div>
      ${state.papel === 'supervisora' ? `
        <div class="saldo-box">
          <button class="sair-link" id="sairApp">Trocar código</button>
        </div>
      ` : `
        <div class="saldo-box">
          <div class="saldo-label">Saldo disponível</div>
          <div class="saldo-value" style="color:${positivo ? 'var(--teal)' : 'var(--red)'}">${fmt(c.saldoTotal)}</div>
          <button class="sair-link" id="sairApp">Trocar código</button>
        </div>
      `}
    </div>
    ${state.papel === 'supervisora' ? `
      <div class="tabs-wrap">
        ${tabBtn('estoque', TABS.estoque.label)}
        ${tabBtn('producao', TABS.producao.label)}
      </div>
    ` : renderTabsBar(c)}
    <div class="content" id="tabContent"></div>
  `;

  const contentEl = document.getElementById('tabContent');
  if (state.tab === 'dashboard') contentEl.innerHTML = renderDashboard(c);
  else if (state.tab === 'financeiro') contentEl.innerHTML = renderFinanceiro(c);
  else if (state.tab === 'vendas') contentEl.innerHTML = renderVendas(c);
  else if (state.tab === 'estoque') contentEl.innerHTML = renderEstoque(c);
  else if (state.tab === 'tecido') contentEl.innerHTML = renderMateriais(c);
  else if (state.tab === 'corte') contentEl.innerHTML = renderCorte(c);
  else if (state.tab === 'producao') contentEl.innerHTML = renderProducaoDono(c);
  else if (state.tab === 'ficha') contentEl.innerHTML = renderFichaTecnica(c);
  else if (state.tab === 'rh') contentEl.innerHTML = renderRH(c);
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
  vendas: { label: 'Vendas' },
  estoque: { label: 'Estoque' },
  tecido: { label: 'Materiais' },
  corte: { label: 'Corte' },
  producao: { label: 'Produção' },
  ficha: { label: 'Ficha Técnica' },
  rh: { label: 'RH' },
  dre: { label: 'DRE' },
};
const TAB_ORDER_PADRAO = ['dashboard', 'financeiro', 'vendas', 'estoque', 'tecido', 'corte', 'producao', 'ficha', 'rh', 'dre'];

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
    dashboard: c.produtosStatus.filter((p) => p.status !== 'ok' && p.ativo !== false).length,
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

// linha de um lançamento (com edição inline) — usada na lista geral do Financeiro
// e também na lista de lançamentos de um cartão específico
function renderTxRow(t) {
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
      <div class="tx-date">${t.data}${t.tipo === 'saida' ? (t.pago === false ? ' · pendente' : ' · <span style="color:var(--teal)">pago</span>') : ''}</div>
    </div>
    <div class="tx-valor" style="color:${t.tipo === 'entrada' ? 'var(--teal)' : 'var(--pink)'}">${t.tipo === 'entrada' ? '+' : '-'}${fmt(t.valor)}</div>
    ${!state.selectMode ? `
      ${t.tipo === 'saida' && t.pago === false ? `<button class="trash-btn" style="color:var(--teal)" data-marcar-pago="${t.id}" title="Marcar como pago">✅</button>` : ''}
      <button class="trash-btn" data-edit-tx="${t.id}">✏️</button>
      <button class="trash-btn" data-remove-tx="${t.id}">🗑</button>
    ` : ''}
  </div>
`;
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
        <button class="icon-btn-ghost" id="toggleContasAVencer" style="background:${c.contasVencidasNaoConfirmadas.length > 0 ? 'rgba(255,71,87,0.15)' : 'rgba(255,182,39,0.15)'};border:1.5px solid ${c.contasVencidasNaoConfirmadas.length > 0 ? 'var(--red)' : 'var(--amber)'};color:${c.contasVencidasNaoConfirmadas.length > 0 ? 'var(--red)' : 'var(--amber)'};font-weight:700;padding:10px 16px;font-size:13.5px">${c.contasVencidasNaoConfirmadas.length > 0 ? '🔴' : '⚠️'} Contas a vencer${(c.contasAVencer.length + c.contasVencidasNaoConfirmadas.length) > 0 ? ` (${c.contasAVencer.length + c.contasVencidasNaoConfirmadas.length})` : ''}</button>
        <button class="icon-btn-ghost" id="toggleResumoFinanceiro">📊 Custos</button>
        <button class="icon-btn-ghost" id="toggleEmprestimos">🏦 Empréstimos</button>
        <button class="icon-btn-ghost" id="toggleCartoes">💳 Cartões</button>
        <button class="icon-btn-ghost" id="toggleSelect">${state.selectMode ? '✕ Cancelar' : '☑️ Selecionar'}</button>
        <button class="icon-btn-ghost" id="exportCsv">💾 Exportar</button>
        <button class="icon-btn" id="toggleTxForm">＋ Lançar</button>
      </div>
    </div>

    ${renderSeletorPeriodo('fin')}

    <div class="filtro-tipo-bar">
      <button class="filtro-tipo-btn ${state.filtroTipo === 'todos' ? 'active' : ''}" data-filtro="todos">Tudo</button>
      <button class="filtro-tipo-btn ${state.filtroTipo === 'entrada' ? 'active-teal' : ''}" data-filtro="entrada">Entradas</button>
      <button class="filtro-tipo-btn ${state.filtroTipo === 'saida' ? 'active-pink' : ''}" data-filtro="saida">Saídas</button>
    </div>

    ${state.showTaxasForm ? `
      <div class="form-card">
        <div class="form-hint">Defina a taxa de cada plataforma: % sobre o valor da venda e/ou um valor fixo em R$ por transação. Usadas só como estimativa quando o relatório importado não trouxer o valor real da taxa.</div>
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
            <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Taxa diferente por faixa de valor? (opcional — se preencher qualquer faixa abaixo, ela passa a valer no lugar da taxa única acima. Deixa "Até R$" em branco na última faixa que usar, pra cobrir "esse valor pra cima")</div>
            ${Array.from({ length: 5 }, (_, i) => {
              const faixa = (p.taxaFaixas || [])[i] || {};
              return `
                <div class="form-row" style="margin-top:4px">
                  <input type="text" id="taxaFaixaAte-${p.id}-${i}" placeholder="Até R$ (em branco = sem limite)" value="${faixa.ate != null ? faixa.ate : ''}" style="flex:1.4" />
                  <div class="taxa-input-group" style="flex:1"><input type="text" id="taxaFaixaPct-${p.id}-${i}" value="${faixa.pct || ''}" placeholder="%" /><span>%</span></div>
                  <div class="taxa-input-group" style="flex:1"><span>R$</span><input type="text" id="taxaFaixaFixa-${p.id}-${i}" value="${faixa.fixa || ''}" placeholder="0" /></div>
                </div>
              `;
            }).join('')}
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

    ${state.showContasAVencer ? renderContasAVencer(c) : ''}

    ${state.showEmprestimos ? renderEmprestimos(c) : ''}

    ${state.showCartoes ? renderCartoes(c) : ''}

    ${state.showResumoFinanceiro ? renderResumoFinanceiro(c) : ''}

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
        ${tipo === 'saida' ? `
          <div class="form-hint" style="margin-bottom:2px">Forma de pagamento</div>
          <select id="txCartaoSelect" data-toggle-parcelas-select="txParcelasBox">
            <option value="">Outro (à vista, PIX, boleto...)</option>
            <option value="__parcelado_sem_cartao__">💳 Parcelado sem cartão vinculado (ex: boleto)</option>
            ${state.cartoesCredito.filter((cc) => cc.ativo !== false).map((cc) => `<option value="${cc.id}">${esc(cc.nome)}</option>`).join('')}
          </select>
          <div id="txParcelasBox" style="display:none">
            <div class="form-hint">O valor digitado acima é o TOTAL da compra — o sistema divide pelas parcelas.</div>
            <div class="form-hint" style="margin-bottom:2px">💳 Em quantas vezes? (1 = à vista, sem parcelar)</div>
            <input type="text" id="txNumParcelas" placeholder="Número de parcelas" inputmode="numeric" value="1" />
          </div>
        ` : ''}
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
        ${txFiltrado.map((t) => renderTxRow(t)).join('')}
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
      momento: document.getElementById(`ftInsumoMomento-${produtoId}-${i}`)?.value || 'venda',
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

  const termoBusca = (state.fichaTecnicaBusca || '').trim().toLowerCase();
  let linhasFiltradas = linhas.filter((l) => {
    if (state.fichaTecnicaFiltro === 'com-ficha' && l.itens.length === 0) return false;
    if (state.fichaTecnicaFiltro === 'kits' && l.produto.tipo !== 'kit') return false;
    if (termoBusca && !(l.produto.nome.toLowerCase().includes(termoBusca) || (l.produto.sku && l.produto.sku.toLowerCase().includes(termoBusca)))) return false;
    return true;
  });
  // garante que o item que está sendo editado no momento nunca some da lista por causa do filtro
  if (state.editingFichaTecnicaId && !linhasFiltradas.some((l) => l.produto.id === state.editingFichaTecnicaId)) {
    const emEdicao = linhas.find((l) => l.produto.id === state.editingFichaTecnicaId);
    if (emEdicao) linhasFiltradas = [emEdicao, ...linhasFiltradas];
  }

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Ficha Técnica</div><div class="section-subtitle">Custo completo de cada produto e kit — tecido, corte, mão de obra e insumos</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${renderControleColunas('fichaTecnica')}
        <button class="icon-btn" id="toggleNovoKit">🎁 Criar novo kit</button>
      </div>
    </div>

    <div class="form-row" style="margin-bottom:14px">
      <input type="text" id="fichaTecnicaBusca" placeholder="🔍 Buscar por nome ou SKU..." value="${esc(state.fichaTecnicaBusca || '')}" />
      <select id="fichaTecnicaFiltro">
        <option value="com-ficha" ${state.fichaTecnicaFiltro === 'com-ficha' ? 'selected' : ''}>Só com ficha técnica</option>
        <option value="kits" ${state.fichaTecnicaFiltro === 'kits' ? 'selected' : ''}>Só kits</option>
        <option value="todos" ${state.fichaTecnicaFiltro === 'todos' ? 'selected' : ''}>Todos os produtos</option>
      </select>
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

    ${state.produtos.length === 0 ? `<div class="empty-state">Cadastre produtos no Estoque primeiro.</div>` : linhasFiltradas.length === 0 ? `<div class="empty-state">${termoBusca ? 'Nenhum produto encontrado pra essa busca.' : 'Nada por aqui com esse filtro. Tenta "Todos os produtos".'}</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('fichaTecnica', 260)};gap:10px">
        ${linhasFiltradas.map(({ produto: p, itens, custoBase, custoTotal }) => {
          const editando = state.editingFichaTecnicaId === p.id;

          if (editando) {
            const itensInsumo = itens.filter((i) => i.tipoItem === 'insumo');
            const itensComponente = itens.filter((i) => i.tipoItem === 'produto');
            const numInsumo = window.__ftNumInsumoRows || Math.max(3, itensInsumo.length);
            const numComponente = window.__ftNumComponenteRows || Math.max(2, itensComponente.length);
            const insumoValores = window.__ftInsumoValores || itensInsumo.map((i) => ({ ref: i.insumoId, qtd: String(i.quantidade), momento: i.momento || 'venda' }));
            const componenteValores = window.__ftComponenteValores || itensComponente.map((i) => ({ ref: i.componenteProdutoId, qtd: String(i.quantidade) }));

            return `
              <div class="produto-card" style="grid-column:1 / -1">
                <div class="produto-header">
                  <div><div class="produto-nome">${esc(p.nome)}${p.tipo === 'kit' ? ' 🎁' : ''}</div></div>
                </div>
                <div class="form-hint">🧵 Custo de tecido/corte</div>
                <input type="text" id="ftCusto-${p.id}" placeholder="Custo por unidade" value="${p.custoUnitario.toFixed(2).replace('.', ',')}" />
                <label class="checkbox-label"><input type="checkbox" id="ftCustoEstimado-${p.id}" ${p.custoEstimado ? 'checked' : ''} /> ≈ Esse é um custo estimado (não sei o valor real do tecido/corte ainda)</label>
                <div class="form-hint" style="margin-top:10px">✂️ Mão de obra por peça <span style="color:var(--text-muted);font-size:11px">(mesmo valor usado na aba Produção pra pagar a costureira — mudar aqui atualiza lá também)</span></div>
                <input type="text" id="ftMaoObra-${p.id}" placeholder="Valor de mão de obra por peça" value="${(p.valorMaoObra || 0).toFixed(2).replace('.', ',')}" />
                <div class="form-hint" style="margin-top:12px">Insumos usados (bojo, etiqueta, embalagem...)</div>
                ${Array.from({ length: numInsumo }, (_, i) => {
                  const atual = insumoValores[i] || { ref: '', qtd: '', momento: 'venda' };
                  return `
                  <div class="form-row">
                    <select id="ftInsumo-${p.id}-${i}">
                      <option value="">Selecione o insumo</option>
                      ${state.insumos.map((ins) => `<option value="${ins.id}" ${atual.ref === ins.id ? 'selected' : ''}>${esc(ins.nome)}</option>`).join('')}
                    </select>
                    <input type="text" id="ftInsumoQtd-${p.id}-${i}" placeholder="Quantidade" value="${esc(atual.qtd)}" />
                  </div>
                  <select id="ftInsumoMomento-${p.id}-${i}" style="margin-bottom:10px">
                    <option value="venda" ${(atual.momento || 'venda') === 'venda' ? 'selected' : ''}>Descontar na venda (ex: bojo do kit)</option>
                    <option value="producao" ${atual.momento === 'producao' ? 'selected' : ''}>Descontar na produção (ex: etiqueta, toda peça usa)</option>
                  </select>
                `;
                }).join('')}
                <button class="entrada-btn" type="button" data-mais-insumo-ft="${p.id}">＋ Mais um insumo</button>

                ${p.tipo === 'kit' ? (() => {
                  const kitCompsExistentes = state.kitComponentes.filter((k) => k.produtoKitId === p.id);
                  // se ainda não tem composição com cor salva, usa a ficha técnica antiga (sem cor)
                  // como ponto de partida, só pra não perder o que já tava preenchido
                  const baseParaPreencher = kitCompsExistentes.length > 0
                    ? kitCompsExistentes.map((k) => ({ produtoId: k.componenteProdutoId, varianteId: k.componenteVarianteId, quantidade: k.quantidade }))
                    : itensComponente.map((i) => ({ produtoId: i.componenteProdutoId, varianteId: null, quantidade: i.quantidade }));
                  return `
                    <div class="form-hint" style="margin-top:12px">🎁 Peças que compõem esse kit — escolhe a cor de cada uma (ex: 1 Preto + 1 Branco). Isso é o que desconta o estoque de verdade quando o kit vende, e também entra no custo.</div>
                    ${Array.from({ length: 4 }, (_, i) => {
                      const atual = baseParaPreencher[i];
                      const valorAtual = atual ? `${atual.produtoId}|${atual.varianteId || ''}` : '';
                      return `
                        <div class="form-row" style="margin-top:4px">
                          <select id="ftKitComp-${p.id}-${i}">
                            <option value="">Componente (opcional)</option>
                            ${state.produtos.filter((prod) => prod.id !== p.id && prod.tipo !== 'kit').map((prod) => {
                              const vsComp = variantesDoProduto(prod.id);
                              if (vsComp.length > 0) {
                                return vsComp.map((vc) => `<option value="${prod.id}|${vc.id}" ${valorAtual === `${prod.id}|${vc.id}` ? 'selected' : ''}>${esc(prod.nome)} — ${esc(vc.nome)}</option>`).join('');
                              }
                              return `<option value="${prod.id}|" ${valorAtual === `${prod.id}|` ? 'selected' : ''}>${esc(prod.nome)}</option>`;
                            }).join('')}
                          </select>
                          <input type="text" id="ftKitCompQtd-${p.id}-${i}" placeholder="Qtd" value="${atual ? atual.quantidade : '1'}" style="max-width:70px" inputmode="numeric" />
                        </div>
                      `;
                    }).join('')}
                  `;
                })() : `
                <div class="form-hint" style="margin-top:12px">Produtos componentes (custo desse produto incluir o custo de outro produto)</div>
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
                `}

                <div class="form-row" style="margin-top:12px">
                  <button class="confirm-btn" data-salvar-ficha="${p.id}" data-num-insumo="${numInsumo}" data-num-componente="${numComponente}" data-eh-kit="${p.tipo === 'kit' ? '1' : '0'}">Salvar ficha técnica</button>
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
                  ${p.sku ? `<div class="produto-sku">${esc(fmtSkuExibicao(p.sku))}</div>` : ''}
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-editar-ficha="${p.id}">✏️</button>
                  ${itens.length > 0 || state.kitComponentes.some((k) => k.produtoKitId === p.id) ? `<button class="trash-btn" data-excluir-ficha="${p.id}">🗑️</button>` : ''}
                </div>
              </div>
              <div class="produto-meta">Custo base (tecido/corte + mão de obra): <strong style="color:var(--text)">${fmt(custoBase)}</strong></div>
              <div class="produto-meta" style="margin-top:4px">Custo total (com insumos): <strong style="color:var(--teal)">${fmt(custoTotal)}</strong></div>
              ${(() => {
                const detalheProduto = state.vendasDetalhe.filter((v) => v.produtoId === p.id);
                const detalheMkt = detalheProduto.filter((v) => v.plataformaId);
                const detalheManual = detalheProduto.filter((v) => !v.plataformaId);
                const qtdMkt = detalheMkt.reduce((a, v) => a + v.quantidade, 0);
                const precoMkt = qtdMkt > 0 ? detalheMkt.reduce((a, v) => a + v.valor, 0) / qtdMkt : 0;
                const qtdManual = detalheManual.reduce((a, v) => a + v.quantidade, 0);
                const precoManual = qtdManual > 0 ? detalheManual.reduce((a, v) => a + v.valor, 0) / qtdManual : 0;
                if (qtdMkt === 0 && qtdManual === 0) {
                  return p.precoVendaMedio > 0 ? `
                    <div class="produto-meta" style="margin-top:4px">Preço médio de venda: <strong style="color:var(--text)">${fmt(p.precoVendaMedio)}</strong> <span style="color:var(--text-muted);font-size:10px">(histórico antigo, antes da separação por canal)</span></div>
                    <div class="produto-meta" style="margin-top:4px">Lucro estimado por peça: <strong style="color:${(p.precoVendaMedio - custoTotal) >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(p.precoVendaMedio - custoTotal)}</strong> <span style="color:var(--text-muted);font-size:10px">(${(((p.precoVendaMedio - custoTotal) / p.precoVendaMedio) * 100).toFixed(1)}% de margem)</span></div>
                  ` : `<div class="form-hint" style="margin-top:6px">Preço de venda ainda não disponível — aparece sozinho depois da primeira venda com esse SKU vinculado.</div>`;
                }
                return `
                  <div class="form-hint" style="margin-top:6px;margin-bottom:2px">Preço e margem, separados por canal (marketplace tem taxa e frete embutidos no preço, atacado geralmente não):</div>
                  ${qtdMkt > 0 ? `<div class="produto-meta">🛒 Marketplace: <strong style="color:var(--text)">${fmt(precoMkt)}</strong>/un (${qtdMkt} peças) · lucro <strong style="color:${(precoMkt - custoTotal) >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(precoMkt - custoTotal)}</strong> (${(((precoMkt - custoTotal) / precoMkt) * 100).toFixed(0)}%)</div>` : ''}
                  ${qtdManual > 0 ? `<div class="produto-meta" style="margin-top:2px">🧾 Atacado/manual: <strong style="color:var(--text)">${fmt(precoManual)}</strong>/un (${qtdManual} peças) · lucro <strong style="color:${(precoManual - custoTotal) >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(precoManual - custoTotal)}</strong> (${(((precoManual - custoTotal) / precoManual) * 100).toFixed(0)}%)</div>` : ''}
                `;
              })()}
              ${(() => {
                const itensParaMostrar = p.tipo === 'kit'
                  ? state.kitComponentes.filter((k) => k.produtoKitId === p.id).map((k) => ({ tipoItem: 'produto', componenteProdutoId: k.componenteProdutoId, componenteVarianteId: k.componenteVarianteId, quantidade: k.quantidade }))
                  : itens;
                const insumosParaMostrar = itens.filter((i) => i.tipoItem === 'insumo');
                const listaFinal = p.tipo === 'kit' ? [...itensParaMostrar, ...insumosParaMostrar] : itensParaMostrar;
                return listaFinal.length > 0 ? `
                <div class="prod-breakdown" style="margin-top:8px">
                  ${listaFinal.map((item) => {
                    if (item.tipoItem === 'insumo') {
                      const insumo = state.insumos.find((i) => i.id === item.insumoId);
                      return `<div class="prod-breakdown-item"><span>🧷 ${esc(insumo?.nome || 'Insumo removido')} <span style="color:var(--text-muted);font-size:11px">(${item.momento === 'producao' ? 'na produção' : 'na venda'})</span></span><span>${item.quantidade}×</span></div>`;
                    }
                    const componente = state.produtos.find((prod) => prod.id === item.componenteProdutoId);
                    const variante = item.componenteVarianteId ? state.variantes.find((v) => v.id === item.componenteVarianteId) : null;
                    return `<div class="prod-breakdown-item"><span>📦 ${esc(componente?.nome || 'Produto removido')}${variante ? ' — ' + esc(variante.nome) : ''}</span><span>${item.quantidade}×</span></div>`;
                  }).join('')}
                </div>
              ` : `<div class="form-hint" style="margin-top:6px">Sem ficha técnica cadastrada ainda.</div>`;
              })()}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

function attachFichaTecnicaHandlers(c) {
  const fichaTecnicaBuscaInput = document.getElementById('fichaTecnicaBusca');
  if (fichaTecnicaBuscaInput) fichaTecnicaBuscaInput.addEventListener('input', (e) => { state.fichaTecnicaBusca = e.target.value; render(); });

  const fichaTecnicaFiltroSelect = document.getElementById('fichaTecnicaFiltro');
  if (fichaTecnicaFiltroSelect) fichaTecnicaFiltroSelect.addEventListener('change', (e) => { state.fichaTecnicaFiltro = e.target.value; render(); });

  document.querySelectorAll('[data-excluir-ficha]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover a ficha técnica desse produto? O produto continua no Estoque normalmente, só a receita de insumos/componentes é apagada.')) {
        await excluirFichaTecnica(btn.dataset.excluirFicha);
        await loadData();
      }
    });
  });

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
      const ehKitForm = btn.dataset.ehKit === '1';
      const produtoOriginal = state.produtos.find((p) => p.id === produtoId);
      const custoEl = document.getElementById(`ftCusto-${produtoId}`);
      const maoObraEl = document.getElementById(`ftMaoObra-${produtoId}`);
      if (custoEl && maoObraEl && produtoOriginal) {
        const custoUnitario = parseBRNumber(custoEl.value);
        const custoEstimado = document.getElementById(`ftCustoEstimado-${produtoId}`)?.checked || false;
        const valorMaoObra = parseBRNumber(maoObraEl.value);
        await updateProduto(produtoId, { nome: produtoOriginal.nome, sku: produtoOriginal.sku, estoqueAtual: produtoOriginal.estoqueAtual, estoqueMinimo: produtoOriginal.estoqueMinimo, custoUnitario, custoEstimado, valorMaoObra, tipo: produtoOriginal.tipo });
      }
      const itens = [];
      for (let i = 0; i < numInsumo; i++) {
        const insumoId = document.getElementById(`ftInsumo-${produtoId}-${i}`)?.value;
        const qtd = parseBRNumber(document.getElementById(`ftInsumoQtd-${produtoId}-${i}`)?.value || '0');
        const momento = document.getElementById(`ftInsumoMomento-${produtoId}-${i}`)?.value || 'venda';
        if (insumoId && qtd > 0) itens.push({ tipoItem: 'insumo', refId: insumoId, quantidade: qtd, momento });
      }
      if (ehKitForm) {
        // kit: a composição (com cor) vem dos campos ftKitComp — grava em kit_componentes,
        // que é o que desconta o estoque de verdade quando o kit vende
        const componentesKit = [];
        for (let i = 0; i < 4; i++) {
          const sel = document.getElementById(`ftKitComp-${produtoId}-${i}`);
          const qtdInput = document.getElementById(`ftKitCompQtd-${produtoId}-${i}`);
          if (!sel || !sel.value) continue;
          const [compProdutoId, compVarianteId] = sel.value.split('|');
          const qtd = Number(qtdInput?.value) || 1;
          if (compProdutoId && qtd > 0) componentesKit.push({ produtoId: compProdutoId, varianteId: compVarianteId || null, quantidade: qtd });
        }
        await salvarComponentesKit(produtoId, componentesKit);
      } else {
        for (let i = 0; i < numComponente; i++) {
          const componenteId = document.getElementById(`ftComponente-${produtoId}-${i}`)?.value;
          const qtd = parseBRNumber(document.getElementById(`ftComponenteQtd-${produtoId}-${i}`)?.value || '0');
          if (componenteId && qtd > 0) itens.push({ tipoItem: 'produto', refId: componenteId, quantidade: qtd });
        }
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

// ---- RH: funcionárias e ponto eletrônico ----
// painel de fechar o holerite de todas as funcionárias ativas de uma vez, com revisão
// antes de confirmar — mostra o resumo calculado de cada uma, lado a lado
function renderHoleritesLote() {
  const mesKey = state.holeriteMes || todayStr().slice(0, 7);
  const mesLabelTexto = new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const ativas = state.funcionarias.filter((f) => f.ativa !== false);
  const linhas = ativas.map((f) => {
    const jaFechado = state.holerites.find((h) => h.funcionariaId === f.id && h.mes === mesKey);
    const resumo = jaFechado ? null : calcularResumoHolerite(f, mesKey);
    return { f, jaFechado, resumo };
  });
  const pendentes = linhas.filter((l) => !l.jaFechado);
  const totalGeral = linhas.reduce((a, l) => a + (l.jaFechado ? l.jaFechado.totalPagar : (l.resumo.salarioBase + l.resumo.valorHorasExtras + l.resumo.valorHorasExtras100 + l.resumo.valorVt + l.resumo.valorVr)), 0);

  return `
    <div class="form-card">
      <div class="section-title" style="margin-bottom:2px">Fechar holerites — ${mesLabelTexto}</div>
      <div class="section-subtitle" style="margin-bottom:10px">Revise cada uma antes de confirmar. As horas extras usam o modo padrão configurado no cadastro dela (dá pra mudar individualmente no perfil, se precisar).</div>
      <input type="month" id="holeriteLoteMesSelect" value="${mesKey}" style="margin-bottom:12px" />

      ${linhas.length === 0 ? `<div class="empty-state">Nenhuma funcionária ativa cadastrada.</div>` : `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${linhas.map(({ f, jaFechado, resumo }) => `
            <div class="alert-card" style="border-color:${jaFechado ? 'var(--teal)55' : 'var(--border)'}">
              <div class="alert-card-row">
                <div style="flex:1">
                  <div class="alert-name">${esc(f.nome)}</div>
                  ${jaFechado ? `
                    <div class="alert-meta" style="color:var(--teal)">✅ Já fechado — ${fmt(jaFechado.totalPagar)} · ${jaFechado.assinadoEm ? '✍️ assinado' : '⏳ aguardando assinatura'}</div>
                  ` : `
                    <div class="alert-meta">${resumo.diasTrabalhados} dias · base ${fmt(resumo.salarioBase)} · extras ${formatarHorasMin(resumo.horasExtras)} (${f.modoCompensacaoPadrao === 'banco' ? '🏦 banco' : fmt(resumo.valorHorasExtras)})${resumo.horasExtras100 > 0 ? ` · 🗓️ ${formatarHorasMin(resumo.horasExtras100)} 100%` : ''} · faltas ${formatarHorasMin(resumo.horasFaltantes)}${resumo.valorVt > 0 ? ` · Aux. Transporte ${fmt(resumo.valorVt)}` : ''}${resumo.valorVr > 0 ? ` · Aux. Alimentação ${fmt(resumo.valorVr)}` : ''}</div>
                  `}
                </div>
                ${!jaFechado ? `<button class="confirm-btn" style="width:auto;padding:8px 14px" data-fechar-holerite-lote="${f.id}" data-mes="${mesKey}">Fechar</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="produto-vendido" style="margin-top:10px">💰 Total do mês (fechados + pendentes): ${fmt(totalGeral)}</div>
        ${pendentes.length > 0 ? `<button class="confirm-btn" style="margin-top:10px" data-fechar-todos-holerites="${mesKey}">Fechar os ${pendentes.length} pendente(s)</button>` : `<div class="form-hint" style="margin-top:10px">Todo mundo já está fechado esse mês 🎉</div>`}
      `}
    </div>
  `;
}
function renderRH(c) {
  if (state.rhFuncionariaDetalheId) return renderFuncionariaDetalhe(state.rhFuncionariaDetalheId);

  const hoje = todayStr();
  const pendentesPorFuncionaria = {};
  let totalProblemas = 0;
  state.funcionarias.filter((f) => f.ativa !== false).forEach((f) => {
    const dias = verificarPontosEsquecidos(f);
    const semSolicitacao = dias.reduce((a, d) => a + d.tiposSemSolicitacao.length, 0);
    const aguardando = dias.reduce((a, d) => a + d.tiposPendentesAprovacao.length, 0);
    pendentesPorFuncionaria[f.id] = { dias, semSolicitacao, aguardando };
    totalProblemas += semSolicitacao + aguardando;
  });
  const solicitacoesPendentes = state.solicitacoesPonto.filter((s) => s.status === 'pendente').sort((a, b) => a.data.localeCompare(b.data));
  const mesAtualKeyRH = todayStr().slice(0, 7);
  const lembreteHoleriteRH = state.funcionarias.some((f) => f.ativa !== false && !state.holerites.some((h) => h.funcionariaId === f.id && h.mes === mesAtualKeyRH));

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">RH</div><div class="section-subtitle">Funcionárias e ponto eletrônico</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="icon-btn-ghost" id="copiarLinkPonto">🔗 Link de ponto</button>
        <button class="icon-btn-ghost" id="toggleEmpresaConfigForm">🏢 Dados da empresa</button>
        <button class="icon-btn-ghost" id="toggleEmailConfigForm">✉️ Configurar e-mail</button>
        <button class="icon-btn-ghost" id="toggleFeriadosForm">🗓️ Feriados</button>
        <button class="icon-btn-ghost" id="toggleHoleritesLote" style="${lembreteHoleriteRH ? 'background:rgba(255,182,39,0.15);border:1.5px solid var(--amber);color:var(--amber);font-weight:700' : ''}">📋 Fechar holerites do mês</button>
        <button class="icon-btn" id="toggleFuncionariaForm">＋ Funcionária</button>
      </div>
    </div>

    ${state.showEmpresaConfigForm ? `
      <div class="form-card">
        <div class="section-title" style="margin-bottom:2px">Dados da empresa</div>
        <div class="section-subtitle" style="margin-bottom:10px">Usados no cabeçalho dos holerites e recibos em PDF.</div>
        <input type="text" id="empresaRazaoSocial" placeholder="Razão social (ex: Rosa Julieta Confecções LTDA)" value="${esc(state.empresaConfig.razaoSocial)}" />
        <input type="text" id="empresaNomeFantasia" placeholder="Nome fantasia (ex: Rosa Julieta) — opcional" value="${esc(state.empresaConfig.nomeFantasia)}" style="margin-top:8px" />
        <input type="text" id="empresaCnpj" placeholder="CNPJ (ex: 00.000.000/0001-00)" value="${esc(state.empresaConfig.cnpj)}" style="margin-top:8px" />
        <input type="text" id="empresaEndereco" placeholder="Endereço (opcional)" value="${esc(state.empresaConfig.endereco)}" style="margin-top:8px" />
        <input type="text" id="empresaTelefone" placeholder="Telefone (opcional)" value="${esc(state.empresaConfig.telefone)}" style="margin-top:8px" />
        <button class="confirm-btn" style="margin-top:8px" id="salvarEmpresaConfig">Salvar</button>
      </div>
    ` : ''}

    ${state.showEmailConfigForm ? `
      <div class="form-card">
        <div class="section-title" style="margin-bottom:2px">Configurar envio de e-mail</div>
        <div class="section-subtitle" style="margin-bottom:10px">Cole aqui as 3 credenciais da sua conta do EmailJS (emailjs.com) — é só uma vez. Isso é o que permite mandar o holerite direto pro e-mail da funcionária.</div>
        <input type="text" id="empresaEmailjsServiceId" placeholder="Service ID (ex: service_xxxxxxx)" value="${esc(state.empresaConfig.emailjsServiceId)}" />
        <input type="text" id="empresaEmailjsTemplateId" placeholder="Template ID (ex: template_xxxxxxx)" value="${esc(state.empresaConfig.emailjsTemplateId)}" style="margin-top:8px" />
        <input type="text" id="empresaEmailjsPublicKey" placeholder="Public Key" value="${esc(state.empresaConfig.emailjsPublicKey)}" style="margin-top:8px" />
        <button class="confirm-btn" style="margin-top:8px" id="salvarEmailConfig">Salvar</button>
      </div>
    ` : ''}

    ${state.showFeriadosForm ? `
      <div class="form-card">
        <div class="section-title" style="margin-bottom:2px">Feriados</div>
        <div class="section-subtitle" style="margin-bottom:10px">Cadastre os feriados (nacionais, estaduais ou municipais) — quando alguém trabalhar num desses dias (ou num domingo), o sistema paga 100% automático no holerite.</div>
        <div class="form-row">
          <input type="date" id="novoFeriadoData" />
          <input type="text" id="novoFeriadoNome" placeholder="Nome (opcional, ex: Aniversário da cidade)" />
        </div>
        <button class="confirm-btn" style="margin-top:8px" id="salvarFeriado">Adicionar feriado</button>
        ${state.feriados.length > 0 ? `
          <div class="tx-list" style="margin-top:12px">
            ${state.feriados.map((fr) => `
              <div class="tx-row">
                <div class="tx-dot" style="background:var(--pink)"></div>
                <div style="flex:1"><div class="tx-categoria">${new Date(fr.data + 'T00:00:00').toLocaleDateString('pt-BR')}${fr.nome ? ` — ${esc(fr.nome)}` : ''}</div></div>
                <button class="trash-btn" data-remover-feriado="${fr.id}">🗑</button>
              </div>
            `).join('')}
          </div>
        ` : `<div class="form-hint" style="margin-top:10px">Domingos já contam 100% automaticamente, mesmo sem estar aqui — essa lista é só pros feriados.</div>`}
      </div>
    ` : ''}

    ${state.showHoleritesLote ? renderHoleritesLote() : ''}

    ${totalProblemas > 0 ? `
      <div class="alerta-vencimento">
        <span>⚠️ ${totalProblemas} batida(s) pendente(s) ou incompleta(s), ao todo${solicitacoesPendentes.length > 0 ? ` — ${solicitacoesPendentes.length} aguardando sua aprovação` : ''}</span>
      </div>
    ` : ''}

    ${solicitacoesPendentes.length > 0 ? `
      <div class="section-title-wrap"><div><div class="section-title">Solicitações de ajuste</div><div class="section-subtitle">Enviadas pelas funcionárias, aguardando sua decisão</div></div></div>
      <div class="tx-list" style="margin-bottom:28px">
        ${solicitacoesPendentes.map((s) => {
          const func = state.funcionarias.find((f) => f.id === s.funcionariaId);
          return `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(func?.nome || 'Funcionária removida')} — ${LABEL_PONTO[s.tipo]}</div>
                  <div class="produto-sku">${new Date(s.data + 'T00:00:00').toLocaleDateString('pt-BR')} às ${new Date(s.horarioSolicitado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
              ${s.motivo ? `<div class="form-hint" style="margin-top:6px">Motivo: ${esc(s.motivo)}</div>` : `<div class="form-hint" style="margin-top:6px">Sem motivo informado.</div>`}
              <div class="form-row" style="margin-top:10px">
                <button class="confirm-btn" style="background:var(--teal)" data-aprovar-solicitacao="${s.id}">✅ Aceitar</button>
                <button class="toggle-btn" data-recusar-solicitacao="${s.id}">✕ Recusar</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}

    ${state.showFuncionariaForm ? `
      <div class="form-card">
        <input type="text" id="funcNome" placeholder="Nome da funcionária" />
        <input type="text" id="funcPin" placeholder="PIN pessoal (ex: 4 dígitos)" inputmode="numeric" />
        <div class="form-hint" style="margin-bottom:2px">Data de admissão (usada pra calcular o recesso)</div>
        <input type="date" id="funcAdmissao" />
        <div class="form-hint">Jornada de trabalho — marque os dias que ela trabalha e o horário de cada um (dá pra deixar diferente por dia, ex: compensar sábado)</div>
        ${renderEditorJornadaSemanal('func', {}, { entrada: '08:00', saidaAlmoco: '12:00', voltaAlmoco: '13:00', saida: '17:00' })}
        <button class="confirm-btn" id="salvarFuncionaria" style="margin-top:12px">Adicionar</button>
      </div>
    ` : ''}

    ${state.funcionarias.length === 0 ? `<div class="empty-state">Nenhuma funcionária cadastrada ainda.</div>` : `
      <div class="produto-list">
        ${state.funcionarias.map((f) => {
          if (state.editingFuncionariaId === f.id) {
            return `
              <div class="form-card">
                <input type="text" id="editFuncNome-${f.id}" placeholder="Nome" value="${esc(f.nome)}" />
                <input type="text" id="editFuncPin-${f.id}" placeholder="PIN pessoal" value="${esc(f.pin)}" inputmode="numeric" />
                <div class="form-hint" style="margin-bottom:2px">Data de admissão</div>
                <input type="date" id="editFuncAdmissao-${f.id}" value="${f.dataAdmissao || ''}" />
                <div class="form-row" style="margin-top:8px">
                  <input type="text" id="editFuncCargo-${f.id}" placeholder="Cargo/função (ex: Costureira)" value="${esc(f.cargo || '')}" />
                  <input type="text" id="editFuncMatricula-${f.id}" placeholder="Matrícula (ex: 001)" value="${esc(f.matricula || '')}" />
                </div>
                <input type="text" id="editFuncCpf-${f.id}" placeholder="CNPJ (ex: 00.000.000/0001-00)" value="${esc(f.cpf || '')}" style="margin-top:8px" />
                <input type="email" id="editFuncEmail-${f.id}" placeholder="E-mail dela (pra receber o holerite)" value="${esc(f.email || '')}" style="margin-top:8px" />
                <div class="form-hint" style="margin-top:10px">Pagamento — usado pro holerite</div>
                <div class="form-row">
                  <button class="toggle-btn ${(window.__editFuncTipoPag?.[f.id] || f.tipoPagamento) === 'hora' ? 'active-teal' : ''}" data-edit-func-tipo-pag="${f.id}" data-valor="hora">Por hora</button>
                  <button class="toggle-btn ${(window.__editFuncTipoPag?.[f.id] || f.tipoPagamento) === 'mensal' ? 'active-pink' : ''}" data-edit-func-tipo-pag="${f.id}" data-valor="mensal">Salário fixo mensal</button>
                </div>
                ${(window.__editFuncTipoPag?.[f.id] || f.tipoPagamento) === 'mensal' ? `
                  <input type="text" id="editFuncSalarioMensal-${f.id}" placeholder="Salário mensal (ex: 1500,00)" value="${f.salarioMensal ? f.salarioMensal.toFixed(2).replace('.', ',') : ''}" />
                  <button class="icon-btn-ghost" type="button" style="margin-top:6px" data-calcular-valor-hora="${f.id}">🧮 Calcular valor da hora automático (salário ÷ jornada)</button>
                ` : ''}
                <div class="form-row">
                  <input type="text" id="editFuncValorHora-${f.id}" placeholder="Valor da hora (usado pra calcular hora extra)" value="${f.valorHora ? f.valorHora.toFixed(2).replace('.', ',') : ''}" />
                  <input type="text" id="editFuncPercentualExtra-${f.id}" placeholder="% adicional hora extra" value="${f.percentualHoraExtra}" />
                </div>
                <div class="form-hint" style="margin-bottom:2px">Como pagar hora extra por padrão (dá pra escolher de novo na hora de fechar o holerite)</div>
                <div class="form-row">
                  <button class="toggle-btn ${(window.__editFuncModoComp?.[f.id] || f.modoCompensacaoPadrao) === 'dinheiro' ? 'active-teal' : ''}" data-edit-func-modo-comp="${f.id}" data-valor="dinheiro">💰 Dinheiro</button>
                  <button class="toggle-btn ${(window.__editFuncModoComp?.[f.id] || f.modoCompensacaoPadrao) === 'banco' ? 'active-pink' : ''}" data-edit-func-modo-comp="${f.id}" data-valor="banco">🏦 Banco de horas</button>
                </div>
                <div class="form-row">
                  <input type="text" id="editFuncVtDia-${f.id}" placeholder="Auxílio Transporte mensal (valor fixo)" value="${f.valorVtDia ? f.valorVtDia.toFixed(2).replace('.', ',') : ''}" />
                  <input type="text" id="editFuncVrDia-${f.id}" placeholder="Auxílio Alimentação mensal (valor fixo)" value="${f.valorVrDia ? f.valorVrDia.toFixed(2).replace('.', ',') : ''}" />
                </div>
                <div class="form-hint" style="margin-bottom:2px">Horas por semana que ela não trabalha e devem ser compensadas no fim do mês, descontando do saldo de horas extras (ex: sábado não trabalhado = 4h). Deixa em 0 se a jornada semanal abaixo já embutir isso nos horários de cada dia.</div>
                <input type="text" id="editFuncCompSabado-${f.id}" placeholder="Horas de compensação por semana (ex: 4)" value="${f.horasCompensacaoSemanal || ''}" inputmode="decimal" />
                <div class="form-hint" style="margin-top:10px">Jornada de trabalho — marque os dias que ela trabalha e o horário de cada um</div>
                ${renderEditorJornadaSemanal(`editFunc${f.id}`, f.jornadaSemanal, { entrada: f.jornadaEntrada, saidaAlmoco: f.jornadaSaidaAlmoco, voltaAlmoco: f.jornadaVoltaAlmoco, saida: f.jornadaSaida })}
                <label class="checkbox-label" style="margin-top:10px"><input type="checkbox" id="editFuncAtiva-${f.id}" ${f.ativa !== false ? 'checked' : ''} /> Ativa</label>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-edit-func="${f.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-func="${f.id}">Cancelar</button>
                </div>
              </div>
            `;
          }
          const pontosHoje = state.pontos.filter((p) => p.funcionariaId === f.id && p.data === hoje).sort((a, b) => new Date(a.horario) - new Date(b.horario));
          const ultimaBatida = pontosHoje[pontosHoje.length - 1];
          const statusFerias = calcularStatusFerias(f);
          const pendentes = pendentesPorFuncionaria[f.id] || { semSolicitacao: 0, aguardando: 0 };
          return `
            <div class="tx-row" style="cursor:pointer${f.ativa === false ? ';opacity:0.6' : ''}" data-abrir-funcionaria="${f.id}">
              <div class="tx-dot" style="background:${pendentes.semSolicitacao > 0 ? 'var(--red)' : pendentes.aguardando > 0 ? 'var(--amber)' : f.ativa === false ? 'var(--text-muted)' : ultimaBatida ? 'var(--teal)' : 'var(--amber)'}"></div>
              <div style="flex:1">
                <div class="tx-categoria">${esc(f.nome)}${f.ativa === false ? ' (inativa)' : ''}</div>
                <div class="tx-desc">${ultimaBatida ? `Hoje: ${LABEL_PONTO[ultimaBatida.tipo]} às ${new Date(ultimaBatida.horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Nenhuma batida hoje'}</div>
                ${statusFerias ? `<div style="font-size:11px;color:${FERIAS_STATUS_LABEL[statusFerias.status].color};margin-top:2px">${FERIAS_STATUS_LABEL[statusFerias.status].label}</div>` : ''}
                ${pendentes.semSolicitacao > 0 ? `<div style="font-size:11px;color:var(--red);margin-top:2px">🔴 ${pendentes.semSolicitacao} batida(s) sem solicitação</div>` : ''}
                ${pendentes.aguardando > 0 ? `<div style="font-size:11px;color:var(--amber);margin-top:2px">⏳ ${pendentes.aguardando} aguardando sua aprovação</div>` : ''}
              </div>
              <span style="color:var(--text-muted);font-size:16px">›</span>
              <button class="trash-btn" data-editar-func="${f.id}">✏️</button>
              <button class="trash-btn" data-remover-func="${f.id}">🗑</button>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
}

function renderFuncionariaDetalhe(funcionariaId) {
  const f = state.funcionarias.find((x) => x.id === funcionariaId);
  const pontos = state.pontos.filter((p) => p.funcionariaId === funcionariaId).sort((a, b) => new Date(b.horario) - new Date(a.horario));

  const inicio = state.rhFiltroInicio || todayStr().slice(0, 8) + '01';
  const fim = state.rhFiltroFim || todayStr();
  const pontosFiltrados = pontos.filter((p) => p.data >= inicio && p.data <= fim);

  // agrupa por dia
  const porDia = {};
  pontosFiltrados.forEach((p) => {
    if (!porDia[p.data]) porDia[p.data] = [];
    porDia[p.data].push(p);
  });
  const diasOrdenados = Object.keys(porDia).sort((a, b) => b.localeCompare(a));

  let totalExtra = 0;
  let totalFalta = 0;

  const statusFerias = f ? calcularStatusFerias(f) : null;
  const feriasDaFuncionaria = state.feriasTiradas.filter((v) => v.funcionariaId === funcionariaId).sort((a, b) => b.dataFim.localeCompare(a.dataFim));

  const dataFmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
  const diasPendentes = f ? verificarPontosEsquecidos(f).filter((e) => e.tiposSemSolicitacao.length > 0 || e.tiposPendentesAprovacao.length > 0) : [];

  // ---- Holerite ----
  const mesHolerite = state.holeriteMes || todayStr().slice(0, 7);
  const resumoHolerite = f ? calcularResumoHolerite(f, mesHolerite) : null;
  const resumoFerias = f ? calcularValorFerias(f, mesHolerite) : null;
  const totalAdiantamentosDoMesHolerite = f ? state.adiantamentos.filter((a) => a.funcionariaId === funcionariaId && a.data.slice(0, 7) === mesHolerite).reduce((acc, a) => acc + a.valor, 0) : 0;
  const holeriteExistente = state.holerites.find((h) => h.funcionariaId === funcionariaId && h.mes === mesHolerite);
  const horasBancoUsadasFechado = f ? state.abonosPonto.filter((a) => a.funcionariaId === funcionariaId && a.data.slice(0, 7) === mesHolerite && a.horas != null).reduce((acc, a) => acc + a.horas, 0) : 0;
  const horasBancoPagasDinheiroFechado = f ? state.bancoHorasLancamentos.filter((b) => b.funcionariaId === funcionariaId && b.data.slice(0, 7) === mesHolerite && b.descricao && b.descricao.startsWith('Pago em dinheiro')).reduce((acc, b) => acc + Math.abs(b.horas), 0) : 0;
  const valorBancoPagoDinheiroFechado = f ? state.tx.filter((t) => t.tipo === 'saida' && monthKey(t.data) === mesHolerite && t.descricao && t.descricao.startsWith(`Pagamento de banco de horas — ${f.nome}`)).reduce((acc, t) => acc + t.valor, 0) : 0;
  const saldoBancoHoras = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === funcionariaId).reduce((a, b) => a + b.horas, 0);
  const historicoHolerites = state.holerites.filter((h) => h.funcionariaId === funcionariaId).sort((a, b) => b.mes.localeCompare(a.mes));
  const extratoBancoMes = f ? calcularExtratoBancoHoras(funcionariaId, mesHolerite) : null;
  const mesLabelHolerite = (mk) => new Date(mk + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return `
    <button class="icon-btn-ghost" id="voltarFuncionarias" style="margin-bottom:14px">← Voltar</button>

    <div class="section-title-wrap">
      <div><div class="section-title">${esc(f?.nome || 'Funcionária')}</div><div class="section-subtitle">${f ? [1, 2, 3, 4, 5, 6, 0].filter((dia) => (f.jornadaSemanal[dia] ? f.jornadaSemanal[dia].trabalha : (dia >= 1 && dia <= 5))).map((dia) => DIAS_SEMANA[dia].slice(0, 3)).join(', ') : ''}</div></div>
    </div>
    ${f && (f.cargo || f.matricula || f.cpf) ? `
      <div class="form-hint" style="margin-top:-10px;margin-bottom:14px">${[f.cargo, f.matricula ? `Matrícula ${f.matricula}` : '', f.cpf ? `CNPJ ${formatarCnpj(f.cpf)}` : ''].filter(Boolean).join(' · ')}</div>
    ` : ''}

    ${diasPendentes.length > 0 ? `
      <div class="form-card" style="border-color:var(--red)55">
        <div class="section-title" style="margin-bottom:2px;color:var(--red)">⚠️ Ponto pendente</div>
        <div class="section-subtitle" style="margin-bottom:10px">Dias esperados sem batida completa</div>
        ${diasPendentes.map((e) => `
          <div style="border-top:1px solid var(--border);padding-top:6px;margin-top:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div style="font-size:12.5px;font-weight:600">${dataFmt(e.data)}</div>
              <button class="icon-btn-ghost" style="padding:2px 8px;font-size:11px" data-abrir-abonar="${e.data}">📋 Abonar/Atestado</button>
            </div>
            ${e.tiposPendentesAprovacao.map((t) => `<div style="font-size:11.5px;color:var(--amber);padding:2px 0">⏳ ${LABEL_PONTO[t]} — aguardando sua aprovação</div>`).join('')}
            ${e.tiposSemSolicitacao.map((t) => `<div style="font-size:11.5px;color:var(--red);padding:2px 0">🔴 ${LABEL_PONTO[t]} — sem solicitação ainda</div>`).join('')}
            ${state.showAbonarId === e.data ? `
              <div class="entrada-box">
                <select id="abonarTipo-${e.data}">
                  <option value="atestado">🩺 Atestado médico</option>
                  <option value="folga">🏖️ Folga</option>
                  <option value="abono">✅ Abono simples</option>
                </select>
                <input type="text" id="abonarMotivo-${e.data}" placeholder="Motivo/observação (opcional)" />
                <div class="form-hint" style="margin-top:2px;margin-bottom:2px">Só parte do dia? Quanto tempo do saldo ela usou (deixe os dois em branco pra abonar o dia inteiro):</div>
                <div class="form-row">
                  <input type="text" id="abonarHorasH-${e.data}" placeholder="Horas (ex: 1)" inputmode="numeric" />
                  <input type="text" id="abonarHorasM-${e.data}" placeholder="Minutos (ex: 30)" inputmode="numeric" />
                </div>
                <div class="form-hint" style="margin-top:2px">Preenchendo isso, debita automaticamente do banco de horas dela (é o que acontece de verdade quando ela usa o saldo).</div>
                <div class="form-row">
                  <button class="confirm-btn" data-salvar-abono="${funcionariaId}" data-data="${e.data}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-abonar="1">Cancelar</button>
                </div>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${(() => {
      const abonosDela = state.abonosPonto.filter((a) => a.funcionariaId === funcionariaId).sort((a, b) => b.data.localeCompare(a.data));
      if (abonosDela.length === 0) return '';
      const iconeTipo = { atestado: '🩺', folga: '🏖️', abono: '✅' };
      return `
        <div class="section-title-wrap"><div><div class="section-title">Dias abonados</div></div></div>
        <div class="tx-list" style="margin-bottom:24px">
          ${abonosDela.map((a) => `
            <div class="tx-row">
              <div class="tx-dot" style="background:var(--teal)"></div>
              <div style="flex:1">
                <div class="tx-categoria">${iconeTipo[a.tipo] || '✅'} ${dataFmt(a.data)}${a.motivo ? ` — ${esc(a.motivo)}` : ''}</div>
              </div>
              <button class="trash-btn" data-remover-abono="${a.id}">🗑</button>
            </div>
          `).join('')}
        </div>
      `;
    })()}

    ${(() => {
      const solicitacoesDela = state.solicitacoesPonto.filter((s) => s.funcionariaId === funcionariaId && s.status === 'pendente');
      if (solicitacoesDela.length === 0) return '';
      return `
        <div class="section-title-wrap"><div><div class="section-title">Solicitações aguardando decisão</div></div></div>
        <div class="produto-list" style="margin-bottom:24px">
          ${solicitacoesDela.map((s) => `
            <div class="produto-card">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${LABEL_PONTO[s.tipo]}</div>
                  <div class="produto-sku">${dataFmt(s.data)} às ${new Date(s.horarioSolicitado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
              ${s.motivo ? `<div class="form-hint" style="margin-top:6px">Motivo: ${esc(s.motivo)}</div>` : ''}
              <div class="form-row" style="margin-top:10px">
                <button class="confirm-btn" style="background:var(--teal)" data-aprovar-solicitacao="${s.id}">✅ Aceitar</button>
                <button class="toggle-btn" data-recusar-solicitacao="${s.id}">✕ Recusar</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    })()}

    <div class="section-title-wrap">
      <div><div class="section-title">Recesso</div></div>
      <button class="icon-btn-ghost" id="toggleFeriasForm">🏖️ Registrar recesso</button>
    </div>
    ${!f?.dataAdmissao ? `<div class="empty-state">Cadastre a data de admissão dela (✏️ na lista) pra calcular o ciclo de recesso.</div>` : `
      <div class="form-card">
        <div class="produto-meta" style="margin-left:0">Status: <strong style="color:${FERIAS_STATUS_LABEL[statusFerias.status].color}">${FERIAS_STATUS_LABEL[statusFerias.status].label}</strong></div>
        <div class="produto-meta" style="margin-left:0;margin-top:4px">Ciclo atual começou em: <strong style="color:var(--text)">${statusFerias.inicioCiclo.toLocaleDateString('pt-BR')}</strong></div>
        <div class="produto-meta" style="margin-left:0;margin-top:4px">${statusFerias.diasParaAdquirirDireito > 0 ? `Liberado a partir de: <strong style="color:var(--text)">${statusFerias.fimPeriodoAquisitivo.toLocaleDateString('pt-BR')}</strong> (faltam ${statusFerias.diasParaAdquirirDireito} dias)` : `Prazo limite pra usar: <strong style="color:var(--text)">${statusFerias.prazoLimite.toLocaleDateString('pt-BR')}</strong> (${statusFerias.diasParaPrazoLimite >= 0 ? `faltam ${statusFerias.diasParaPrazoLimite} dias` : `venceu há ${Math.abs(statusFerias.diasParaPrazoLimite)} dias`})`}</div>
      </div>
    `}

    ${state.showFeriasForm ? `
      <div class="form-card">
        <div class="form-hint">Registrar um período de recesso já tirado (ou já agendado) — isso reinicia o ciclo automaticamente.</div>
        <div class="form-row">
          <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Início</div><input type="date" id="feriasInicio" /></div>
          <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Fim</div><input type="date" id="feriasFim" /></div>
        </div>
        <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Vendeu dias do recesso? Quantos:</div>
        <input type="text" id="feriasDiasVendidos" placeholder="Dias vendidos (ex: 15) — deixe em branco se não vendeu nada" inputmode="numeric" />
        <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Mês que paga esse recesso/dias vendidos no holerite (padrão: mês em que ele começa):</div>
        <input type="month" id="feriasMesPagamento" />
        <button class="confirm-btn" style="margin-top:8px" data-salvar-ferias="${funcionariaId}">Salvar</button>
      </div>
    ` : ''}

    ${feriasDaFuncionaria.length > 0 ? `
      <div class="tx-list" style="margin-bottom:24px">
        ${feriasDaFuncionaria.map((v) => {
          if (state.editandoFeriasId === v.id) {
            return `
              <div class="form-card">
                <div class="form-row">
                  <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Início</div><input type="date" id="editFeriasInicio-${v.id}" value="${v.dataInicio}" /></div>
                  <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Fim</div><input type="date" id="editFeriasFim-${v.id}" value="${v.dataFim}" /></div>
                </div>
                <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Dias vendidos:</div>
                <input type="text" id="editFeriasDiasVendidos-${v.id}" value="${v.diasVendidos || ''}" placeholder="ex: 15" inputmode="numeric" />
                <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Mês que paga no holerite:</div>
                <input type="month" id="editFeriasMesPagamento-${v.id}" value="${v.mesReferenciaPagamento || v.dataInicio.slice(0, 7)}" />
                <div class="form-row" style="margin-top:8px">
                  <button class="confirm-btn" data-salvar-edit-ferias="${v.id}">Salvar</button>
                  <button class="toggle-btn" data-cancelar-edit-ferias="1">Cancelar</button>
                </div>
              </div>
            `;
          }
          return `
            <div class="tx-row" style="cursor:pointer" data-editar-ferias="${v.id}">
              <div class="tx-dot" style="background:var(--teal)"></div>
              <div style="flex:1">
                <div class="tx-categoria">${dataFmt(v.dataInicio)} → ${dataFmt(v.dataFim)}</div>
                ${v.diasVendidos > 0 ? `<div class="tx-desc">💰 ${v.diasVendidos} dia(s) vendido(s) · paga em ${mesLabelHolerite(v.mesReferenciaPagamento || v.dataInicio.slice(0, 7))}</div>` : ''}
              </div>
              <button class="trash-btn" data-remover-ferias="${v.id}">🗑</button>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}

    <div class="form-row" style="margin-bottom:10px">
      <input type="date" id="rhFiltroInicio" value="${inicio}" />
      <input type="date" id="rhFiltroFim" value="${fim}" />
    </div>
    <div class="form-row" style="margin-bottom:20px">
      <button class="icon-btn-ghost" id="rhEstaSemana" style="flex:1">📅 Esta semana</button>
      <button class="icon-btn-ghost" id="rhEsteMes" style="flex:1">📅 Este mês</button>
    </div>

    <div class="section-title-wrap"><div><div class="section-title">Lançar batida manual</div></div></div>
    <div class="form-card">
      <input type="date" id="ptManualData" value="${todayStr()}" />
      <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Lança só o horário que preencher — os outros campos ficam intocados. Use o botão ✓ ao lado pra lançar só aquele horário isolado, ou preenche vários e usa "Lançar todos preenchidos" no fim.</div>
      ${ORDEM_PONTOS.map((t) => {
        const padrao = f ? { entrada: f.jornadaEntrada, saida_almoco: f.jornadaSaidaAlmoco, volta_almoco: f.jornadaVoltaAlmoco, saida: f.jornadaSaida }[t] : '';
        return `
          <div class="form-row" style="align-items:center;margin-top:6px">
            <div style="flex:1;font-size:13px">${LABEL_PONTO[t]}</div>
            <input type="time" id="ptManual-${t}" value="${padrao || ''}" style="max-width:140px" />
            <button class="confirm-btn" style="width:auto;padding:8px 12px" title="Lançar só ${esc(LABEL_PONTO[t])}" data-lancar-ponto-unico="${t}" data-funcionaria="${funcionariaId}">✓</button>
          </div>
        `;
      }).join('')}
      <button class="icon-btn-ghost" style="margin-top:8px" id="ptManualLimparAlmoco">🕐 Meio período (limpar Saída/Volta Almoço)</button>
      <button class="confirm-btn" style="margin-top:10px" data-lancar-ponto-manual="${funcionariaId}">Lançar todos preenchidos</button>
    </div>

    <div class="section-title-wrap"><div><div class="section-title">Abonar um dia (ou período)</div><div class="section-subtitle">Atestado, folga, ou liberou mais cedo e não quer descontar — qualquer data, inclusive de meses passados</div></div></div>
    <div class="form-card">
      <div class="form-row">
        <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">De</div><input type="date" id="abonarLivreData" value="${todayStr()}" /></div>
        <div style="flex:1"><div class="form-hint" style="margin-bottom:2px">Até (opcional, pra período)</div><input type="date" id="abonarLivreDataFim" /></div>
      </div>
      <select id="abonarLivreTipo" style="margin-top:8px">
        <option value="atestado">🩺 Atestado médico</option>
        <option value="folga">🏖️ Folga</option>
        <option value="abono">✅ Abono simples</option>
      </select>
      <input type="text" id="abonarLivreMotivo" placeholder="Motivo/observação (opcional)" style="margin-top:8px" />
      <div class="form-hint" style="margin-top:8px;margin-bottom:2px">Só parte do dia? Quanto tempo do saldo ela usou (deixe os dois em branco pra abonar o dia inteiro):</div>
      <div class="form-row">
        <input type="text" id="abonarLivreHorasH" placeholder="Horas (ex: 1)" inputmode="numeric" />
        <input type="text" id="abonarLivreHorasM" placeholder="Minutos (ex: 30)" inputmode="numeric" />
      </div>
      <div class="form-hint" style="margin-top:2px">Preenchendo isso, debita automaticamente do banco de horas (usa quando ela cobrir a falta com saldo que já tinha).</div>
      <button class="confirm-btn" style="margin-top:10px" data-salvar-abono-livre="${funcionariaId}">Abonar</button>
    </div>

    <div class="section-title-wrap"><div><div class="section-title">Dias no período</div></div></div>
    ${diasOrdenados.length === 0 ? `<div class="empty-state">Nenhuma batida no período selecionado.</div>` : `
      <div class="tx-list">
        ${diasOrdenados.map((dia) => {
          const pontosDoDia = porDia[dia].sort((a, b) => new Date(a.horario) - new Date(b.horario));
          const calc = f ? calcularHorasDia(pontosDoDia, f, dia) : null;
          const abonoDoDia = state.abonosPonto.find((a) => a.funcionariaId === funcionariaId && a.data === dia);
          const temFalta = !!(calc && calc.diferenca < 0);
          const faltaAbonadaTotal = !!(abonoDoDia && temFalta && abonoDoDia.horas == null);
          const faltaRestanteParcial = (abonoDoDia && temFalta && abonoDoDia.horas != null) ? Math.max(0, Math.abs(calc.diferenca) - abonoDoDia.horas) : null;
          if (calc && !faltaAbonadaTotal) {
            if (calc.diferenca >= 0) totalExtra += calc.diferenca;
            else if (faltaRestanteParcial !== null) totalFalta += faltaRestanteParcial;
            else totalFalta += Math.abs(calc.diferenca);
          }
          return `
            <div class="produto-card">
              <div class="produto-header">
                <div><div class="produto-nome">${dia}</div></div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${!calc || !calc.completo ? `<span style="font-size:11px;color:var(--amber)">⚠️ incompleto</span>` : ''}
                  ${faltaAbonadaTotal ? `
                    <span style="font-size:11px;color:var(--teal)">✅ Abonado (${formatarHorasMin(calc.diferenca)} não descontado)</span>
                  ` : faltaRestanteParcial !== null ? `
                    <span style="font-size:11px;color:${faltaRestanteParcial > 0 ? 'var(--red)' : 'var(--teal)'}">🏦 ${formatarHorasMin(abonoDoDia.horas)} do saldo${faltaRestanteParcial > 0 ? ` · ainda falta ${formatarHorasMin(faltaRestanteParcial)}` : ' · cobriu tudo'}</span>
                  ` : calc ? `
                    <div class="dre-td-num ${calc.diferenca >= 0 ? 'dre-positivo' : 'dre-negativo'}" style="font-size:13px">${calc.diferenca >= 0 ? '+' : '-'}${formatarHorasMin(calc.diferenca)}</div>
                  ` : ''}
                </div>
              </div>
              <div class="prod-breakdown">
                ${pontosDoDia.map((p) => {
                  const origemBadge = {
                    manual: '<span style="color:var(--amber);font-size:10px;font-weight:700;margin-left:6px">🔧 MANUAL</span>',
                    solicitacao: '<span style="color:var(--teal);font-size:10px;font-weight:700;margin-left:6px">📝 SOLICITAÇÃO</span>',
                    propria: '<span style="color:var(--text-muted);font-size:10px;margin-left:6px">📱 ela mesma</span>',
                  }[p.origem || 'propria'];
                  return `
                  <div class="prod-breakdown-item">
                    <span>${LABEL_PONTO[p.tipo] || p.tipo}${origemBadge}</span>
                    <span>
                      ${new Date(p.horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      <button class="trash-btn" style="padding:2px" data-editar-ponto="${p.id}" data-horario="${p.horario}">✏️</button>
                      <button class="trash-btn" style="padding:2px" data-remover-ponto="${p.id}">🗑</button>
                    </span>
                  </div>
                `;
                }).join('')}
              </div>
              ${state.editingPontoId && pontosDoDia.some((p) => p.id === state.editingPontoId) ? `
                <div class="entrada-box">
                  <input type="time" id="editPontoHora-${state.editingPontoId}" value="${new Date(pontosDoDia.find((p) => p.id === state.editingPontoId).horario).toTimeString().slice(0, 5)}" />
                  <div class="form-row">
                    <button class="confirm-btn" data-salvar-edit-ponto="${state.editingPontoId}" data-data="${dia}">Salvar</button>
                    <button class="toggle-btn" data-cancelar-edit-ponto="1">Cancelar</button>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `}

    ${diasOrdenados.length > 0 ? `
      <div class="stats-grid" style="margin-top:20px">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(0,212,160,0.1)">⏱️</div>
          <div class="stat-label">Horas extras no período</div>
          <div class="stat-value" style="color:var(--teal)">+${formatarHorasMin(totalExtra)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(255,71,87,0.1)">⏱️</div>
          <div class="stat-label">Horas faltantes no período</div>
          <div class="stat-value" style="color:var(--red)">-${formatarHorasMin(totalFalta)}</div>
        </div>
        ${extratoBancoMes ? (() => {
          const debitoCompensacaoSabadoPeriodo = f ? calcularDebitoCompensacaoSabado(f, inicio, fim) : 0;
          const saldoTempoReal = extratoBancoMes.saldoAnterior + totalExtra - totalFalta - debitoCompensacaoSabadoPeriodo;
          const periodoBateComMesHolerite = inicio === `${mesHolerite}-01` && monthKey(fim) === mesHolerite;
          return `
            <div class="stat-card">
              <div class="stat-icon" style="background:${saldoTempoReal >= 0 ? 'rgba(0,212,160,0.1)' : 'rgba(255,71,87,0.1)'}">📡</div>
              <div class="stat-label">Saldo total em tempo real</div>
              <div class="stat-value" style="color:${saldoTempoReal >= 0 ? 'var(--teal)' : 'var(--red)'}">${saldoTempoReal >= 0 ? '+' : '-'}${formatarHorasMin(saldoTempoReal)}</div>
              <div class="form-hint" style="margin-top:2px">${extratoBancoMes.saldoAnterior >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoAnterior)} de antes + esse período${debitoCompensacaoSabadoPeriodo > 0 ? ` − ${formatarHorasMin(debitoCompensacaoSabadoPeriodo)} de compensação de sábado` : ''}, sem esperar fechar o holerite${!periodoBateComMesHolerite ? ` ⚠️ o período acima (dias) não é o mês inteiro de ${mesLabelHolerite(mesHolerite)} — ajusta o filtro de data pra esse número ficar preciso` : ''}</div>
            </div>
          `;
        })() : ''}
      </div>
    ` : ''}

    <div class="section-title-wrap" style="margin-top:24px">
      <div><div class="section-title">Holerite</div><div class="section-subtitle">Fecha o pagamento do mês — salário, horas extras, Auxílio Transporte e Alimentação</div></div>
      <button class="icon-btn-ghost" data-baixar-espelho-ponto="${funcionariaId}">🗓️ Espelho de ponto (PDF)</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background:${saldoBancoHoras >= 0 ? 'rgba(0,212,160,0.1)' : 'rgba(255,71,87,0.1)'}">🏦</div>
        <div class="stat-label">Saldo no banco de horas (acumulado desde sempre)</div>
        <div class="stat-value" style="color:${saldoBancoHoras >= 0 ? 'var(--teal)' : 'var(--red)'}">${saldoBancoHoras >= 0 ? '+' : '-'}${formatarHorasMin(saldoBancoHoras)}</div>
      </div>
    </div>
    <div class="form-row" style="margin-bottom:14px">
      <button class="icon-btn-ghost" id="toggleLancamentoBanco">🏦 Lançar horas manual</button>
      <button class="icon-btn-ghost" id="toggleHistoricoBanco">${state.showHistoricoBanco ? '✕ Fechar histórico' : '📜 Ver histórico do banco de horas'}</button>
      ${saldoBancoHoras > 0 ? `<button class="icon-btn-ghost" id="togglePagarSaldoBanco">💰 Pagar saldo em dinheiro</button>` : ''}
    </div>
    ${state.showPagarSaldoBanco ? `
      <div class="form-card">
        <div class="form-hint" style="margin-bottom:2px">Saldo disponível: <strong style="color:var(--teal)">${formatarHorasMin(saldoBancoHoras)}</strong></div>
        <div class="form-row">
          <input type="text" id="pagarBancoHorasH" placeholder="Horas (ex: 5)" inputmode="numeric" />
          <input type="text" id="pagarBancoHorasM" placeholder="Minutos (ex: 30)" inputmode="numeric" />
        </div>
        <input type="text" id="pagarBancoValor" placeholder="Valor a pagar (R$) — sugestão: horas × valor da hora" />
        <div class="form-hint" style="margin-top:2px">O valor sugerido é só horas × valor da hora (sem adicional) — ajuste na mão se quiser incluir o adicional de hora extra que ela abriu mão ao guardar no banco.</div>
        <input type="text" id="pagarBancoDescricao" placeholder="Descrição (opcional)" />
        <div class="form-row" style="margin-top:8px">
          <button class="confirm-btn" data-confirmar-pagar-banco="${funcionariaId}" data-valor-hora="${f ? f.valorHora : 0}">Pagar e debitar do banco</button>
          <button class="toggle-btn" id="cancelarPagarSaldoBanco">Cancelar</button>
        </div>
      </div>
    ` : ''}
    ${state.showHistoricoBanco ? (() => {
      const lancamentos = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === funcionariaId).sort((a, b) => b.data.localeCompare(a.data));
      if (lancamentos.length === 0) return `<div class="empty-state">Nenhum lançamento no banco de horas ainda.</div>`;
      return `
        <div class="tx-list" style="margin-bottom:14px">
          ${lancamentos.map((b) => {
            if (state.editingBancoHorasId === b.id) {
              const tipoEdit = window.__editBancoTipo || b.tipo;
              const horasAbs = Math.abs(b.horas);
              const hEdit = Math.floor(horasAbs);
              const mEdit = Math.round((horasAbs - hEdit) * 60);
              return `
                <div class="form-card">
                  <div class="form-row">
                    <button class="toggle-btn ${tipoEdit === 'credito' ? 'active-teal' : ''}" data-edit-banco-tipo="credito">➕ Crédito</button>
                    <button class="toggle-btn ${tipoEdit === 'debito' ? 'active-pink' : ''}" data-edit-banco-tipo="debito">➖ Débito</button>
                  </div>
                  <div class="form-row">
                    <input type="text" id="editBancoHorasH-${b.id}" placeholder="Horas" value="${hEdit}" inputmode="numeric" />
                    <input type="text" id="editBancoHorasM-${b.id}" placeholder="Minutos" value="${mEdit}" inputmode="numeric" />
                  </div>
                  <input type="text" id="editBancoDescricao-${b.id}" placeholder="Descrição" value="${esc(b.descricao || '')}" />
                  <input type="month" id="editBancoMesRef-${b.id}" value="${b.mesReferencia || b.data.slice(0, 7)}" style="margin-top:8px" />
                  <div class="form-row" style="margin-top:8px">
                    <button class="confirm-btn" data-salvar-edit-banco="${b.id}">Salvar</button>
                    <button class="toggle-btn" data-cancelar-edit-banco="1">Cancelar</button>
                  </div>
                </div>
              `;
            }
            return `
            <div class="tx-row">
              <div class="tx-dot" style="background:${b.horas >= 0 ? 'var(--teal)' : 'var(--red)'}"></div>
              <div style="flex:1">
                <div class="tx-categoria">${b.tipo === 'credito' ? '➕ Crédito' : '➖ Débito'}${b.descricao ? ` — ${esc(b.descricao)}` : ''}</div>
                <div class="tx-date">${new Date(b.data + 'T00:00:00').toLocaleDateString('pt-BR')}${b.mesReferencia && b.mesReferencia !== b.data.slice(0, 7) ? ` · referente a ${new Date(b.mesReferencia + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}` : ''}</div>
              </div>
              <div class="tx-valor" style="margin-right:6px;color:${b.horas >= 0 ? 'var(--teal)' : 'var(--red)'}">${b.horas >= 0 ? '+' : '-'}${formatarHorasMin(b.horas)}</div>
              <button class="trash-btn" data-editar-banco="${b.id}">✏️</button>
              <button class="trash-btn" data-remover-banco="${b.id}">🗑</button>
            </div>
          `;
          }).join('')}
        </div>
      `;
    })() : ''}
    ${state.showLancamentoBanco ? `
      <div class="form-card">
        <div class="form-row">
          <button class="toggle-btn ${(window.__tipoLancBanco || 'credito') === 'credito' ? 'active-teal' : ''}" data-tipo-lanc-banco="credito">➕ Crédito (a favor dela)</button>
          <button class="toggle-btn ${window.__tipoLancBanco === 'debito' ? 'active-pink' : ''}" data-tipo-lanc-banco="debito">➖ Débito (ela deve)</button>
        </div>
        <div class="form-row">
          <input type="text" id="lancBancoHorasH" placeholder="Horas (ex: 3)" inputmode="numeric" />
          <input type="text" id="lancBancoHorasM" placeholder="Minutos (ex: 54)" inputmode="numeric" />
        </div>
        <input type="text" id="lancBancoDescricao" placeholder="Descrição (ex: saldo de junho, antes do sistema)" />
        <input type="month" id="lancBancoMesRef" value="${todayStr().slice(0, 7)}" style="margin-top:8px" />
        <div class="form-hint" style="margin-top:-4px">De qual mês é esse saldo? A data de hoje fica guardada certinho (não mexe nisso), só o "mês de referência" que muda — assim, se for saldo de um mês anterior, ele entra certo na conta do "saldo de antes" sem precisar alterar a data real do lançamento.</div>
        <button class="confirm-btn" style="margin-top:8px" data-salvar-lanc-banco="${funcionariaId}">Lançar</button>
      </div>
    ` : ''}

    <input type="month" class="month-input" id="holeriteMesSelect" value="${mesHolerite}" />

    ${!f ? '' : holeriteExistente ? `
      <div class="form-card" style="border-color:var(--teal)55">
        <div class="section-title" style="margin-bottom:2px;color:var(--teal)">✅ Holerite de ${mesLabelHolerite(mesHolerite)} já fechado</div>
        ${holeriteExistente.numeroRecibo ? `<div class="form-hint" style="margin-bottom:8px">Recibo nº ${holeriteExistente.numeroRecibo} · emitido em ${new Date(holeriteExistente.createdAt).toLocaleDateString('pt-BR')}${holeriteExistente.emitidoPor ? ` por ${holeriteExistente.emitidoPor === 'dono' ? 'Proprietária' : 'Supervisora'}` : ''}</div>` : ''}
        <div class="prod-breakdown" style="margin-top:10px">
          <div class="prod-breakdown-item"><span>Dias trabalhados</span><span>${holeriteExistente.diasTrabalhados}</span></div>
          <div class="prod-breakdown-item"><span>Salário base</span><span>${fmt(holeriteExistente.salarioBase)}</span></div>
          <div class="prod-breakdown-item"><span>Horas extras (${formatarHorasMin(holeriteExistente.horasExtras)})</span><span>${holeriteExistente.modoHorasExtras === 'dinheiro' ? fmt(holeriteExistente.valorHorasExtras) : '🏦 banco de horas'}</span></div>
          ${holeriteExistente.horasExtras100 > 0 ? `<div class="prod-breakdown-item"><span>🗓️ Domingo/feriado — 100% (${formatarHorasMin(holeriteExistente.horasExtras100)})</span><span>${holeriteExistente.modoHorasExtras === 'dinheiro' ? fmt(holeriteExistente.valorHorasExtras100) : '🏦 banco de horas (em dobro)'}</span></div>` : ''}
          <div class="prod-breakdown-item"><span>Horas faltantes não abonadas</span><span>${formatarHorasMin(holeriteExistente.horasFaltantes)} 🏦 débito no banco</span></div>
          ${horasBancoUsadasFechado > 0 ? `<div class="prod-breakdown-item"><span>🏦 Banco de horas usado nesse mês</span><span style="color:var(--amber)">-${formatarHorasMin(horasBancoUsadasFechado)}</span></div>` : ''}
          ${horasBancoPagasDinheiroFechado > 0 ? `<div class="prod-breakdown-item"><span>💰 Banco de horas pago em dinheiro</span><span style="color:var(--teal)">${formatarHorasMin(horasBancoPagasDinheiroFechado)} · ${fmt(valorBancoPagoDinheiroFechado)}</span></div>` : ''}
          <div class="prod-breakdown-item"><span>Auxílio Transporte</span><span>${fmt(holeriteExistente.valorVt)}</span></div>
          <div class="prod-breakdown-item"><span>Auxílio Alimentação</span><span>${fmt(holeriteExistente.valorVr)}</span></div>
          ${holeriteExistente.diasFeriasGozados > 0 ? `<div class="prod-breakdown-item"><span>🏖️ Recesso (${holeriteExistente.diasFeriasGozados} dias + adicional)</span><span>${fmt(holeriteExistente.valorFerias * (4 / 3))}</span></div>` : ''}
          ${holeriteExistente.diasVendidos > 0 ? `<div class="prod-breakdown-item"><span>💰 Dias vendidos (${holeriteExistente.diasVendidos} dias + adicional)</span><span>${fmt(holeriteExistente.valorAbonoPecuniario * (4 / 3))}</span></div>` : ''}
          ${totalAdiantamentosDoMesHolerite > 0 ? `<div class="prod-breakdown-item"><span>💸 Adiantamento/vale descontado</span><span style="color:var(--red)">-${fmt(totalAdiantamentosDoMesHolerite)}</span></div>` : ''}
        </div>
        <div class="produto-vendido" style="margin-top:8px">💰 Total pago: ${fmt(holeriteExistente.totalPagar)}</div>
        ${extratoBancoMes && (extratoBancoMes.saldoAnterior !== 0 || extratoBancoMes.produzido !== 0 || extratoBancoMes.consumido !== 0) ? `
          <div class="form-hint" style="margin-top:10px;margin-bottom:2px">Extrato do banco de horas desse mês</div>
          <div class="prod-breakdown">
            <div class="prod-breakdown-item"><span>Saldo anterior</span><span>${extratoBancoMes.saldoAnterior >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoAnterior)}</span></div>
            <div class="prod-breakdown-item"><span>Produzido no mês</span><span style="color:var(--teal)">+${formatarHorasMin(extratoBancoMes.produzido)}</span></div>
            <div class="prod-breakdown-item"><span>Consumido no mês</span><span style="color:var(--red)">-${formatarHorasMin(extratoBancoMes.consumido)}</span></div>
            <div class="prod-breakdown-item"><span><strong>Saldo final</strong></span><span><strong>${extratoBancoMes.saldoFinal >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoFinal)}</strong></span></div>
          </div>
        ` : ''}
        <div class="form-hint" style="margin-top:8px">${holeriteExistente.assinadoEm ? `✅ Assinado por ${esc(f.nome)} em ${new Date(holeriteExistente.assinadoEm).toLocaleString('pt-BR')}` : '⏳ Aguardando a funcionária confirmar/assinar pelo celular dela'}</div>
        ${holeriteExistente.assinaturaImagem ? `<img src="${holeriteExistente.assinaturaImagem}" alt="Assinatura" style="background:#fff;border-radius:6px;height:50px;margin-top:6px" />` : ''}
        <div class="form-row" style="margin-top:10px">
          <button class="icon-btn-ghost" data-baixar-pdf-holerite="${holeriteExistente.id}">🖨️ Baixar PDF</button>
          <button class="icon-btn-ghost" data-enviar-email-holerite="${holeriteExistente.id}">📧 Enviar por e-mail</button>
          <button class="toggle-btn" data-reabrir-holerite="${holeriteExistente.id}">Refazer esse holerite</button>
        </div>
      </div>
    ` : `
      <div class="form-card">
        <div class="section-subtitle" style="margin-bottom:10px">Resumo calculado de ${mesLabelHolerite(mesHolerite)}</div>
        <div class="prod-breakdown">
          <div class="prod-breakdown-item"><span>Dias trabalhados</span><span>${resumoHolerite.diasTrabalhados}</span></div>
          <div class="prod-breakdown-item"><span>${f.tipoPagamento === 'mensal' ? 'Salário mensal' : `Salário (${resumoHolerite.horasTrabalhadasTotal.toFixed(1)}h × ${fmt(f.valorHora)})`}</span><span>${fmt(resumoHolerite.salarioBase)}</span></div>
          ${resumoHolerite.debitoCompensacaoSabado > 0 ? `
            <div class="prod-breakdown-item"><span>Saldo bruto do mês (extras − faltas dos dias úteis)</span><span>${resumoHolerite.saldoAntesCompensacao >= 0 ? '+' : '-'}${formatarHorasMin(resumoHolerite.saldoAntesCompensacao)}</span></div>
            <div class="prod-breakdown-item"><span>⚖️ Compensação de sábado</span><span style="color:var(--amber)">-${formatarHorasMin(resumoHolerite.debitoCompensacaoSabado)}</span></div>
            <div class="prod-breakdown-item"><span><strong>= Saldo líquido do mês</strong></span><span><strong style="color:${resumoHolerite.horasExtras > 0 ? 'var(--teal)' : resumoHolerite.horasFaltantes > 0 ? 'var(--red)' : 'var(--text)'}">${resumoHolerite.horasExtras > 0 ? '+' + formatarHorasMin(resumoHolerite.horasExtras) : resumoHolerite.horasFaltantes > 0 ? '-' + formatarHorasMin(resumoHolerite.horasFaltantes) : '0min'}</strong></span></div>
          ` : ''}
          <div class="prod-breakdown-item"><span>Horas extras (${formatarHorasMin(resumoHolerite.horasExtras)} × ${fmt(f.valorHora)} + ${f.percentualHoraExtra}%)</span><span>${fmt(resumoHolerite.valorHorasExtras)}</span></div>
          ${resumoHolerite.horasExtras100 > 0 ? `<div class="prod-breakdown-item"><span>🗓️ Domingo/feriado — 100% (${formatarHorasMin(resumoHolerite.horasExtras100)} × ${fmt(f.valorHora)} × 2)</span><span>${fmt(resumoHolerite.valorHorasExtras100)}</span></div>` : ''}
          ${resumoHolerite.horasBancoUsadas > 0 ? `<div class="prod-breakdown-item"><span>🏦 Banco de horas usado nesse mês</span><span style="color:var(--amber)">-${formatarHorasMin(resumoHolerite.horasBancoUsadas)}</span></div>` : ''}
          ${resumoHolerite.horasBancoPagasDinheiro > 0 ? `<div class="prod-breakdown-item"><span>💰 Banco de horas pago em dinheiro (já lançado, não soma no total)</span><span style="color:var(--teal)">${formatarHorasMin(resumoHolerite.horasBancoPagasDinheiro)} · ${fmt(resumoHolerite.valorBancoPagoDinheiro)}</span></div>` : ''}
          <div class="prod-breakdown-item"><span>Horas faltantes não abonadas</span><span style="color:var(--red)">${formatarHorasMin(resumoHolerite.horasFaltantes)}</span></div>
          ${resumoFerias && resumoFerias.diasGozados > 0 ? `<div class="prod-breakdown-item"><span>🏖️ Recesso (${resumoFerias.diasGozados} dias + adicional)</span><span>${fmt(resumoFerias.valorFeriasGozadas + resumoFerias.tercoFerias)}</span></div>` : ''}
          ${resumoFerias && resumoFerias.diasVendidos > 0 ? `<div class="prod-breakdown-item"><span>💰 Dias vendidos (${resumoFerias.diasVendidos} dias + adicional)</span><span>${fmt(resumoFerias.valorAbono + resumoFerias.tercoAbono)}</span></div>` : ''}
          ${totalAdiantamentosDoMesHolerite > 0 ? `<div class="prod-breakdown-item"><span>💸 Adiantamento/vale descontado</span><span style="color:var(--red)">-${fmt(totalAdiantamentosDoMesHolerite)}</span></div>` : ''}
        </div>
        ${extratoBancoMes && (extratoBancoMes.saldoAnterior !== 0 || extratoBancoMes.produzido !== 0 || extratoBancoMes.consumido !== 0) ? `
          <div class="form-hint" style="margin-top:10px;margin-bottom:2px">Extrato do banco de horas desse mês</div>
          <div class="prod-breakdown">
            <div class="prod-breakdown-item"><span>Saldo anterior</span><span>${extratoBancoMes.saldoAnterior >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoAnterior)}</span></div>
            <div class="prod-breakdown-item"><span>Produzido no mês</span><span style="color:var(--teal)">+${formatarHorasMin(extratoBancoMes.produzido)}</span></div>
            <div class="prod-breakdown-item"><span>Consumido no mês</span><span style="color:var(--red)">-${formatarHorasMin(extratoBancoMes.consumido)}</span></div>
            <div class="prod-breakdown-item"><span><strong>Saldo final</strong></span><span><strong>${extratoBancoMes.saldoFinal >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoFinal)}</strong></span></div>
          </div>
        ` : ''}
        <div class="form-hint" style="margin-top:10px;margin-bottom:2px">Como pagar as horas extras desse mês?</div>
        <div class="form-row">
          <button class="toggle-btn ${(window.__holeriteModoExtras || f.modoCompensacaoPadrao) === 'dinheiro' ? 'active-teal' : ''}" data-holerite-modo-extras="dinheiro">💰 Dinheiro</button>
          <button class="toggle-btn ${(window.__holeriteModoExtras || f.modoCompensacaoPadrao) === 'banco' ? 'active-pink' : ''}" data-holerite-modo-extras="banco">🏦 Banco de horas</button>
        </div>
        <div class="form-hint" style="margin-top:10px">Horas faltantes não abonadas sempre viram débito no banco de horas — ela paga trabalhando depois.</div>

        <div class="form-hint" style="margin-top:14px;margin-bottom:2px">💸 Adiantamento/vale (desconta automático do holerite desse mês)</div>
        ${(() => {
          const adiantamentosDoMes = state.adiantamentos.filter((a) => a.funcionariaId === funcionariaId && a.data.slice(0, 7) === mesHolerite).sort((a, b) => a.data.localeCompare(b.data));
          const totalAdiantamentosDoMes = adiantamentosDoMes.reduce((acc, a) => acc + a.valor, 0);
          return `
            ${adiantamentosDoMes.length > 0 ? `
              <div class="prod-breakdown">
                ${adiantamentosDoMes.map((a) => `<div class="prod-breakdown-item"><span>${dataFmt(a.data)}${a.motivo ? ` — ${esc(a.motivo)}` : ''}</span><span>${fmt(a.valor)} <button class="trash-btn" data-remover-adiantamento="${a.id}" style="margin-left:6px">🗑</button></span></div>`).join('')}
                <div class="prod-breakdown-item"><span><strong>Total já adiantado esse mês</strong></span><span><strong>${fmt(totalAdiantamentosDoMes)}</strong></span></div>
              </div>
            ` : `<div class="form-hint" style="color:var(--text-muted)">Nenhum adiantamento lançado em ${mesLabelHolerite(mesHolerite)} ainda.</div>`}
            <button class="entrada-btn" type="button" id="toggleNovoAdiantamento" style="margin-top:6px">＋ Registrar adiantamento/vale</button>
            ${state.showNovoAdiantamento ? `
              <div class="form-row" style="margin-top:8px">
                <input type="text" id="novoAdiantamentoValor" placeholder="Valor (ex: 100,00)" />
                <input type="date" id="novoAdiantamentoData" value="${todayStr()}" />
              </div>
              <input type="text" id="novoAdiantamentoMotivo" placeholder="Motivo (opcional)" style="margin-top:6px" />
              <div class="form-row" style="margin-top:6px">
                <button class="confirm-btn" id="salvarNovoAdiantamento" data-funcionaria="${funcionariaId}">Salvar adiantamento</button>
                <button class="toggle-btn" id="cancelarNovoAdiantamento">Cancelar</button>
              </div>
            ` : ''}
          `;
        })()}

        <div class="form-hint" style="margin-top:14px;margin-bottom:2px">Auxílio Transporte/Alimentação do mês</div>
        <div class="form-row">
          <input type="text" id="holeriteVt" placeholder="Auxílio Transporte mensal fixo" value="${window.__holeriteVtOverride != null ? window.__holeriteVtOverride : resumoHolerite.valorVt.toFixed(2).replace('.', ',')}" />
          <input type="text" id="holeriteVr" placeholder="Auxílio Alimentação mensal fixo" value="${window.__holeriteVrOverride != null ? window.__holeriteVrOverride : resumoHolerite.valorVr.toFixed(2).replace('.', ',')}" />
        </div>
        <div class="form-hint" style="margin-top:10px;margin-bottom:2px">Data do pagamento (é a data que vai aparecer no Financeiro)</div>
        <input type="date" id="holeriteDataPagamento" value="${state.holeriteDataPagamento || (() => { const [anoH, mesH] = mesHolerite.split('-').map(Number); const ultimoDiaH = new Date(anoH, mesH, 0).getDate(); const hojeReal = todayStr(); const candidato = `${mesHolerite}-${String(ultimoDiaH).padStart(2, '0')}`; return candidato <= hojeReal ? candidato : hojeReal; })()}" />
        <div class="form-row" style="margin-top:12px">
          <button class="icon-btn-ghost" data-visualizar-previa="${funcionariaId}">👁️ Visualizar prévia</button>
          <button class="confirm-btn" data-fechar-holerite="${funcionariaId}">Fechar holerite de ${mesLabelHolerite(mesHolerite)}</button>
        </div>
      </div>

      ${state.showPreviaHolerite && window.__previaHoleriteData ? (() => {
        const d = window.__previaHoleriteData;
        return `
          <div class="form-card" style="border-color:var(--border);background:var(--surface2)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div>
                <div style="font-weight:700;font-size:14px">${esc(state.empresaConfig.razaoSocial || 'ROSA JULIETA')}</div>
                <div style="font-size:11.5px;color:var(--text-muted)">Recibo de Pagamento de Salário</div>
                ${state.empresaConfig.cnpj ? `<div style="font-size:11px;color:var(--text-muted)">CNPJ: ${esc(state.empresaConfig.cnpj)}</div>` : ''}
              </div>
              <button class="trash-btn" data-fechar-previa="1">✕</button>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:10px;font-size:12.5px;margin-bottom:10px">
              <div>Funcionária: <strong>${esc(f.nome)}</strong></div>
              ${f.cargo ? `<div>Cargo: <strong>${esc(f.cargo)}</strong></div>` : ''}
              ${f.matricula ? `<div>Matrícula: <strong>${esc(f.matricula)}</strong></div>` : ''}
              ${f.cpf ? `<div>CNPJ: <strong>${formatarCnpj(f.cpf)}</strong></div>` : ''}
              <div>Referência: <strong>${mesLabelHolerite(mesHolerite)} (${new Date(Number(mesHolerite.slice(0, 4)), Number(mesHolerite.slice(5, 7)), 0).getDate()} dias)</strong></div>
              <div>Dias trabalhados: <strong>${resumoHolerite.diasTrabalhados}</strong></div>
              ${(() => {
                const oc = calcularResumoOcorrencias(f.id, mesHolerite);
                if (oc.diasAtestado + oc.diasAbono + oc.diasFerias === 0) return '';
                const partes = [];
                if (oc.diasAtestado > 0) partes.push(`${oc.diasAtestado} atestado(s)`);
                if (oc.diasAbono > 0) partes.push(`${oc.diasAbono} abono(s)/folga(s)`);
                if (oc.diasFerias > 0) partes.push(`${oc.diasFerias} dia(s) de recesso`);
                return `<div>Ocorrências: <strong>${partes.join(', ')}</strong></div>`;
              })()}
            </div>
            <div class="prod-breakdown">
              <div class="prod-breakdown-item"><span>${f.tipoPagamento === 'mensal' ? 'Salário mensal' : `Salário (${resumoHolerite.horasTrabalhadasTotal.toFixed(1)}h)`}</span><span>${fmt(resumoHolerite.salarioBase)}</span></div>
              ${resumoHolerite.horasExtras > 0 ? `<div class="prod-breakdown-item"><span>Horas extras (${formatarHorasMin(resumoHolerite.horasExtras)} + ${f.percentualHoraExtra}%)</span><span>${d.modoHorasExtras === 'banco' ? '🏦 banco de horas' : fmt(resumoHolerite.valorHorasExtras)}</span></div>` : ''}
              ${resumoHolerite.horasExtras100 > 0 ? `<div class="prod-breakdown-item"><span>🗓️ Domingo/feriado — 100%</span><span>${d.modoHorasExtras === 'banco' ? '🏦 banco de horas' : fmt(resumoHolerite.valorHorasExtras100)}</span></div>` : ''}
              ${d.valorVt > 0 ? `<div class="prod-breakdown-item"><span>Auxílio Transporte</span><span>${fmt(d.valorVt)}</span></div>` : ''}
              ${d.valorVr > 0 ? `<div class="prod-breakdown-item"><span>Auxílio Alimentação</span><span>${fmt(d.valorVr)}</span></div>` : ''}
              ${d.resumoFerias && d.resumoFerias.diasGozados > 0 ? `<div class="prod-breakdown-item"><span>🏖️ Recesso (${d.resumoFerias.diasGozados} dias + adicional)</span><span>${fmt(d.resumoFerias.valorFeriasGozadas + d.resumoFerias.tercoFerias)}</span></div>` : ''}
              ${d.resumoFerias && d.resumoFerias.diasVendidos > 0 ? `<div class="prod-breakdown-item"><span>💰 Dias vendidos (${d.resumoFerias.diasVendidos} dias + adicional)</span><span>${fmt(d.resumoFerias.valorAbono + d.resumoFerias.tercoAbono)}</span></div>` : ''}
              ${d.totalAdiantamentosMes > 0 ? `<div class="prod-breakdown-item"><span>💸 Adiantamento/vale descontado</span><span style="color:var(--red)">-${fmt(d.totalAdiantamentosMes)}</span></div>` : ''}
            </div>
            <div class="produto-vendido" style="margin-top:10px">💰 Total líquido: ${fmt(d.totalPagar)}</div>
            ${resumoHolerite.horasFaltantes > 0 ? `<div class="form-hint" style="margin-top:8px;color:var(--red)">${formatarHorasMin(resumoHolerite.horasFaltantes)} de falta não abonada — vira débito no banco de horas.</div>` : ''}
            ${resumoHolerite.horasBancoUsadas > 0 ? `<div class="form-hint" style="margin-top:6px;color:var(--amber)">🏦 ${formatarHorasMin(resumoHolerite.horasBancoUsadas)} do saldo do banco de horas foram usadas pra cobrir faltas parciais nesse mês.</div>` : ''}
            ${resumoHolerite.horasBancoPagasDinheiro > 0 ? `<div class="form-hint" style="margin-top:6px;color:var(--teal)">💰 ${formatarHorasMin(resumoHolerite.horasBancoPagasDinheiro)} do banco de horas já foram pagas em dinheiro nesse mês (${fmt(resumoHolerite.valorBancoPagoDinheiro)}), lançamento já feito à parte.</div>` : ''}
            ${d.modoHorasExtras === 'banco' && (resumoHolerite.horasExtras > 0 || resumoHolerite.horasExtras100 > 0) ? `<div class="form-hint" style="margin-top:6px">Horas extras desse mês serão creditadas no banco de horas, não pagas em dinheiro.</div>` : ''}
            ${extratoBancoMes && (extratoBancoMes.saldoAnterior !== 0 || extratoBancoMes.produzido !== 0 || extratoBancoMes.consumido !== 0) ? `
              <div class="form-hint" style="margin-top:10px;margin-bottom:2px">Extrato do banco de horas desse mês</div>
              <div class="prod-breakdown">
                <div class="prod-breakdown-item"><span>Saldo anterior</span><span>${extratoBancoMes.saldoAnterior >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoAnterior)}</span></div>
                <div class="prod-breakdown-item"><span>Produzido no mês</span><span style="color:var(--teal)">+${formatarHorasMin(extratoBancoMes.produzido)}</span></div>
                <div class="prod-breakdown-item"><span>Consumido no mês</span><span style="color:var(--red)">-${formatarHorasMin(extratoBancoMes.consumido)}</span></div>
                <div class="prod-breakdown-item"><span><strong>Saldo final</strong></span><span><strong>${extratoBancoMes.saldoFinal >= 0 ? '+' : '-'}${formatarHorasMin(extratoBancoMes.saldoFinal)}</strong></span></div>
              </div>
            ` : ''}
            <div class="form-hint" style="margin-top:10px">📌 Isso é só uma prévia na tela — nada foi salvo. Clique em "Fechar holerite" acima quando estiver tudo certo.</div>
          </div>
        `;
      })() : ''}
    `}

    ${historicoHolerites.length > 0 ? `
      <div class="section-title-wrap" style="margin-top:20px"><div><div class="section-title">Histórico de holerites</div></div></div>
      <div class="tx-list" style="margin-bottom:24px">
        ${historicoHolerites.map((h) => `
          <div class="tx-row">
            <div class="tx-dot" style="background:var(--teal)"></div>
            <div style="flex:1">
              <div class="tx-categoria">${mesLabelHolerite(h.mes)}</div>
              <div class="tx-desc">${h.diasTrabalhados} dias · +${formatarHorasMin(h.horasExtras)} extra · -${formatarHorasMin(h.horasFaltantes)} falta</div>
            </div>
            <div class="tx-valor" style="color:var(--teal)">${fmt(h.totalPagar)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function attachRHHandlers(c) {
  const copiarLinkPonto = document.getElementById('copiarLinkPonto');
  if (copiarLinkPonto) copiarLinkPonto.addEventListener('click', async () => {
    const link = `${window.location.origin}/?ponto=1`;
    try {
      await navigator.clipboard.writeText(link);
      alert(`Link copiado!\n\n${link}\n\nManda pra funcionária — ela abre, digita o PIN dela e já cai na tela de bater ponto.`);
    } catch (e) {
      prompt('Copia esse link manualmente:', link);
    }
  });

  document.querySelectorAll('[data-aprovar-solicitacao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const solicitacao = state.solicitacoesPonto.find((s) => s.id === btn.dataset.aprovarSolicitacao);
      if (!solicitacao) return;
      if (!confirm('Aceitar essa solicitação? Isso cria a batida de ponto oficialmente.')) return;
      await aprovarSolicitacaoPonto(solicitacao);
      await loadData();
    });
  });
  document.querySelectorAll('[data-recusar-solicitacao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Recusar essa solicitação?')) return;
      await rejeitarSolicitacaoPonto(btn.dataset.recusarSolicitacao);
      await loadData();
    });
  });

  document.querySelectorAll('[data-toggle-dia-horario]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const el = document.getElementById(cb.dataset.toggleDiaHorario);
      if (el) el.style.display = cb.checked ? '' : 'none';
    });
  });

  // liga o cálculo ao vivo do total semanal, sem re-renderizar a tela (pra não perder o que já foi digitado)
  const prefixosAtivos = ['func'];
  if (state.editingFuncionariaId) prefixosAtivos.push(`editFunc${state.editingFuncionariaId}`);
  prefixosAtivos.forEach((prefixo) => {
    const container = document.getElementById(`${prefixo}JornadaEditor`);
    if (!container) return;
    atualizarTotalSemanal(prefixo);
    container.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => atualizarTotalSemanal(prefixo));
      input.addEventListener('change', () => atualizarTotalSemanal(prefixo));
    });
  });

  if (state.rhFuncionariaDetalheId) {
    const voltar = document.getElementById('voltarFuncionarias');
    if (voltar) voltar.addEventListener('click', () => { state.rhFuncionariaDetalheId = null; state.editingPontoId = null; state.showFeriasForm = false; state.showAbonarId = null; state.showPreviaHolerite = false; window.__previaHoleriteData = null; state.holeriteDataPagamento = null; window.__holeriteVtOverride = null; window.__holeriteVrOverride = null; state.showNovoAdiantamento = false; render(); });

    document.querySelectorAll('[data-abrir-abonar]').forEach((btn) => {
      btn.addEventListener('click', () => { state.showAbonarId = btn.dataset.abrirAbonar; render(); });
    });
    document.querySelectorAll('[data-cancelar-abonar]').forEach((btn) => {
      btn.addEventListener('click', () => { state.showAbonarId = null; render(); });
    });
    document.querySelectorAll('[data-salvar-abono]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const funcionariaId = btn.dataset.salvarAbono;
        const data = btn.dataset.data;
        const tipo = document.getElementById(`abonarTipo-${data}`).value;
        const motivo = document.getElementById(`abonarMotivo-${data}`).value.trim();
        const h = Number(document.getElementById(`abonarHorasH-${data}`)?.value) || 0;
        const m = Number(document.getElementById(`abonarHorasM-${data}`)?.value) || 0;
        const horasParciais = (h + m / 60) || null;
        await salvarAbono(funcionariaId, data, tipo, motivo, horasParciais);
        state.showAbonarId = null;
        await loadData();
      });
    });
    document.querySelectorAll('[data-remover-abono]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esse abono? O dia volta a contar como pendente se não tiver batida.')) {
          await removeAbono(btn.dataset.removerAbono);
          await loadData();
        }
      });
    });

    const toggleLancamentoBanco = document.getElementById('toggleLancamentoBanco');
    if (toggleLancamentoBanco) toggleLancamentoBanco.addEventListener('click', () => { state.showLancamentoBanco = !state.showLancamentoBanco; render(); });
    const toggleHistoricoBanco = document.getElementById('toggleHistoricoBanco');
    if (toggleHistoricoBanco) toggleHistoricoBanco.addEventListener('click', () => { state.showHistoricoBanco = !state.showHistoricoBanco; render(); });

    document.querySelectorAll('[data-editar-banco]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editingBancoHorasId = btn.dataset.editarBanco; window.__editBancoTipo = null; render(); });
    });
    document.querySelectorAll('[data-cancelar-edit-banco]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editingBancoHorasId = null; render(); });
    });
    document.querySelectorAll('[data-edit-banco-tipo]').forEach((btn) => {
      btn.addEventListener('click', () => { window.__editBancoTipo = btn.dataset.editBancoTipo; render(); });
    });
    document.querySelectorAll('[data-salvar-edit-banco]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.salvarEditBanco;
        const original = state.bancoHorasLancamentos.find((b) => b.id === id);
        const tipo = window.__editBancoTipo || original.tipo;
        const h = Number(document.getElementById(`editBancoHorasH-${id}`).value) || 0;
        const m = Number(document.getElementById(`editBancoHorasM-${id}`).value) || 0;
        const horas = h + m / 60;
        const descricao = document.getElementById(`editBancoDescricao-${id}`).value.trim();
        const mesRefEdit = document.getElementById(`editBancoMesRef-${id}`)?.value || original.mesReferencia || original.data.slice(0, 7);
        if (!horas || horas <= 0) { alert('Informe as horas ou minutos.'); return; }
        await updateBancoHorasLancamento(id, tipo, horas, descricao, mesRefEdit);
        state.editingBancoHorasId = null;
        window.__editBancoTipo = null;
        await loadData();
      });
    });
    document.querySelectorAll('[data-remover-banco]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esse lançamento do banco de horas?')) {
          await removeBancoHorasLancamento(btn.dataset.removerBanco);
          await loadData();
        }
      });
    });

    const togglePagarSaldoBanco = document.getElementById('togglePagarSaldoBanco');
    if (togglePagarSaldoBanco) togglePagarSaldoBanco.addEventListener('click', () => { state.showPagarSaldoBanco = true; render(); });
    const cancelarPagarSaldoBanco = document.getElementById('cancelarPagarSaldoBanco');
    if (cancelarPagarSaldoBanco) cancelarPagarSaldoBanco.addEventListener('click', () => { state.showPagarSaldoBanco = false; render(); });

    const pagarBancoConfirmBtn = document.querySelector('[data-confirmar-pagar-banco]');
    if (pagarBancoConfirmBtn) {
      const valorHoraFunc = Number(pagarBancoConfirmBtn.dataset.valorHora) || 0;
      const sugerirValor = () => {
        const h = Number(document.getElementById('pagarBancoHorasH')?.value) || 0;
        const m = Number(document.getElementById('pagarBancoHorasM')?.value) || 0;
        const valorInput = document.getElementById('pagarBancoValor');
        if (valorInput && !valorInput.dataset.editadoManual) {
          valorInput.value = ((h + m / 60) * valorHoraFunc).toFixed(2).replace('.', ',');
        }
      };
      document.getElementById('pagarBancoHorasH')?.addEventListener('input', sugerirValor);
      document.getElementById('pagarBancoHorasM')?.addEventListener('input', sugerirValor);
      document.getElementById('pagarBancoValor')?.addEventListener('input', (e) => { e.target.dataset.editadoManual = '1'; });

      pagarBancoConfirmBtn.addEventListener('click', async () => {
        const funcionariaId = pagarBancoConfirmBtn.dataset.confirmarPagarBanco;
        const funcionaria = state.funcionarias.find((x) => x.id === funcionariaId);
        const h = Number(document.getElementById('pagarBancoHorasH').value) || 0;
        const m = Number(document.getElementById('pagarBancoHorasM').value) || 0;
        const horas = h + m / 60;
        const valor = parseBRNumber(document.getElementById('pagarBancoValor').value);
        const descricao = document.getElementById('pagarBancoDescricao').value.trim();
        if (!horas || horas <= 0) { alert('Informe quantas horas quer pagar.'); return; }
        if (!valor || valor <= 0) { alert('Informe o valor a pagar.'); return; }
        const saldoAtual = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === funcionariaId).reduce((a, b) => a + b.horas, 0);
        if (horas > saldoAtual) { alert(`Ela só tem ${formatarHorasMin(saldoAtual)} de saldo — não dá pra pagar mais do que isso.`); return; }
        if (!confirm(`Pagar ${formatarHorasMin(horas)} do banco de horas de ${funcionaria.nome} por ${fmt(valor)}?\n\nIsso debita do saldo e lança a saída no Financeiro.`)) return;
        const { error: errBanco } = await sb.from('banco_horas_lancamentos').insert({
          funcionaria_id: funcionariaId, data: todayStr(), tipo: 'debito', horas: -horas,
          descricao: `Pago em dinheiro${descricao ? ' — ' + descricao : ''}`,
        });
        if (errBanco) { alert('Erro ao debitar do banco: ' + errBanco.message); return; }
        await addTx({
          tipo: 'saida', valor, categoria: 'Funcionários — salário', natureza: 'fixo',
          descricao: `Pagamento de banco de horas — ${funcionaria.nome} (${formatarHorasMin(horas)})${descricao ? ' — ' + descricao : ''}`,
          data: todayStr(),
        });
        state.showPagarSaldoBanco = false;
        await loadData();
      });
    }
    document.querySelectorAll('[data-tipo-lanc-banco]').forEach((btn) => {
      btn.addEventListener('click', () => { window.__tipoLancBanco = btn.dataset.tipoLancBanco; render(); });
    });
    const salvarLancBanco = document.querySelector('[data-salvar-lanc-banco]');
    if (salvarLancBanco) salvarLancBanco.addEventListener('click', async () => {
      const funcionariaId = salvarLancBanco.dataset.salvarLancBanco;
      const hLanc = Number(document.getElementById('lancBancoHorasH').value) || 0;
      const mLanc = Number(document.getElementById('lancBancoHorasM').value) || 0;
      const horasDigitadas = hLanc + mLanc / 60;
      const descricao = document.getElementById('lancBancoDescricao').value.trim();
      const mesRefLanc = document.getElementById('lancBancoMesRef')?.value || todayStr().slice(0, 7);
      const tipo = window.__tipoLancBanco || 'credito';
      if (!horasDigitadas || horasDigitadas <= 0) { alert('Informe a quantidade de horas ou minutos.'); return; }
      const horas = tipo === 'debito' ? -horasDigitadas : horasDigitadas;
      const { error } = await sb.from('banco_horas_lancamentos').insert({
        funcionaria_id: funcionariaId, data: todayStr(), mes_referencia: mesRefLanc, tipo, horas, descricao: descricao || null,
      });
      if (error) { alert('Erro ao lançar: ' + error.message); return; }
      state.showLancamentoBanco = false;
      window.__tipoLancBanco = null;
      await loadData();
    });

    const holeriteMesSelect = document.getElementById('holeriteMesSelect');
    if (holeriteMesSelect) holeriteMesSelect.addEventListener('change', (e) => { state.holeriteMes = e.target.value; state.showPreviaHolerite = false; state.holeriteDataPagamento = null; window.__holeriteVtOverride = null; window.__holeriteVrOverride = null; render(); });

    // guarda o que a pessoa digitou nesses dois campos pra não perder o valor quando outra
    // ação da mesma tela (ex: "Visualizar prévia", trocar modo de hora extra) causar um
    // novo render — antes, o campo sempre voltava pro valor cadastrado da funcionária
    const holeriteVtInput = document.getElementById('holeriteVt');
    if (holeriteVtInput) holeriteVtInput.addEventListener('input', (e) => { window.__holeriteVtOverride = e.target.value; });
    const holeriteVrInput = document.getElementById('holeriteVr');
    if (holeriteVrInput) holeriteVrInput.addEventListener('input', (e) => { window.__holeriteVrOverride = e.target.value; });

    const toggleNovoAdiantamento = document.getElementById('toggleNovoAdiantamento');
    if (toggleNovoAdiantamento) toggleNovoAdiantamento.addEventListener('click', () => { state.showNovoAdiantamento = !state.showNovoAdiantamento; render(); });

    const cancelarNovoAdiantamento = document.getElementById('cancelarNovoAdiantamento');
    if (cancelarNovoAdiantamento) cancelarNovoAdiantamento.addEventListener('click', () => { state.showNovoAdiantamento = false; render(); });

    const salvarNovoAdiantamento = document.getElementById('salvarNovoAdiantamento');
    if (salvarNovoAdiantamento) salvarNovoAdiantamento.addEventListener('click', async () => {
      const funcionariaId = salvarNovoAdiantamento.dataset.funcionaria;
      const valor = parseBRNumber(document.getElementById('novoAdiantamentoValor').value);
      const data = document.getElementById('novoAdiantamentoData').value;
      const motivo = document.getElementById('novoAdiantamentoMotivo').value.trim();
      if (!valor || valor <= 0) { alert('Informe o valor do adiantamento.'); return; }
      if (!data) { alert('Informe a data do adiantamento.'); return; }
      await registrarAdiantamento(funcionariaId, data, valor, motivo);
      state.showNovoAdiantamento = false;
      await loadData();
    });

    document.querySelectorAll('[data-remover-adiantamento]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esse adiantamento? Isso também remove o lançamento correspondente no Financeiro.')) {
          await removerAdiantamento(btn.dataset.removerAdiantamento);
          await loadData();
        }
      });
    });


    const holeriteDataPagamentoInput = document.getElementById('holeriteDataPagamento');
    if (holeriteDataPagamentoInput) holeriteDataPagamentoInput.addEventListener('change', (e) => { state.holeriteDataPagamento = e.target.value; });

    document.querySelectorAll('[data-holerite-modo-extras]').forEach((btn) => {
      btn.addEventListener('click', () => { window.__holeriteModoExtras = btn.dataset.holeriteModoExtras; render(); });
    });

    document.querySelectorAll('[data-baixar-espelho-ponto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const funcionaria = state.funcionarias.find((x) => x.id === btn.dataset.baixarEspelhoPonto);
        const mesKey = state.holeriteMes || todayStr().slice(0, 7);
        gerarEspelhoPontoPDF(funcionaria, mesKey);
      });
    });

    document.querySelectorAll('[data-visualizar-previa]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const funcionariaId = btn.dataset.visualizarPrevia;
        const funcionaria = state.funcionarias.find((x) => x.id === funcionariaId);
        const mesKey = state.holeriteMes || todayStr().slice(0, 7);
        const resumo = calcularResumoHolerite(funcionaria, mesKey);
        const resumoFeriasPrevia = calcularValorFerias(funcionaria, mesKey);
        const modoHorasExtras = window.__holeriteModoExtras || funcionaria.modoCompensacaoPadrao;
        const valorVt = parseBRNumber(document.getElementById('holeriteVt').value) || 0;
        const valorVr = parseBRNumber(document.getElementById('holeriteVr').value) || 0;
        const totalAdiantamentosMes = state.adiantamentos.filter((a) => a.funcionariaId === funcionariaId && a.data.slice(0, 7) === mesKey).reduce((acc, a) => acc + a.valor, 0);
        const totalPagar = resumo.salarioBase + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras : 0) + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras100 : 0) + valorVt + valorVr + resumoFeriasPrevia.total - totalAdiantamentosMes;
        window.__previaHoleriteData = { modoHorasExtras, valorVt, valorVr, totalPagar, totalAdiantamentosMes, resumoFerias: resumoFeriasPrevia };
        state.showPreviaHolerite = true;
        render();
      });
    });
    document.querySelectorAll('[data-fechar-previa]').forEach((btn) => {
      btn.addEventListener('click', () => { state.showPreviaHolerite = false; render(); });
    });
    document.querySelectorAll('[data-baixar-pdf-holerite]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const holerite = state.holerites.find((h) => h.id === btn.dataset.baixarPdfHolerite);
        const funcionaria = state.funcionarias.find((x) => x.id === holerite.funcionariaId);
        const horasBancoUsadas = state.abonosPonto.filter((a) => a.funcionariaId === holerite.funcionariaId && a.data.slice(0, 7) === holerite.mes && a.horas != null).reduce((acc, a) => acc + a.horas, 0);
        const horasBancoPagasDinheiro = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === holerite.funcionariaId && b.data.slice(0, 7) === holerite.mes && b.descricao && b.descricao.startsWith('Pago em dinheiro')).reduce((acc, b) => acc + Math.abs(b.horas), 0);
        const valorBancoPagoDinheiro = state.tx.filter((t) => t.tipo === 'saida' && monthKey(t.data) === holerite.mes && t.descricao && t.descricao.startsWith(`Pagamento de banco de horas — ${funcionaria.nome}`)).reduce((acc, t) => acc + t.valor, 0);
        gerarHoleritePDF(funcionaria, holerite.mes, { ...holerite, horasBancoUsadas, horasBancoPagasDinheiro, valorBancoPagoDinheiro });
      });
    });

    document.querySelectorAll('[data-enviar-email-holerite]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const holerite = state.holerites.find((h) => h.id === btn.dataset.enviarEmailHolerite);
        const funcionaria = state.funcionarias.find((x) => x.id === holerite.funcionariaId);
        const horasBancoUsadas = state.abonosPonto.filter((a) => a.funcionariaId === holerite.funcionariaId && a.data.slice(0, 7) === holerite.mes && a.horas != null).reduce((acc, a) => acc + a.horas, 0);
        const horasBancoPagasDinheiro = state.bancoHorasLancamentos.filter((b) => b.funcionariaId === holerite.funcionariaId && b.data.slice(0, 7) === holerite.mes && b.descricao && b.descricao.startsWith('Pago em dinheiro')).reduce((acc, b) => acc + Math.abs(b.horas), 0);
        const valorBancoPagoDinheiro = state.tx.filter((t) => t.tipo === 'saida' && monthKey(t.data) === holerite.mes && t.descricao && t.descricao.startsWith(`Pagamento de banco de horas — ${funcionaria.nome}`)).reduce((acc, t) => acc + t.valor, 0);
        enviarHoleritePorEmail(funcionaria, holerite.mes, { ...holerite, horasBancoUsadas, horasBancoPagasDinheiro, valorBancoPagoDinheiro });
      });
    });

    const fecharHoleriteBtn = document.querySelector('[data-fechar-holerite]');
    if (fecharHoleriteBtn) fecharHoleriteBtn.addEventListener('click', async () => {
      const funcionariaId = fecharHoleriteBtn.dataset.fecharHolerite;
      const funcionaria = state.funcionarias.find((x) => x.id === funcionariaId);
      const mesKey = state.holeriteMes || todayStr().slice(0, 7);
      const resumo = calcularResumoHolerite(funcionaria, mesKey);
      const resumoFeriasFechar = calcularValorFerias(funcionaria, mesKey);
      const modoHorasExtras = window.__holeriteModoExtras || funcionaria.modoCompensacaoPadrao;
      const valorVt = parseBRNumber(document.getElementById('holeriteVt').value) || 0;
      const valorVr = parseBRNumber(document.getElementById('holeriteVr').value) || 0;
      const dataPagamento = document.getElementById('holeriteDataPagamento')?.value || todayStr();
      const totalAdiantamentosMes = state.adiantamentos.filter((a) => a.funcionariaId === funcionariaId && a.data.slice(0, 7) === mesKey).reduce((acc, a) => acc + a.valor, 0);
      const totalPagar = resumo.salarioBase + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras : 0) + (modoHorasExtras === 'dinheiro' ? resumo.valorHorasExtras100 : 0) + valorVt + valorVr + resumoFeriasFechar.total - totalAdiantamentosMes;
      const dataPagamentoFmt = new Date(dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR');
      if (!confirm(`Fechar o holerite de ${funcionaria.nome}?\n\nTotal a pagar: ${fmt(totalPagar)}${totalAdiantamentosMes > 0 ? ` (já descontado ${fmt(totalAdiantamentosMes)} de adiantamento)` : ''}\nData do lançamento: ${dataPagamentoFmt}\n\nIsso lança a saída no Financeiro e movimenta o banco de horas. Confirma?`)) return;
      await fecharHolerite(funcionaria, mesKey, resumo, modoHorasExtras, valorVt, valorVr, dataPagamento);
      window.__holeriteModoExtras = null;
      window.__holeriteVtOverride = null;
      window.__holeriteVrOverride = null;
      await loadData();
    });

    document.querySelectorAll('[data-reabrir-holerite]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Refazer esse holerite? Isso apaga o registro fechado (o lançamento já feito no Financeiro e no banco de horas continuam — remova eles manualmente se precisar) e deixa você fechar de novo com os valores recalculados.')) {
          const { error } = await sb.from('holerites').delete().eq('id', btn.dataset.reabrirHolerite);
          if (error) alert('Erro ao reabrir: ' + error.message);
          await loadData();
        }
      });
    });


    const salvarAbonoLivre = document.querySelector('[data-salvar-abono-livre]');
    if (salvarAbonoLivre) salvarAbonoLivre.addEventListener('click', async () => {
      const funcionariaId = salvarAbonoLivre.dataset.salvarAbonoLivre;
      const dataInicio = document.getElementById('abonarLivreData').value;
      const dataFim = document.getElementById('abonarLivreDataFim').value || dataInicio;
      const tipo = document.getElementById('abonarLivreTipo').value;
      const motivo = document.getElementById('abonarLivreMotivo').value.trim();
      const hLivre = Number(document.getElementById('abonarLivreHorasH')?.value) || 0;
      const mLivre = Number(document.getElementById('abonarLivreHorasM')?.value) || 0;
      const horasParciais = (hLivre + mLivre / 60) || null;
      if (!dataInicio) { alert('Preencha a data.'); return; }
      if (dataFim < dataInicio) { alert('A data final precisa ser depois (ou igual) à data inicial.'); return; }
      const datas = [];
      for (let d = new Date(dataInicio + 'T00:00:00'); d <= new Date(dataFim + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
        datas.push(d.toISOString().slice(0, 10));
      }
      for (const data of datas) await salvarAbono(funcionariaId, data, tipo, motivo, horasParciais);
      await loadData();
      alert(`${datas.length} dia(s) abonado(s), de ${new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}.`);
    });

    const toggleFeriasForm = document.getElementById('toggleFeriasForm');
    if (toggleFeriasForm) toggleFeriasForm.addEventListener('click', () => { state.showFeriasForm = !state.showFeriasForm; render(); });

    const salvarFerias = document.querySelector('[data-salvar-ferias]');
    if (salvarFerias) salvarFerias.addEventListener('click', async () => {
      const funcionariaId = salvarFerias.dataset.salvarFerias;
      const inicio = document.getElementById('feriasInicio').value;
      const fim = document.getElementById('feriasFim').value;
      const diasVendidos = Number(document.getElementById('feriasDiasVendidos').value) || 0;
      const mesReferenciaPagamento = document.getElementById('feriasMesPagamento').value || null;
      if (!inicio || !fim) { alert('Preencha início e fim do recesso.'); return; }
      if (fim < inicio) { alert('A data de fim precisa ser depois da data de início.'); return; }
      await addFeriasTirada(funcionariaId, inicio, fim, diasVendidos, mesReferenciaPagamento);
      state.showFeriasForm = false;
      await loadData();
    });

    document.querySelectorAll('[data-editar-ferias]').forEach((row) => {
      row.addEventListener('click', () => { state.editandoFeriasId = row.dataset.editarFerias; render(); });
    });
    document.querySelectorAll('[data-cancelar-edit-ferias]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editandoFeriasId = null; render(); });
    });
    document.querySelectorAll('[data-salvar-edit-ferias]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.salvarEditFerias;
        const inicio = document.getElementById(`editFeriasInicio-${id}`).value;
        const fim = document.getElementById(`editFeriasFim-${id}`).value;
        const diasVendidos = Number(document.getElementById(`editFeriasDiasVendidos-${id}`).value) || 0;
        const mesReferenciaPagamento = document.getElementById(`editFeriasMesPagamento-${id}`).value || null;
        if (!inicio || !fim) { alert('Preencha início e fim do recesso.'); return; }
        if (fim < inicio) { alert('A data de fim precisa ser depois da data de início.'); return; }
        await updateFeriasTirada(id, inicio, fim, diasVendidos, mesReferenciaPagamento);
        state.editandoFeriasId = null;
        await loadData();
      });
    });

    document.querySelectorAll('[data-remover-ferias]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Remover esse registro de recesso? O ciclo volta a contar a partir do registro anterior (ou da admissão).')) {
          await removeFeriasTirada(btn.dataset.removerFerias);
          await loadData();
        }
      });
    });

    const filtroInicio = document.getElementById('rhFiltroInicio');
    if (filtroInicio) filtroInicio.addEventListener('change', (e) => { state.rhFiltroInicio = e.target.value || null; salvarRhFiltro(state.rhFiltroInicio, state.rhFiltroFim); render(); });
    const filtroFim = document.getElementById('rhFiltroFim');
    if (filtroFim) filtroFim.addEventListener('change', (e) => { state.rhFiltroFim = e.target.value || null; salvarRhFiltro(state.rhFiltroInicio, state.rhFiltroFim); render(); });

    const estaSemana = document.getElementById('rhEstaSemana');
    if (estaSemana) estaSemana.addEventListener('click', () => { state.rhFiltroInicio = inicioDaSemana(todayStr()); state.rhFiltroFim = todayStr(); salvarRhFiltro(state.rhFiltroInicio, state.rhFiltroFim); render(); });
    const esteMes = document.getElementById('rhEsteMes');
    if (esteMes) esteMes.addEventListener('click', () => { state.rhFiltroInicio = todayStr().slice(0, 8) + '01'; state.rhFiltroFim = todayStr(); salvarRhFiltro(state.rhFiltroInicio, state.rhFiltroFim); render(); });

    const ptManualLimparAlmoco = document.getElementById('ptManualLimparAlmoco');
    if (ptManualLimparAlmoco) ptManualLimparAlmoco.addEventListener('click', () => {
      const saidaAlmocoInput = document.getElementById('ptManual-saida_almoco');
      const voltaAlmocoInput = document.getElementById('ptManual-volta_almoco');
      if (saidaAlmocoInput) saidaAlmocoInput.value = '';
      if (voltaAlmocoInput) voltaAlmocoInput.value = '';
    });

    document.querySelectorAll('[data-lancar-ponto-unico]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tipo = btn.dataset.lancarPontoUnico;
        const funcionariaId = btn.dataset.funcionaria;
        const data = document.getElementById('ptManualData').value;
        if (!data) { alert('Preencha a data.'); return; }
        const hora = document.getElementById(`ptManual-${tipo}`)?.value;
        if (!hora) { alert(`Preencha o horário de "${LABEL_PONTO[tipo]}" antes de lançar.`); return; }
        const { error } = await sb.from('pontos').insert({
          funcionaria_id: funcionariaId, data, tipo, horario: new Date(`${data}T${hora}:00`).toISOString(), origem: 'manual',
        });
        if (error) { alert('Erro ao lançar ponto: ' + error.message); return; }
        const inicioAtual = state.rhFiltroInicio || todayStr().slice(0, 8) + '01';
        const fimAtual = state.rhFiltroFim || todayStr();
        if (data < inicioAtual) state.rhFiltroInicio = data;
        if (data > fimAtual) state.rhFiltroFim = data;
        salvarRhFiltro(state.rhFiltroInicio, state.rhFiltroFim);
        await loadData();
        alert(`${LABEL_PONTO[tipo]} lançada em ${new Date(data + 'T00:00:00').toLocaleDateString('pt-BR')} às ${hora}. Os outros horários não foram tocados.`);
      });
    });

    const lancarManual = document.querySelector('[data-lancar-ponto-manual]');
    if (lancarManual) lancarManual.addEventListener('click', async () => {
      const funcionariaId = lancarManual.dataset.lancarPontoManual;
      const data = document.getElementById('ptManualData').value;
      if (!data) { alert('Preencha a data.'); return; }
      const linhas = ORDEM_PONTOS
        .map((t) => ({ tipo: t, hora: document.getElementById(`ptManual-${t}`)?.value }))
        .filter((l) => l.hora);
      if (linhas.length === 0) { alert('Preencha pelo menos um horário.'); return; }
      const rows = linhas.map((l) => ({
        funcionaria_id: funcionariaId, data, tipo: l.tipo, horario: new Date(`${data}T${l.hora}:00`).toISOString(), origem: 'manual',
      }));
      const { error } = await sb.from('pontos').insert(rows);
      if (error) { alert('Erro ao lançar ponto: ' + error.message); return; }
      // se a data lançada cair fora do período visível na tela, expande o filtro pra
      // incluir ela — senão a batida salva certinho mas some da lista, parecendo que falhou
      const inicioAtual = state.rhFiltroInicio || todayStr().slice(0, 8) + '01';
      const fimAtual = state.rhFiltroFim || todayStr();
      if (data < inicioAtual) state.rhFiltroInicio = data;
      if (data > fimAtual) state.rhFiltroFim = data;
      salvarRhFiltro(state.rhFiltroInicio, state.rhFiltroFim);
      await loadData();
      alert(`${linhas.length} batida(s) lançada(s) em ${new Date(data + 'T00:00:00').toLocaleDateString('pt-BR')}: ${linhas.map((l) => LABEL_PONTO[l.tipo]).join(', ')}.`);
    });

    document.querySelectorAll('[data-editar-ponto]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editingPontoId = btn.dataset.editarPonto; render(); });
    });
    document.querySelectorAll('[data-cancelar-edit-ponto]').forEach((btn) => {
      btn.addEventListener('click', () => { state.editingPontoId = null; render(); });
    });
    document.querySelectorAll('[data-salvar-edit-ponto]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.salvarEditPonto;
        const dia = btn.dataset.data;
        const hora = document.getElementById(`editPontoHora-${id}`).value;
        const horarioISO = new Date(`${dia}T${hora}:00`).toISOString();
        await updatePonto(id, horarioISO);
        state.editingPontoId = null;
        await loadData();
      });
    });
    document.querySelectorAll('[data-remover-ponto]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover essa batida de ponto?')) {
          await removePonto(btn.dataset.removerPonto);
          await loadData();
        }
      });
    });
    return;
  }

  const toggleHoleritesLote = document.getElementById('toggleHoleritesLote');
  if (toggleHoleritesLote) toggleHoleritesLote.addEventListener('click', () => { state.showHoleritesLote = !state.showHoleritesLote; render(); });

  const toggleEmpresaConfigForm = document.getElementById('toggleEmpresaConfigForm');
  if (toggleEmpresaConfigForm) toggleEmpresaConfigForm.addEventListener('click', () => { state.showEmpresaConfigForm = !state.showEmpresaConfigForm; render(); });
  const salvarEmpresaConfigBtn = document.getElementById('salvarEmpresaConfig');
  if (salvarEmpresaConfigBtn) salvarEmpresaConfigBtn.addEventListener('click', async () => {
    const razaoSocial = document.getElementById('empresaRazaoSocial').value.trim();
    const nomeFantasia = document.getElementById('empresaNomeFantasia').value.trim();
    const cnpj = document.getElementById('empresaCnpj').value.trim();
    const endereco = document.getElementById('empresaEndereco').value.trim();
    const telefone = document.getElementById('empresaTelefone').value.trim();
    await salvarEmpresaConfig({ cnpj, razaoSocial, nomeFantasia, endereco, telefone });
    state.showEmpresaConfigForm = false;
    await loadData();
  });

  const toggleEmailConfigForm = document.getElementById('toggleEmailConfigForm');
  if (toggleEmailConfigForm) toggleEmailConfigForm.addEventListener('click', () => { state.showEmailConfigForm = !state.showEmailConfigForm; render(); });
  const salvarEmailConfigBtn = document.getElementById('salvarEmailConfig');
  if (salvarEmailConfigBtn) salvarEmailConfigBtn.addEventListener('click', async () => {
    const serviceId = document.getElementById('empresaEmailjsServiceId').value.trim();
    const templateId = document.getElementById('empresaEmailjsTemplateId').value.trim();
    const publicKey = document.getElementById('empresaEmailjsPublicKey').value.trim();
    await salvarConfigEmailJS(serviceId, templateId, publicKey);
    state.showEmailConfigForm = false;
    await loadData();
  });

  const toggleFeriadosForm = document.getElementById('toggleFeriadosForm');
  if (toggleFeriadosForm) toggleFeriadosForm.addEventListener('click', () => { state.showFeriadosForm = !state.showFeriadosForm; render(); });
  const salvarFeriado = document.getElementById('salvarFeriado');
  if (salvarFeriado) salvarFeriado.addEventListener('click', async () => {
    const data = document.getElementById('novoFeriadoData').value;
    const nome = document.getElementById('novoFeriadoNome').value.trim();
    if (!data) { alert('Escolha a data do feriado.'); return; }
    await addFeriado(data, nome);
    await loadData();
  });
  document.querySelectorAll('[data-remover-feriado]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover esse feriado?')) {
        await removeFeriado(btn.dataset.removerFeriado);
        await loadData();
      }
    });
  });

  const holeriteLoteMesSelect = document.getElementById('holeriteLoteMesSelect');
  if (holeriteLoteMesSelect) holeriteLoteMesSelect.addEventListener('change', (e) => { state.holeriteMes = e.target.value; render(); });

  const dataPagamentoPadrao = (mesKey) => {
    const [anoP, mesP] = mesKey.split('-').map(Number);
    const ultimoDiaP = new Date(anoP, mesP, 0).getDate();
    const hojeReal = todayStr();
    const candidato = `${mesKey}-${String(ultimoDiaP).padStart(2, '0')}`;
    return candidato <= hojeReal ? candidato : hojeReal;
  };

  document.querySelectorAll('[data-fechar-holerite-lote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const funcionaria = state.funcionarias.find((f) => f.id === btn.dataset.fecharHoleriteLote);
      const mesKey = btn.dataset.mes;
      const resumo = calcularResumoHolerite(funcionaria, mesKey);
      const modoHorasExtras = funcionaria.modoCompensacaoPadrao;
      await fecharHolerite(funcionaria, mesKey, resumo, modoHorasExtras, resumo.valorVt, resumo.valorVr, dataPagamentoPadrao(mesKey));
      await loadData();
    });
  });

  const fecharTodosBtn = document.querySelector('[data-fechar-todos-holerites]');
  if (fecharTodosBtn) fecharTodosBtn.addEventListener('click', async () => {
    const mesKey = fecharTodosBtn.dataset.fecharTodosHolerites;
    const ativas = state.funcionarias.filter((f) => f.ativa !== false && !state.holerites.some((h) => h.funcionariaId === f.id && h.mes === mesKey));
    if (!confirm(`Fechar o holerite de ${ativas.length} funcionária(s) pra ${new Date(mesKey + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}?\n\nCada uma usa o modo de pagamento de hora extra padrão dela. Isso lança as saídas no Financeiro.`)) return;
    const dataPagamento = dataPagamentoPadrao(mesKey);
    for (const f of ativas) {
      const resumo = calcularResumoHolerite(f, mesKey);
      await fecharHolerite(f, mesKey, resumo, f.modoCompensacaoPadrao, resumo.valorVt, resumo.valorVr, dataPagamento);
    }
    await loadData();
    alert(`${ativas.length} holerite(s) fechado(s)!`);
  });

  const toggleForm = document.getElementById('toggleFuncionariaForm');
  if (toggleForm) toggleForm.addEventListener('click', () => { state.showFuncionariaForm = !state.showFuncionariaForm; render(); });

  const salvarFuncionaria = document.getElementById('salvarFuncionaria');
  if (salvarFuncionaria) salvarFuncionaria.addEventListener('click', async () => {
    const nome = document.getElementById('funcNome').value.trim();
    const pin = document.getElementById('funcPin').value.trim();
    if (!nome || !pin) { alert('Informe o nome e o PIN.'); return; }
    if (state.funcionarias.some((f) => f.pin === pin)) { alert('Esse PIN já está em uso por outra funcionária. Escolha um diferente.'); return; }
    const dataAdmissao = document.getElementById('funcAdmissao').value || null;
    const jornadaSemanal = coletarJornadaSemanal('func');
    const segunda = jornadaSemanal[1]?.trabalha ? jornadaSemanal[1] : { entrada: '08:00', saidaAlmoco: '12:00', voltaAlmoco: '13:00', saida: '17:00' };
    await addFuncionaria({
      nome, pin, dataAdmissao, jornadaSemanal,
      jornadaEntrada: segunda.entrada, jornadaSaidaAlmoco: segunda.saidaAlmoco, jornadaVoltaAlmoco: segunda.voltaAlmoco, jornadaSaida: segunda.saida,
    });
    state.showFuncionariaForm = false;
    await loadData();
  });

  document.querySelectorAll('[data-abrir-funcionaria]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-editar-func]') || e.target.closest('[data-remover-func]')) return;
      state.rhFuncionariaDetalheId = row.dataset.abrirFuncionaria;
      state.showPreviaHolerite = false;
      window.__previaHoleriteData = null;
      state.holeriteDataPagamento = null;
      render();
    });
  });

  document.querySelectorAll('[data-editar-func]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); state.editingFuncionariaId = btn.dataset.editarFunc; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-func]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingFuncionariaId = null; render(); });
  });
  document.querySelectorAll('[data-edit-func-tipo-pag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__editFuncTipoPag = window.__editFuncTipoPag || {};
      window.__editFuncTipoPag[btn.dataset.editFuncTipoPag] = btn.dataset.valor;
      render();
    });
  });
  document.querySelectorAll('[data-edit-func-modo-comp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__editFuncModoComp = window.__editFuncModoComp || {};
      window.__editFuncModoComp[btn.dataset.editFuncModoComp] = btn.dataset.valor;
      render();
    });
  });

  document.querySelectorAll('[data-calcular-valor-hora]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.calcularValorHora;
      const salarioMensal = parseBRNumber(document.getElementById(`editFuncSalarioMensal-${id}`)?.value || '0');
      if (!salarioMensal) { alert('Preencha o salário mensal primeiro.'); return; }
      const jornadaSemanal = coletarJornadaSemanal(`editFunc${id}`);
      let minutosSemanais = 0;
      Object.values(jornadaSemanal).forEach((dia) => {
        if (!dia.trabalha) return;
        const [hE, mE] = dia.entrada.split(':').map(Number);
        const [hSA, mSA] = dia.saidaAlmoco.split(':').map(Number);
        const [hVA, mVA] = dia.voltaAlmoco.split(':').map(Number);
        const [hS, mS] = dia.saida.split(':').map(Number);
        minutosSemanais += ((hSA * 60 + mSA) - (hE * 60 + mE)) + ((hS * 60 + mS) - (hVA * 60 + mVA));
      });
      const horasSemanaisJornada = minutosSemanais / 60;
      const horasCompensacaoSemanal = parseBRNumber(document.getElementById(`editFuncCompSabado-${id}`)?.value || '0');
      const horasSemanais = horasSemanaisJornada + horasCompensacaoSemanal;
      if (horasSemanais <= 0) { alert('Configure a jornada semanal primeiro (marque os dias que ela trabalha).'); return; }
      // divisor padrão de folha de pagamento: jornada semanal × 5 (ex: 44h/semana → 220h/mês,
      // 40h/semana → 200h/mês, 36h/semana → 180h/mês) — é o divisor usado na prática pela
      // maioria dos sistemas de RH no Brasil. A jornada semanal aqui já soma o campo de
      // "compensação de sábado" — se a jornada configurada é só seg-sex (ex: 40h) e o sábado
      // fica de fora dela (compensado à parte), essas horas do sábado ainda contam na jornada
      // contratual total, e precisam entrar nessa conta pra não subestimar o valor da hora
      const horasMensais = horasSemanais * 5;
      const valorHora = salarioMensal / horasMensais;
      document.getElementById(`editFuncValorHora-${id}`).value = valorHora.toFixed(2).replace('.', ',');
      const detalheCompensacao = horasCompensacaoSemanal > 0 ? ` (${horasSemanaisJornada.toFixed(1)}h da jornada + ${horasCompensacaoSemanal}h de compensação de sábado)` : '';
      alert(`Calculado: ${horasSemanais.toFixed(1)}h/semana${detalheCompensacao} × 5 = ${horasMensais.toFixed(1)}h/mês (divisor padrão).\n\nValor da hora: ${fmt(valorHora)}`);
    });
  });

  document.querySelectorAll('[data-salvar-edit-func]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditFunc;
      const original = state.funcionarias.find((f) => f.id === id);
      const nome = document.getElementById(`editFuncNome-${id}`).value.trim();
      const pin = document.getElementById(`editFuncPin-${id}`).value.trim();
      if (!nome || !pin) { alert('Informe o nome e o PIN.'); return; }
      if (state.funcionarias.some((f) => f.pin === pin && f.id !== id)) { alert('Esse PIN já está em uso por outra funcionária.'); return; }
      const dataAdmissao = document.getElementById(`editFuncAdmissao-${id}`).value || null;
      const ativa = document.getElementById(`editFuncAtiva-${id}`).checked;
      const jornadaSemanal = coletarJornadaSemanal(`editFunc${id}`);
      const segunda = jornadaSemanal[1]?.trabalha ? jornadaSemanal[1] : { entrada: '08:00', saidaAlmoco: '12:00', voltaAlmoco: '13:00', saida: '17:00' };
      const tipoPagamento = window.__editFuncTipoPag?.[id] || original.tipoPagamento;
      const salarioMensal = parseBRNumber(document.getElementById(`editFuncSalarioMensal-${id}`)?.value || '0');
      const valorHora = parseBRNumber(document.getElementById(`editFuncValorHora-${id}`).value);
      const percentualHoraExtra = Number(document.getElementById(`editFuncPercentualExtra-${id}`).value) || 0;
      const modoCompensacaoPadrao = window.__editFuncModoComp?.[id] || original.modoCompensacaoPadrao;
      const valorVtDia = parseBRNumber(document.getElementById(`editFuncVtDia-${id}`).value);
      const valorVrDia = parseBRNumber(document.getElementById(`editFuncVrDia-${id}`).value);
      const horasCompensacaoSemanal = parseBRNumber(document.getElementById(`editFuncCompSabado-${id}`)?.value || '0');
      const cpf = document.getElementById(`editFuncCpf-${id}`).value.trim();
      const cargo = document.getElementById(`editFuncCargo-${id}`).value.trim();
      const matricula = document.getElementById(`editFuncMatricula-${id}`).value.trim();
      const email = document.getElementById(`editFuncEmail-${id}`).value.trim();
      await updateFuncionaria(id, {
        nome, pin, dataAdmissao, ativa, jornadaSemanal,
        jornadaEntrada: segunda.entrada, jornadaSaidaAlmoco: segunda.saidaAlmoco, jornadaVoltaAlmoco: segunda.voltaAlmoco, jornadaSaida: segunda.saida,
        tipoPagamento, salarioMensal, valorHora, percentualHoraExtra, modoCompensacaoPadrao, valorVtDia, valorVrDia, horasCompensacaoSemanal,
        cpf, cargo, matricula, email,
      });
      state.editingFuncionariaId = null;
      if (window.__editFuncTipoPag) delete window.__editFuncTipoPag[id];
      if (window.__editFuncModoComp) delete window.__editFuncModoComp[id];
      await loadData();
    });
  });
  document.querySelectorAll('[data-remover-func]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Remover essa funcionária? O histórico de ponto dela também será apagado.')) {
        await removeFuncionaria(btn.dataset.removerFunc);
        await loadData();
      }
    });
  });
}

function renderDRE(c) {
  const txMes = c.txMes;
  const receitaBruta = txMes.filter((t) => t.tipo === 'entrada' && !CATEGORIAS_ENTRADA_NAO_OPERACIONAL.includes(t.categoria)).reduce((a, t) => a + t.valor, 0);
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
  const receitaPorCategoria = porCategoria((t) => t.tipo === 'entrada' && !CATEGORIAS_ENTRADA_NAO_OPERACIONAL.includes(t.categoria));
  const naoOperacionalPorCategoria = porCategoria((t) => t.tipo === 'entrada' && CATEGORIAS_ENTRADA_NAO_OPERACIONAL.includes(t.categoria));
  const totalNaoOperacional = naoOperacionalPorCategoria.reduce((a, [, v]) => a + v, 0);
  const variavelPorCategoria = porCategoria((t) => t.tipo === 'saida' && t.natureza === 'variavel' && t.categoria !== 'Taxas de marketplace');
  const fixoPorCategoria = porCategoria((t) => t.tipo === 'saida' && t.natureza === 'fixo');

  const linhaSub = (nome, val) => `<tr class="dre-tr-sub"><td>${esc(nome)}</td><td class="dre-td-num">${fmt(val)}</td></tr>`;
  const subLinhas = (itens) => itens.map(([nome, val]) => linhaSub(nome, val)).join('');

  const vazio = receitaBruta === 0 && custosFixos === 0 && custosVariaveis === 0;

  return `
    ${renderSeletorPeriodo('dre')}

    ${vazio ? `<div class="empty-state">Sem lançamentos nesse período ainda pra montar o DRE.</div>` : `
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
    ${totalNaoOperacional > 0 ? `
      <div class="form-hint" style="margin-top:16px">💡 Entradas não operacionais neste mês (não contam como venda — algumas são dinheiro de verdade, tipo empréstimo, outras são só informativas, tipo crédito grátis de anúncio, que nunca é dinheiro na conta): <strong style="color:var(--text)">${fmt(totalNaoOperacional)}</strong> — ${naoOperacionalPorCategoria.map(([nome, val]) => `${esc(nome)}: ${fmt(val)}`).join(', ')}</div>
    ` : ''}
    `}
  `;
}

// ---- Estoque ----
function renderEstoque(c) {
  // busca por nome/SKU + ordenação (não altera c.produtosStatus original)
  const foraDeLinhaCount = c.produtosStatus.filter((p) => p.ativo === false).length;
  let listaProdutos = state.estoqueMostrarForaLinha ? c.produtosStatus : c.produtosStatus.filter((p) => p.ativo !== false);
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
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${renderControleColunas('estoque')}
        <button class="icon-btn-ghost" id="toggleForaDeLinha" style="${state.estoqueMostrarForaLinha ? 'background:rgba(154,156,168,0.2);color:var(--text)' : ''}">🚫 Fora de linha${foraDeLinhaCount > 0 ? ` (${foraDeLinhaCount})` : ''}</button>
        <button class="icon-btn-ghost" id="toggleProdutosParados">⏸️ Parados${c.produtosParados.length > 0 ? ` (${c.produtosParados.length})` : ''}</button>
        <button class="icon-btn-ghost" id="toggleProdutosSemCor" style="${c.produtosSemCor.length > 0 ? 'background:rgba(255,182,39,0.15);border:1.5px solid var(--amber);color:var(--amber);font-weight:700' : ''}">🎨 Sem cor cadastrada${c.produtosSemCor.length > 0 ? ` (${c.produtosSemCor.length})` : ''}</button>
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
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <div class="section-title" style="margin-bottom:2px">Produtos parados</div>
            <div class="section-subtitle" style="margin-bottom:12px">Sem vender há 30 dias ou mais</div>
          </div>
          ${renderControleColunas('produtosParados')}
        </div>
        ${c.produtosParados.length === 0 ? `<div class="empty-state">Nenhum produto parado no momento 🎉</div>` : `
          <div style="display:grid;grid-template-columns:${gridColumnsStyle('produtosParados', 240)};gap:8px">
            ${c.produtosParados.map((p) => `
              <div class="alert-card" style="border-color:var(--amber)55">
                <div class="alert-card-row">
                  <div class="alert-dot" style="background:var(--amber)"></div>
                  <div style="flex:1">
                    <div class="alert-name">${esc(p.nome)}</div>
                    <div class="alert-status" style="color:var(--amber)">${p.diasSemVender === null ? '⏸️ Nunca vendeu' : `⏸️ ${p.diasSemVender} dias sem vender`}</div>
                    <div class="alert-meta">Estoque: ${p.estoqueAtual} un · ${fmt(p.custoTotalUnitario)}/un parado</div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    ` : ''}

    ${state.showProdutosSemCor ? `
      <div class="form-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <div class="section-title" style="margin-bottom:2px">Produtos sem cor cadastrada</div>
            <div class="section-subtitle" style="margin-bottom:12px">Se algum desses tem cor de verdade, adiciona a(s) variante(s) — senão, todo vínculo de SKU vai cair no estoque geral, sem separar por cor</div>
          </div>
        </div>
        ${c.produtosSemCor.length === 0 ? `<div class="empty-state">Todo produto ativo (que não é kit) já tem cor cadastrada 🎉</div>` : `
          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(240px, 1fr));gap:8px">
            ${c.produtosSemCor.map((p) => `
              <div class="alert-card" style="border-color:var(--amber)55">
                <div class="alert-card-row">
                  <div class="alert-dot" style="background:var(--amber)"></div>
                  <div style="flex:1">
                    <div class="alert-name">${esc(p.nome)}</div>
                    <div class="alert-meta">${p.sku ? esc(fmtSkuExibicao(p.sku)) : 'sem SKU'} · estoque: ${p.estoqueAtual} un</div>
                  </div>
                  <button class="entrada-btn" data-editar-sem-cor="${p.id}" data-nome-produto="${esc(p.nome)}">＋ Cor</button>
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
        <label class="checkbox-label"><input type="checkbox" id="pCustoEstimado" /> ≈ Esse é um custo estimado (não sei o valor real do tecido/corte ainda)</label>
        <input type="text" id="pMaoObra" placeholder="Valor de mão de obra por peça (ex: 5,00)" />
        <div class="form-hint" style="margin-top:-4px">Esse valor é o mesmo usado na aba Produção pra pagar a costureira — dá pra ajustar aqui ou lá, os dois ficam sincronizados.</div>

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
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('estoque', 260)};gap:10px">
        ${listaProdutos.map((p) => {
          const statusColor = { critico: 'var(--red)', aguarde: 'var(--amber)', 'pode-cortar': 'var(--teal)', ok: 'var(--border)' }[p.status];
          const entradaOpen = state.entradaOpenId === p.id;

          if (state.editingProdutoId === p.id) {
            return `
              <div class="form-card" style="grid-column:1 / -1">
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
                <div class="form-hint" style="margin-top:6px;margin-bottom:2px">Custo e mão de obra agora se editam só na Ficha Técnica (lá já mostra o custo total certinho, com insumos):</div>
                <div class="produto-meta" style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px">
                  🧵 ${p.custoEstimado ? '≈ ' : ''}${fmt(p.custoUnitario)} tecido/corte${p.custoEstimado ? ' (estimado)' : ''} · ✂️ ${fmt(p.valorMaoObra || 0)} mão de obra
                </div>
                <button class="entrada-btn" type="button" data-ir-para-ficha="${p.id}" style="margin-top:6px">✏️ Editar custo na Ficha Técnica</button>
                <div class="form-hint" style="margin-top:10px;margin-bottom:2px">🎁 Esse produto desconta estoque de OUTROS produtos quando vendido? (ex: "Kit 2 Top Joy" desconta 2x Top Joy do estoque, não guarda estoque próprio)</div>
                <label class="checkbox-label"><input type="checkbox" id="editPEhKit-${p.id}" ${(window.__editProdutoEhKit?.[p.id] ?? p.ehKit) ? 'checked' : ''} data-toggle-eh-kit="${p.id}" /> Sim, é um kit — descontar dos componentes abaixo</label>
                ${(window.__editProdutoEhKit?.[p.id] ?? p.ehKit) ? (() => {
                  const componentesExistentes = state.kitComponentes.filter((k) => k.produtoKitId === p.id);
                  return Array.from({ length: 4 }, (_, i) => {
                    const comp = componentesExistentes[i];
                    const valorAtual = comp ? `${comp.componenteProdutoId}|${comp.componenteVarianteId || ''}` : '';
                    return `
                      <div class="form-row" style="margin-top:4px">
                        <select id="editKitComp-${p.id}-${i}">
                          <option value="">Componente (opcional)</option>
                          ${state.produtos.filter((prod) => prod.id !== p.id && !prod.ehKit).map((prod) => {
                            const vs = variantesDoProduto(prod.id);
                            if (vs.length > 0) {
                              return vs.map((v) => `<option value="${prod.id}|${v.id}" ${valorAtual === `${prod.id}|${v.id}` ? 'selected' : ''}>${esc(prod.nome)} — ${esc(v.nome)}</option>`).join('');
                            }
                            return `<option value="${prod.id}|" ${valorAtual === `${prod.id}|` ? 'selected' : ''}>${esc(prod.nome)}</option>`;
                          }).join('')}
                        </select>
                        <input type="text" id="editKitCompQtd-${p.id}-${i}" placeholder="Qtd" value="${comp ? comp.quantidade : ''}" style="max-width:70px" inputmode="numeric" />
                      </div>
                    `;
                  }).join('');
                })() : ''}
                <div class="form-row" style="margin-top:10px">
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
            <div class="produto-card" style="border-color:${statusColor}55${(showVarForm || entradaOpen) ? ';grid-column:1 / -1' : ''};${p.ativo === false ? 'opacity:0.6' : ''}">
              <div class="produto-header">
                <div>
                  <div class="produto-nome">${esc(p.nome)}${p.ativo === false ? ' <span style="font-size:10px;font-weight:600;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;padding:1px 5px;vertical-align:middle">FORA DE LINHA</span>' : ''}</div>
                  ${p.sku ? `<div class="produto-sku">${esc(fmtSkuExibicao(p.sku))}</div>` : ''}
                </div>
                <div style="display:flex;gap:2px">
                  <button class="trash-btn" data-toggle-ativo="${p.id}" data-ativo="${p.ativo !== false}" title="${p.ativo === false ? 'Reativar' : 'Tirar de linha'}">${p.ativo === false ? '✅' : '🚫'}</button>
                  <button class="trash-btn" data-edit-produto="${p.id}">✏️</button>
                  <button class="trash-btn" data-remove-produto="${p.id}">🗑</button>
                </div>
              </div>

              ${temVariantes ? `
                <div class="variantes-box">
                  ${vs.map((v) => `
                    <div class="variante-row">
                      <span class="variante-nome">${esc(v.nome)}</span>
                      <input type="text" class="variante-sku-input" value="${esc(v.skuVariante || '')}" data-var-sku-editar="${v.id}" placeholder="SKU da cor" style="width:110px;font-size:12px" />
                      <button class="step-btn" data-var-step="-1" data-variante="${v.id}" data-atual="${v.estoqueAtual}">-</button>
                      <input type="text" class="variante-qtd-input" inputmode="numeric" value="${v.estoqueAtual}" data-var-editar="${v.id}" data-atual="${v.estoqueAtual}" placeholder="ex: +63" style="width:52px;text-align:center;padding:6px 4px" />
                      <button class="step-btn" data-var-step="1" data-variante="${v.id}" data-atual="${v.estoqueAtual}">+</button>
                      <button class="trash-btn" data-remover-variante="${v.id}">🗑</button>
                    </div>
                  `).join('')}
                  <div class="produto-meta" style="margin-top:6px">Total: ${p.estoqueAtual} un · mín. ${p.estoqueMinimo} · ${p.custoEstimado ? '≈ ' : ''}${fmt(p.custoTotalUnitario)}/un${p.custoEstimado ? ' <span style="color:var(--amber)">(estimado)</span>' : ''}</div>
                </div>
              ` : `
                <div class="produto-stock-row">
                  <button class="step-btn" data-step="-1" data-produto="${p.id}" data-atual="${p.estoqueAtual}">-</button>
                  <input type="text" class="stock-value-input" inputmode="numeric" value="${p.estoqueAtual}" data-produto-editar="${p.id}" data-atual="${p.estoqueAtual}" placeholder="ex: +63" style="width:64px;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:600" />
                  <button class="step-btn" data-step="1" data-produto="${p.id}" data-atual="${p.estoqueAtual}">+</button>
                  <div class="produto-meta">mín. ${p.estoqueMinimo} · ${p.custoEstimado ? '≈ ' : ''}${fmt(p.custoTotalUnitario)}/un${p.custoEstimado ? ' <span style="color:var(--amber)">(estimado)</span>' : ''}</div>
                </div>
              `}

              ${(() => {
                if (p.custoUnitario >= 0.01) return '';
                const ultimo = ultimoCorteDoProduto(p.id);
                if (!ultimo) {
                  return `<div class="form-hint" style="color:var(--amber);margin-top:6px">⚠️ Sem custo de tecido/corte cadastrado, e nenhum corte encontrado pra esse produto. O lucro dele vai sair errado até você preencher "Custo por unidade" na edição.</div>`;
                }
                if (ultimo.apenasRetalho) {
                  return `<div class="form-hint" style="color:var(--amber);margin-top:6px">⚠️ Custo de tecido/corte zerado. Só encontrei corte de retalho pra esse produto — o custo dele não serve de referência (o tecido já tinha sido pago no corte principal). Preencha "Custo por unidade" manualmente na edição.</div>`;
                }
                return `
                  <div class="form-hint" style="color:var(--amber);margin-top:6px">⚠️ Custo de tecido/corte zerado. Último corte encontrado: ${fmt(ultimo.custoPorPeca)}/peça (${esc(ultimo.cor)}, ${new Date(ultimo.data + 'T00:00:00').toLocaleDateString('pt-BR')}).</div>
                  <button class="icon-btn-ghost" style="margin-top:4px" data-aplicar-ultimo-corte="${p.id}" data-valor="${ultimo.custoPorPeca.toFixed(2)}">💲 Aplicar ${fmt(ultimo.custoPorPeca)}/peça sem cortar de novo</button>
                `;
              })()}

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
    .filter((p) => p.status !== 'ok' && p.ativo !== false)
    .sort((a, b) => ({ critico: 0, aguarde: 1, 'pode-cortar': 2 }[a.status] - { critico: 0, aguarde: 1, 'pode-cortar': 2 }[b.status]));

  // insumos zerados ou abaixo do mínimo cadastrado (bojo, etiqueta, elástico...) — alerta
  // separado do semáforo de produtos, porque insumo não depende de "ter saldo pra repor
  // tecido", é só "acabou ou tá acabando, compra de novo"
  const insumosZerados = state.insumos.filter((i) => i.quantidadeMinima > 0 && i.quantidadeDisponivel <= 0);
  const insumosAbaixoMinimo = state.insumos.filter((i) => i.quantidadeMinima > 0 && i.quantidadeDisponivel > 0 && i.quantidadeDisponivel <= i.quantidadeMinima);

  // lembrete de holerite: aparece nos últimos 3 dias do mês se tiver funcionária ativa
  // ainda sem holerite fechado nesse mês
  const hoje = new Date();
  const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const mesAtualKey = todayStr().slice(0, 7);
  const funcionariasSemHolerite = state.funcionarias.filter((f) => f.ativa !== false && !state.holerites.some((h) => h.funcionariaId === f.id && h.mes === mesAtualKey));
  const lembreteHolerite = hoje.getDate() >= ultimoDiaMes - 2 && funcionariasSemHolerite.length > 0;

  return `
    ${renderSeletorPeriodo('dash')}

    ${insumosZerados.length > 0 ? `
      <div class="alerta-vencimento" data-ir-materiais="1" style="background:rgba(255,71,87,0.1);border-color:var(--red);color:var(--red)">
        <span>🔴 Insumo(s) ZERADO(S): ${insumosZerados.map((i) => esc(i.nome)).join(', ')}</span>
        <span class="alerta-vencimento-link">Ver em Materiais ›</span>
      </div>
    ` : ''}

    ${insumosAbaixoMinimo.length > 0 ? `
      <div class="alerta-vencimento" data-ir-materiais="1" style="background:rgba(255,182,39,0.1);border-color:var(--amber);color:var(--amber)">
        <span>🟡 Insumo(s) abaixo do mínimo: ${insumosAbaixoMinimo.map((i) => `${esc(i.nome)} (${i.quantidadeDisponivel} ${esc(i.unidade)})`).join(', ')}</span>
        <span class="alerta-vencimento-link">Ver em Materiais ›</span>
      </div>
    ` : ''}

    ${c.contasVencidasNaoConfirmadas.length > 0 ? `
      <div class="alerta-vencimento" data-ir-financeiro="1" style="background:rgba(255,71,87,0.1);border-color:var(--red);color:var(--red)">
        <span>🔴 ${c.contasVencidasNaoConfirmadas.length} conta(s) vencida(s) sem confirmação — ${fmt(c.contasVencidasNaoConfirmadas.reduce((a, t) => a + t.valor, 0))}</span>
        <span class="alerta-vencimento-link">Ver no Financeiro ›</span>
      </div>
    ` : ''}

    ${c.contasAVencer.length > 0 ? `
      <div class="alerta-vencimento" data-ir-financeiro="1">
        <span>📅 ${c.contasAVencer.length} conta(s) vencendo nos próximos 7 dias — ${fmt(c.contasAVencer.reduce((a, t) => a + t.valor, 0))}</span>
        <span class="alerta-vencimento-link">Ver no Financeiro ›</span>
      </div>
    ` : ''}

    ${lembreteHolerite ? `
      <div class="alerta-vencimento" data-ir-rh="1" style="background:rgba(255,182,39,0.1);border-color:var(--amber);color:var(--amber)">
        <span>📋 ${funcionariasSemHolerite.length} funcionária(s) sem holerite fechado esse mês — feche até o fim do mês</span>
        <span class="alerta-vencimento-link">Ver no RH ›</span>
      </div>
    ` : ''}

    <div class="stats-grid">
      <div class="stat-card" style="border-color:var(--teal)55;background:rgba(0,212,160,0.06)">
        <div class="stat-icon" style="background:rgba(0,212,160,0.15)">📈</div>
        <div class="stat-label">Entradas no período</div>
        <div class="stat-value" style="color:var(--teal)">${fmt(c.entradasMes)}</div>
      </div>
      <div class="stat-card" style="border-color:var(--pink)55;background:rgba(255,46,126,0.06)">
        <div class="stat-icon" style="background:rgba(255,46,126,0.15)">📉</div>
        <div class="stat-label">Saídas no período</div>
        <div class="stat-value" style="color:var(--pink)">${fmt(c.saidasMes)}</div>
      </div>
      <div class="stat-card" style="border-color:${c.saldoTotal >= 0 ? 'var(--teal)' : 'var(--red)'}55;background:${c.saldoTotal >= 0 ? 'rgba(0,212,160,0.06)' : 'rgba(255,71,87,0.06)'}">
        <div class="stat-icon" style="background:${c.saldoTotal >= 0 ? 'rgba(0,212,160,0.15)' : 'rgba(255,71,87,0.15)'}">💰</div>
        <div class="stat-label">Saldo total (desde o início)</div>
        <div class="stat-value" style="color:${c.saldoTotal >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(c.saldoTotal)}</div>
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
      ${renderControleColunas('semaforo')}
    </div>
    ${alertList.length === 0 ? `<div class="empty-state">Nenhum alerta no momento. Cadastre produtos na aba Estoque pra ativar o semáforo.</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('semaforo', 240)};gap:8px">
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
  document.querySelectorAll('[data-colunas-chave]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      salvarColunasConfig(sel.dataset.colunasChave, e.target.value);
      render();
    });
  });

  document.querySelectorAll('[data-toggle-parcelas]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const el = document.getElementById(cb.dataset.toggleParcelas);
      if (el) el.style.display = cb.checked ? '' : 'none';
    });
  });

  document.querySelectorAll('[data-toggle-parcelas-select]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const el = document.getElementById(sel.dataset.toggleParcelasSelect);
      if (el) el.style.display = sel.value ? '' : 'none';
    });
  });

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
      state.showContasAVencer = false;
      state.showEmprestimos = false;
      state.showEmprestimoForm = false;
      state.showCartoes = false;
      state.showCartaoForm = false;
      state.editingCartaoId = null;
      state.editingEmprestimoValorId = null;
      state.showCompraCartaoId = null;
      state.showProdutosParados = false;
      state.showCostureiraForm = false;
      state.editingCostureiraId = null;
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
      state.fichaTecnicaBusca = '';
      state.showFuncionariaForm = false;
      state.editingFuncionariaId = null;
      state.rhFuncionariaDetalheId = null;
      state.editingPontoId = null;
      state.showFeriasForm = false;
      state.showAbonarId = null;
      state.showHoleritesLote = false;
      state.showHistoricoBanco = false;
      state.showPagarSaldoBanco = false;
      state.showPreviaHolerite = false;
      state.showEmpresaConfigForm = false;
      render();
    });
  });

  if (state.tab === 'dashboard') {
    wireSeletorPeriodo('dash');

    document.querySelectorAll('[data-ir-financeiro]').forEach((el) => el.addEventListener('click', () => {
      state.tab = 'financeiro';
      state.showContasAVencer = true;
      render();
    }));
    document.querySelectorAll('[data-ir-rh]').forEach((el) => el.addEventListener('click', () => {
      state.tab = 'rh';
      render();
    }));
    document.querySelectorAll('[data-ir-materiais]').forEach((el) => el.addEventListener('click', () => {
      state.tab = 'tecido';
      render();
    }));
  }
  if (state.tab === 'financeiro') attachFinanceiroHandlers(c);
  if (state.tab === 'vendas') attachVendasHandlers(c);
  if (state.tab === 'estoque') attachEstoqueHandlers(c);
  if (state.tab === 'tecido' || state.tab === 'corte') attachTecidoHandlers(c);
  if (state.tab === 'producao') attachProducaoHandlers(c);
  if (state.tab === 'ficha') attachFichaTecnicaHandlers(c);
  if (state.tab === 'rh') attachRHHandlers(c);
  if (state.tab === 'dre') {
    wireSeletorPeriodo('dre');
  }
}

function attachFinanceiroHandlers(c) {
  const toggleEmprestimos = document.getElementById('toggleEmprestimos');
  if (toggleEmprestimos) toggleEmprestimos.addEventListener('click', () => { state.showEmprestimos = !state.showEmprestimos; render(); });

  const toggleCartoes = document.getElementById('toggleCartoes');
  if (toggleCartoes) toggleCartoes.addEventListener('click', () => { state.showCartoes = !state.showCartoes; render(); });

  const toggleCartaoForm = document.getElementById('toggleCartaoForm');
  if (toggleCartaoForm) toggleCartaoForm.addEventListener('click', () => { state.showCartaoForm = !state.showCartaoForm; render(); });

  const salvarCartao = document.getElementById('salvarCartao');
  if (salvarCartao) salvarCartao.addEventListener('click', async () => {
    const nome = document.getElementById('cartNome').value.trim();
    const limite = parseBRNumber(document.getElementById('cartLimite').value);
    const diaFechamento = Number(document.getElementById('cartFechamento').value);
    const diaVencimento = Number(document.getElementById('cartVencimento').value);
    if (!nome || !diaFechamento || diaFechamento < 1 || diaFechamento > 31 || !diaVencimento || diaVencimento < 1 || diaVencimento > 31) {
      alert('Preencha o nome e os dias de fechamento/vencimento (1 a 31).');
      return;
    }
    await addCartao({ nome, limite, diaFechamento, diaVencimento });
    state.showCartaoForm = false;
    await loadData();
  });

  document.querySelectorAll('[data-editar-cartao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingCartaoId = btn.dataset.editarCartao; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-cartao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingCartaoId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-cartao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditCartao;
      const nome = document.getElementById(`editCartNome-${id}`).value.trim();
      const limite = parseBRNumber(document.getElementById(`editCartLimite-${id}`).value);
      const diaFechamento = Number(document.getElementById(`editCartFechamento-${id}`).value);
      const diaVencimento = Number(document.getElementById(`editCartVencimento-${id}`).value);
      const ativo = document.getElementById(`editCartAtivo-${id}`).checked;
      if (!nome || !diaFechamento || !diaVencimento) { alert('Preencha nome e os dias de fechamento/vencimento.'); return; }
      await updateCartao(id, { nome, limite, diaFechamento, diaVencimento, ativo });
      state.editingCartaoId = null;
      await loadData();
    });
  });
  document.querySelectorAll('[data-remover-cartao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover esse cartão? As compras já lançadas continuam no Financeiro, só perdem o vínculo com o cartão.')) {
        await removeCartao(btn.dataset.removerCartao);
        await loadData();
      }
    });
  });

  const toggleEmprestimoForm = document.getElementById('toggleEmprestimoForm');
  if (toggleEmprestimoForm) toggleEmprestimoForm.addEventListener('click', () => { state.showEmprestimoForm = !state.showEmprestimoForm; render(); });

  const salvarEmprestimo = document.getElementById('salvarEmprestimo');
  if (salvarEmprestimo) salvarEmprestimo.addEventListener('click', async () => {
    const descricao = document.getElementById('empDescricao').value.trim();
    const instituicao = document.getElementById('empInstituicao').value.trim();
    const valorRecebido = parseBRNumber(document.getElementById('empValorRecebido').value);
    const dataRecebimento = document.getElementById('empDataRecebimento').value;
    const numeroParcelas = Number(document.getElementById('empNumParcelas').value);
    let valorParcela = parseBRNumber(document.getElementById('empValorParcela').value);
    const dataPrimeiraParcela = document.getElementById('empDataPrimeiraParcela').value;
    if (!descricao || !valorRecebido || !numeroParcelas || numeroParcelas <= 0 || !dataRecebimento || !dataPrimeiraParcela) {
      alert('Preencha descrição, valor recebido, número de parcelas e as datas.');
      return;
    }
    if (!valorParcela) valorParcela = Math.round((valorRecebido / numeroParcelas) * 100) / 100;
    await criarEmprestimo({ descricao, instituicao, valorRecebido, dataRecebimento, numeroParcelas, valorParcela, dataPrimeiraParcela });
    state.showEmprestimoForm = false;
    await loadData();
  });

  document.querySelectorAll('[data-remover-emprestimo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Remover esse empréstimo? Isso também apaga o lançamento de recebimento e todas as parcelas ainda não pagas do Financeiro.')) {
        await removeEmprestimo(btn.dataset.removerEmprestimo);
        await loadData();
      }
    });
  });

  document.querySelectorAll('[data-editar-valor-emprestimo]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingEmprestimoValorId = btn.dataset.editarValorEmprestimo; render(); });
  });
  document.querySelectorAll('[data-cancelar-valor-emprestimo]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingEmprestimoValorId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-valor-emprestimo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarValorEmprestimo;
      const novoValor = parseBRNumber(document.getElementById(`editEmpValorRecebido-${id}`).value);
      const novaData = document.getElementById(`editEmpDataRecebimento-${id}`).value;
      if (!novoValor || novoValor <= 0 || !novaData) { alert('Informe um valor e uma data válidos.'); return; }
      await updateEmprestimoValorRecebido(id, novoValor, novaData);
      state.editingEmprestimoValorId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-toggle-lancamentos-cartao]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleLancamentosCartao;
      state.showLancamentosCartaoId = state.showLancamentosCartaoId === id ? null : id;
      render();
    });
  });
  document.querySelectorAll('[data-abrir-compra-cartao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.showCompraCartaoId = btn.dataset.abrirCompraCartao; render(); });
  });
  document.querySelectorAll('[data-cancelar-compra-cartao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.showCompraCartaoId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-compra-cartao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cartaoId = btn.dataset.salvarCompraCartao;
      const cartao = state.cartoesCredito.find((cc) => cc.id === cartaoId);
      if (!cartao) return;
      const descricao = document.getElementById(`compCartDescricao-${cartaoId}`).value.trim();
      const categoria = document.getElementById(`compCartCategoria-${cartaoId}`).value;
      const valor = parseBRNumber(document.getElementById(`compCartValor-${cartaoId}`).value);
      const data = document.getElementById(`compCartData-${cartaoId}`).value || todayStr();
      const numParcelas = Number(document.getElementById(`compCartParcelas-${cartaoId}`).value) || 1;
      if (!descricao || !categoria || !valor) { alert('Preencha descrição, categoria e valor.'); return; }
      const natureza = NATUREZA_POR_CATEGORIA[categoria] || 'variavel';
      await criarSaidasCartao({ cartao, categoria, natureza, descricaoBase: descricao, valorTotal: valor, numParcelas, dataCompra: data });
      state.showCompraCartaoId = null;
      await loadData();
    });
  });

  wireSeletorPeriodo('fin');

  document.querySelectorAll('[data-filtro]').forEach((btn) => {
    btn.addEventListener('click', () => { state.filtroTipo = btn.dataset.filtro; render(); });
  });

  const exportBtn = document.getElementById('exportCsv');
  if (exportBtn) exportBtn.addEventListener('click', () => exportCSV(c.txMes, `${state.periodoInicio}_a_${state.periodoFim}`));

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

  const toggleContasAVencer = document.getElementById('toggleContasAVencer');
  if (toggleContasAVencer) toggleContasAVencer.addEventListener('click', () => { state.showContasAVencer = !state.showContasAVencer; render(); });

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
      const novasFaixas = [];
      for (let i = 0; i < 5; i++) {
        const ateStr = document.getElementById(`taxaFaixaAte-${p.id}-${i}`)?.value?.trim();
        const pctFaixa = parseBRNumber(document.getElementById(`taxaFaixaPct-${p.id}-${i}`)?.value || '0');
        const fixaFaixa = parseBRNumber(document.getElementById(`taxaFaixaFixa-${p.id}-${i}`)?.value || '0');
        if (pctFaixa > 0 || fixaFaixa > 0) {
          novasFaixas.push({ ate: ateStr ? parseBRNumber(ateStr) : null, pct: pctFaixa, fixa: fixaFaixa });
        }
      }
      const mudouTaxaSimples = novaPct !== p.taxaPercentual || novaFixa !== p.taxaFixa;
      const mudouFaixas = JSON.stringify(novasFaixas) !== JSON.stringify(p.taxaFaixas || []);
      if (mudouTaxaSimples || mudouFaixas) await updatePlataformaTaxa(p.id, novaPct, novaFixa, novasFaixas);
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

  const toggleTxForm = document.getElementById('toggleTxForm');
  if (toggleTxForm) toggleTxForm.addEventListener('click', () => { state.showTxForm = !state.showTxForm; render(); });

  document.querySelectorAll('[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => { window.__txFormTipo = btn.dataset.tipo; render(); });
  });

  const salvarTx = document.getElementById('salvarTx');
  if (salvarTx) salvarTx.addEventListener('click', async () => {
    const tipo = window.__txFormTipo || 'saida';
    const valor = parseBRNumber(document.getElementById('txValor').value);
    const categoria = document.getElementById('txCategoria').value;
    const descricao = document.getElementById('txDescricao').value;
    const data = document.getElementById('txData').value || todayStr();
    const recorrente = document.getElementById('txRecorrente')?.checked || false;
    const formaPagamento = tipo === 'saida' ? document.getElementById('txCartaoSelect')?.value : '';
    const cartao = (formaPagamento && formaPagamento !== '__parcelado_sem_cartao__') ? state.cartoesCredito.find((cc) => cc.id === formaPagamento) : null;
    const parceladoSemCartao = formaPagamento === '__parcelado_sem_cartao__';
    const numParcelas = (cartao || parceladoSemCartao) ? (Number(document.getElementById('txNumParcelas').value) || 1) : 1;
    if (!valor || !categoria) { alert('Preencha valor e categoria.'); return; }
    if (parceladoSemCartao && (!numParcelas || numParcelas <= 1)) { alert('Informe um número de parcelas maior que 1, ou escolha "Outro".'); return; }
    if (recorrente && CATEGORIAS_SEM_RECORRENTE_MANUAL.includes(categoria)) { alert(`"${categoria}" já é lançado automaticamente por outra parte do sistema (empréstimo ou holerite) — marcar "repetir todos os meses" nessa categoria duplica o lançamento. Deixa sem marcar.`); return; }
    const natureza = tipo === 'saida' ? (NATUREZA_POR_CATEGORIA[categoria] || 'variavel') : null;
    if (cartao) {
      await criarSaidasCartao({ cartao, categoria, natureza, descricaoBase: descricao || categoria, valorTotal: valor, numParcelas, dataCompra: data });
    } else if (parceladoSemCartao) {
      await criarSaidasParceladas({ categoria, natureza, descricaoBase: descricao || categoria, valorTotal: valor, numParcelas, dataPrimeiraParcela: data });
    } else {
      await addTx({ tipo, valor, categoria, natureza, descricao, data, recorrente });
    }
    await loadData();
    if (recorrente) { await garantirRecorrentes(); await loadData(); }
    state.showTxForm = false;
    window.__txFormTipo = 'saida';
    render();
  });

  attachTxRowHandlers();
}

// listeners de uma linha de lançamento (marcar pago, editar, cancelar, salvar edição,
// remover) — compartilhado entre a lista do Financeiro e a lista da aba Vendas, já que
// as duas usam renderTxRow pros mesmos tipos de botão
function attachTxRowHandlers() {
  document.querySelectorAll('[data-marcar-pago]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await marcarTxComoPago(btn.dataset.marcarPago);
      await loadData();
    });
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
      if (recorrente && CATEGORIAS_SEM_RECORRENTE_MANUAL.includes(categoria)) { alert(`"${categoria}" já é lançado automaticamente por outra parte do sistema (empréstimo ou holerite) — marcar "repetir todos os meses" nessa categoria duplica o lançamento. Deixa sem marcar.`); return; }
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

// ---- Vendas ----
const mesLabel = (mk) => {
  const label = new Date(mk + '-01T00:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  return label.replace('.', '').replace(/^\w/, (c) => c.toUpperCase());
};
function renderVendas(c) {
  const resumoDiarioMes = state.vendasResumoDiario.filter((r) => r.data && r.data >= state.periodoInicio && r.data <= state.periodoFim);
  const vendasMes = c.txMes.filter((t) => t.tipo === 'entrada' && t.categoria.startsWith('Venda'));
  const faturamentoMes = vendasMes.reduce((a, t) => a + t.valor, 0);
  const pedidosUnicosMes = new Set(vendasMes.filter((t) => t.idPedido).map((t) => t.idPedido.trim().toLowerCase()));
  const pedidosResumoMesTotal = resumoDiarioMes.reduce((a, r) => a + r.pedidos, 0);
  // "unidades" conta toda peça vendida (inclusive SKU pendente ainda não vinculado) — serve
  // pra comparar direto com o "Unidades Vendidas" que a Shopee/Upseller mostram, sem precisar
  // abrir a outra ferramenta pra conferir se bate
  // conta direto os lançamentos de venda (cada peça vendida = 1 lançamento), em vez de somar a
  // tabela de resumo diário — essa tabela pode ter ficado incompleta em dias antigos (mesma
  // falha silenciosa que achamos no dia 06/08), enquanto os lançamentos individuais são a fonte
  // mais confiável (é o que a gente já conferiu bater 100% com as planilhas)
  const unidadesResumoMesTotal = vendasMes.length;
  const qtdPedidosMes = pedidosUnicosMes.size > 0 ? pedidosUnicosMes.size : (pedidosResumoMesTotal || vendasMes.length);
  const ticketMedio = qtdPedidosMes > 0 ? faturamentoMes / qtdPedidosMes : 0;

  // comparação entre plataformas, no mês selecionado
  const porPlataforma = new Map();
  vendasMes.forEach((t) => {
    const nome = t.categoria.replace(/^Venda\s*/, '').trim() || 'Sem plataforma';
    const atual = porPlataforma.get(nome) || { faturamento: 0, pedidos: new Set(), linhas: 0 };
    atual.faturamento += t.valor;
    atual.linhas += 1;
    if (t.idPedido) atual.pedidos.add(t.idPedido.trim().toLowerCase());
    porPlataforma.set(nome, atual);
  });
  // pedidos reais (resumo diário, montado na importação a partir da coluna "Pedidos
  // Válidos" quando existe) — cobre 100% das vendas, vinculadas ou não a um produto, então
  // fica consistente com o faturamento (que também é de 100% das vendas)
  const pedidosRealPorPlataforma = new Map();
  resumoDiarioMes.forEach((r) => {
    const nome = (r.plataformaNome || 'Sem plataforma').trim();
    pedidosRealPorPlataforma.set(nome, (pedidosRealPorPlataforma.get(nome) || 0) + r.pedidos);
  });
  const comparacaoPlataformas = [...porPlataforma.entries()]
    .map(([nome, info]) => {
      const pedidos = info.pedidos.size > 0 ? info.pedidos.size : (pedidosRealPorPlataforma.get(nome) || info.linhas);
      return { nome, faturamento: info.faturamento, pedidos, ticketMedio: pedidos > 0 ? info.faturamento / pedidos : 0 };
    })
    .sort((a, b) => b.faturamento - a.faturamento);
  const maiorFaturamentoPlataforma = Math.max(1, ...comparacaoPlataformas.map((p) => p.faturamento));

  // ranking de produtos mais vendidos, no mês selecionado (usa vendas_detalhe, disponível a
  // partir do momento em que essa função entrou no ar — imports antigos não têm esse detalhe)
  const detalheMes = state.vendasDetalhe.filter((v) => v.data && v.data >= state.periodoInicio && v.data <= state.periodoFim);
  const porProduto = new Map();
  detalheMes.forEach((v) => {
    const produto = state.produtos.find((p) => p.id === v.produtoId);
    const nome = produto ? produto.nome : '(produto removido)';
    const custoUnit = produto ? calcularCustoTotalProduto(produto.id) : 0;
    const atual = porProduto.get(v.produtoId) || { nome, quantidade: 0, valor: 0, custo: 0, taxa: 0 };
    atual.quantidade += v.quantidade;
    atual.valor += v.valor;
    atual.custo += custoUnit * v.quantidade;
    atual.taxa += v.taxa || 0;
    porProduto.set(v.produtoId, atual);
  });
  // lucro líquido de verdade: venda - custo de produção (tecido, corte, mão de obra,
  // insumos) - taxa da plataforma. É esse número que diz se o preço de venda está bom
  const ordenarRankingPor = state.ordenarRankingPor || 'quantidade';
  const rankingProdutosBase = [...porProduto.values()].map((p) => ({ ...p, lucro: p.valor - p.custo - p.taxa, margem: p.valor > 0 ? ((p.valor - p.custo - p.taxa) / p.valor) * 100 : 0 }));
  const rankingProdutos = (ordenarRankingPor === 'margem'
    ? [...rankingProdutosBase].sort((a, b) => a.margem - b.margem) // pior margem primeiro — é o que precisa de atenção
    : [...rankingProdutosBase].sort((a, b) => b.quantidade - a.quantidade)
  ).slice(0, 30);
  const maiorQtdRanking = Math.max(1, ...rankingProdutos.map((p) => p.quantidade));
  const lucroMes = [...porProduto.values()].reduce((a, p) => a + (p.valor - p.custo - p.taxa), 0);
  const temDadosDeLucro = detalheMes.length > 0;
  const valorVinculadoMes = detalheMes.reduce((a, v) => a + v.valor, 0);
  const pctVinculadoMes = faturamentoMes > 0 ? (valorVinculadoMes / faturamentoMes) * 100 : 100;
  const faturamentoNaoVinculadoMes = Math.max(0, faturamentoMes - valorVinculadoMes);
  // painel de marketing (cupom, ads) — só o que já foi importado pelos relatórios de cupom/ads
  const descontoCupomMes = c.txMes.filter((t) => t.tipo === 'saida' && t.categoria === 'Desconto de cupom').reduce((a, t) => a + t.valor, 0);
  const gastoAdsMes = c.txMes.filter((t) => t.tipo === 'saida' && t.categoria === 'Ads/Marketing').reduce((a, t) => a + t.valor, 0);
  const creditoGratisAdsMes = c.txMes.filter((t) => t.tipo === 'entrada' && t.categoria === 'Crédito grátis Ads').reduce((a, t) => a + t.valor, 0);
  const gastoAdsBolsoMes = Math.max(0, gastoAdsMes - creditoGratisAdsMes);

  // lucro líquido = lucro bruto menos os custos fixos do mês (aluguel, ferramentas, etc.),
  // sem dividir por produto — dá o número "não tem erro" pra saber se fechou no azul de verdade
  const custosFixosMes = c.txMes.filter((t) => t.tipo === 'saida' && t.natureza === 'fixo').reduce((a, t) => a + t.valor, 0);
  // lucro líquido de verdade também desconta os custos variáveis de marketing (ads, cupom) —
  // antes só descontava custo fixo, o que dava uma impressão mais otimista do que a realidade
  const lucroLiquidoMes = lucroMes - custosFixosMes - descontoCupomMes - gastoAdsMes;

  // evolução de faturamento nos últimos 6 meses (independe do período selecionado no filtro —
  // sempre usa como referência o mês em que o "até" do período cai)
  const mesReferenciaEvolucao = monthKey(state.periodoFim);
  const mesesEvolucao = [5, 4, 3, 2, 1, 0].map((i) => addMonths(mesReferenciaEvolucao, -i));
  const faturamentoPorMes = mesesEvolucao.map((mk) => ({
    mes: mk,
    total: state.tx.filter((t) => t.tipo === 'entrada' && t.categoria.startsWith('Venda') && monthKey(t.data) === mk).reduce((a, t) => a + t.valor, 0),
  }));
  const maiorFaturamentoMes = Math.max(1, ...faturamentoPorMes.map((m) => m.total));

  const historicoOrdenado = [...vendasMes].sort((a, b) => b.data.localeCompare(a.data));
  const canaisHistorico = [...new Set(vendasMes.map((t) => t.categoria.replace(/^Venda\s*/, '').trim()).filter(Boolean))].sort();
  const historicoFiltrado = state.filtroHistoricoCanal && state.filtroHistoricoCanal !== 'todos'
    ? historicoOrdenado.filter((t) => t.categoria.replace(/^Venda\s*/, '').trim() === state.filtroHistoricoCanal)
    : historicoOrdenado;
  // última data com lançamento de ads/cupom — não é do período selecionado, é de TODA a
  // história, pra você sempre saber até onde já lançou, sem precisar caçar no Financeiro
  const ultimaDataAds = state.tx.filter((t) => t.categoria === 'Ads/Marketing' && t.tipo === 'saida').reduce((max, t) => (t.data > max ? t.data : max), '');
  const ultimaDataCupom = state.tx.filter((t) => t.categoria === 'Desconto de cupom' && t.tipo === 'saida').reduce((max, t) => (t.data > max ? t.data : max), '');

  return `
    <div class="section-title-wrap">
      <div><div class="section-title">Vendas</div><div class="section-subtitle">Ranking, plataformas e histórico de pedidos</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="icon-btn-ghost" id="toggleSkusPendentes" style="${state.vendasSkuPendentes.length > 0 ? 'background:rgba(255,182,39,0.15);border:1.5px solid var(--amber);color:var(--amber);font-weight:700' : ''}">🔗 SKUs pendentes${state.vendasSkuPendentes.length > 0 ? ` (${state.vendasSkuPendentes.length})` : ''}</button>
        <button class="icon-btn-ghost" id="recalcularTaxas" title="Corrige vendas antigas que ficaram com taxa de plataforma zerada">🔧 Recalcular taxas faltantes</button>
        <button class="icon-btn-ghost" id="toggleImportacoesVendas">📜 Ver importações</button>
        <button class="icon-btn-ghost" id="toggleUpload">📤 Importar vendas</button>
        <button class="icon-btn" id="toggleVendaManual">＋ Venda manual</button>
      </div>
    </div>
    ${ultimaDataAds || ultimaDataCupom ? `
      <div class="form-hint" style="margin-top:-6px;margin-bottom:10px">
        ${ultimaDataAds ? `📢 Ads lançado até: <strong style="color:var(--text)">${new Date(ultimaDataAds + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>` : ''}
        ${ultimaDataAds && ultimaDataCupom ? ' · ' : ''}
        ${ultimaDataCupom ? `🎟️ Cupom lançado até: <strong style="color:var(--text)">${new Date(ultimaDataCupom + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>` : ''}
      </div>
    ` : ''}

    ${state.showImportacoesVendas ? `
      <div class="form-card">
        <div class="section-title" style="margin-bottom:2px">Últimas importações</div>
        <div class="section-subtitle" style="margin-bottom:10px">Se algo saiu errado numa importação, desfaz ela aqui — restaura o estoque, apaga os lançamentos e os SKUs pendentes que ela criou, tudo de uma vez. Só dá pra desfazer a <strong>mais recente</strong>: se você já importou de novo depois, a mais antiga não pode mais ser desfeita sozinha, pra não apagar sem querer o que veio depois dela.</div>
        ${state.importacoesVendas.length === 0 ? `<div class="empty-state">Nenhuma importação registrada ainda.</div>` : (() => {
          const maisRecenteId = state.importacoesVendas.find((imp) => !imp.desfeita)?.id;
          return `
          <div class="tx-list">
            ${state.importacoesVendas.map((imp) => `
              <div class="tx-row">
                <div class="tx-dot" style="background:${imp.desfeita ? 'var(--text-muted)' : 'var(--teal)'}"></div>
                <div style="flex:1">
                  <div class="tx-categoria">${esc(imp.nomeArquivo)}${imp.desfeita ? ' (desfeita)' : ''}</div>
                  <div class="tx-desc">${imp.transacaoIds.length} lançamento(s) · ${new Date(imp.createdAt).toLocaleString('pt-BR')}</div>
                </div>
                ${!imp.desfeita && imp.id === maisRecenteId ? `<button class="trash-btn" style="color:var(--red)" data-desfazer-importacao="${imp.id}">↩️ Desfazer</button>` : !imp.desfeita ? `<span style="font-size:11px;color:var(--text-muted)">já tem importação mais nova</span>` : ''}
              </div>
            `).join('')}
          </div>
        `;
        })()}

        <div class="form-hint" style="margin-top:16px;margin-bottom:6px;border-top:1px solid var(--border);padding-top:12px">Importou algo antes desse recurso existir e não tem "Desfazer"? Reverte por período aqui embaixo (funciona pra qualquer venda importada, com ou sem histórico salvo) — pode ser um dia só ou vários dias seguidos.</div>
        <div class="form-row">
          <input type="date" id="reversaoDataInicio" value="${window.__reversaoDataInicioSelecionada || ''}" />
          <span style="color:var(--text-muted);align-self:center">até</span>
          <input type="date" id="reversaoDataFim" value="${window.__reversaoDataFimSelecionada || ''}" />
        </div>
        <button class="entrada-btn" type="button" id="buscarReversaoData">🔍 Ver o que tem nesse período</button>
        ${window.__reversaoPrevia ? (() => {
          const p = window.__reversaoPrevia;
          return `
            <div class="entrada-box">
              ${p.txVendaDoDia.length === 0 && p.pendentesDoDia.length === 0 ? `<div class="empty-state">Nenhuma venda encontrada nesse período.</div>` : `
                ${p.txVendaDoDia.length > 0 ? `<div class="form-hint">Vai apagar: ${p.txVendaDoDia.length} venda(s) (${fmt(p.totalValor)}) + ${p.txTaxaDoDia.length} taxa(s) de marketplace. (Cupom e Ads importados separadamente não são apagados aqui — remove manual no Financeiro se precisar.)</div>` : `<div class="form-hint">Não achei lançamento financeiro nesse período (já deve ter sido apagado antes).</div>`}
                ${p.semCor.length > 0 ? `
                  <div class="form-hint" style="margin-top:8px;color:var(--teal)">✅ Estoque será devolvido automático (sem cor):</div>
                  <div class="prod-breakdown">${p.semCor.map((i) => `<div class="prod-breakdown-item"><span>${esc(i.nome)}</span><span>+${i.qtd}</span></div>`).join('')}</div>
                ` : ''}
                ${p.comCorConhecida && p.comCorConhecida.length > 0 ? `
                  <div class="form-hint" style="margin-top:8px;color:var(--teal)">✅ Estoque será devolvido automático (cor já registrada na venda):</div>
                  <div class="prod-breakdown">${p.comCorConhecida.map((i) => `<div class="prod-breakdown-item"><span>${esc(i.nome)}</span><span>+${i.qtd}</span></div>`).join('')}</div>
                ` : ''}
                ${p.comCor.length > 0 ? `
                  <div class="form-hint" style="margin-top:8px;color:var(--amber)">⚠️ Essas vendas são de antes de guardar a cor — o sistema não sabe qual vendeu, você redistribui na mão depois:</div>
                  <div class="prod-breakdown">${p.comCor.map((i) => `<div class="prod-breakdown-item"><span>${esc(i.nome)}</span><span>${i.qtd} peça(s)</span></div>`).join('')}</div>
                ` : ''}
                ${p.pendentesDoDia.length > 0 ? `
                  <div class="form-hint" style="margin-top:8px;color:var(--red)">🔗 Isso NÃO apaga sozinho: tem ${p.pendentesDoDia.length} SKU(s) pendente(s) com última venda nesse período, ainda esperando vínculo:</div>
                  <div class="prod-breakdown">${p.pendentesDoDia.map((v) => `<div class="prod-breakdown-item"><span>${esc(v.sku)}${v.varianteTexto ? ' — ' + esc(v.varianteTexto) : ''}</span><span>${v.quantidade} un</span></div>`).join('')}</div>
                  <label class="checkbox-label" style="margin-top:6px"><input type="checkbox" id="reversaoApagarPendentes" checked /> Apagar esses SKUs pendentes junto (marque se esse período é a origem deles — senão desmarque e apague manualmente pela lixeira depois)</label>
                ` : ''}
                <button class="confirm-btn" style="margin-top:10px;background:var(--red)" data-confirmar-reversao-data="${p.dataInicio}" data-reversao-fim="${p.dataFim}">🗑️ Reverter esse período</button>
              `}
            </div>
          `;
        })() : ''}
      </div>
    ` : ''}

    ${renderSeletorPeriodo('vendas')}

    ${state.showVendaManualForm ? `
      <div class="form-card">
        <div class="form-hint">Pra vendas fora de marketplace (atacado, feira, venda direta etc). Lança a entrada no Financeiro, baixa o estoque de cada modelo e entra no ranking/comparação dessa aba. Se o cliente te reembolsou o frete junto com o pagamento, preencha o campo de frete separado — ele entra no caixa mas não conta como faturamento de venda.</div>
        <div class="form-hint" style="color:#ffb627">💡 Etiqueta de envio comprada por você é uma <strong>saída</strong> separada (categoria Frete/Logística), lançada normalmente quando você paga — não é aqui.</div>

        ${(window.__vendaManualItens || []).length > 0 ? `
          <div class="tx-list" style="margin-bottom:10px">
            ${(window.__vendaManualItens || []).map((it, idx) => `
              <div class="tx-row">
                <div class="tx-dot" style="background:var(--teal)"></div>
                <div style="flex:1">
                  <div class="tx-categoria">${esc(it.produtoNome)} — ${it.qtdTotal} peça(s)</div>
                  <div class="tx-desc">${esc(it.detalheCores || '')}${it.detalheCores ? ' · ' : ''}${fmt(it.valorPorPeca || it.valor / it.qtdTotal)}/peça × ${it.qtdTotal} = <strong style="color:var(--text)">${fmt(it.valor)}</strong></div>
                </div>
                <button class="trash-btn" data-remover-item-venda-manual="${idx}">🗑</button>
              </div>
            `).join('')}
          </div>
          <div class="form-hint" style="margin-bottom:10px">Total dos modelos adicionados: <strong style="color:var(--text)">${fmt((window.__vendaManualItens || []).reduce((a, it) => a + it.valor, 0))}</strong></div>
        ` : `<div class="form-hint">Nenhum modelo adicionado ainda — adiciona um por vez com o formulário abaixo.</div>`}

        <div class="form-hint" style="margin-top:6px;margin-bottom:2px;font-weight:600">➕ Adicionar modelo</div>
        <select id="vendaManualProduto">
          <option value="">Selecione o produto...</option>
          ${state.produtos.filter((p) => p.ativo !== false).map((p) => `<option value="${p.id}" ${window.__vendaManualProdutoId === p.id ? 'selected' : ''}>${esc(p.nome)}${p.sku ? ' — ' + esc(p.sku) : ''}</option>`).join('')}
        </select>
        ${(() => {
          const vs = window.__vendaManualProdutoId ? variantesDoProduto(window.__vendaManualProdutoId) : [];
          if (vs.length > 0) {
            return `
              <div class="form-hint" style="margin-top:2px">Esse produto tem cor cadastrada — informe quantas peças venderam de cada uma, pra baixar do estoque certo</div>
              ${vs.map((v) => `
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                  <div style="flex:none;font-size:13.5px;white-space:nowrap">${esc(v.nome)} <span style="color:var(--text-muted);margin-left:6px">(estoque: ${v.estoqueAtual})</span></div>
                  <input type="text" id="vendaManualCorQtd-${v.id}" placeholder="Qtd" inputmode="numeric" style="flex:none;width:70px;max-width:70px" />
                </div>
              `).join('')}
            `;
          }
          return `<input type="text" id="vendaManualQtd" placeholder="Quantidade" inputmode="numeric" />`;
        })()}
        <input type="text" id="vendaManualItemValor" placeholder="Valor por peça (R$) — o sistema multiplica pela quantidade" />
        <button class="entrada-btn" type="button" id="addItemVendaManual" style="margin-top:8px">＋ Adicionar modelo à venda</button>

        <div class="form-hint" style="margin-top:16px;margin-bottom:2px;font-weight:600">Dados da venda (valem pra todos os modelos acima)</div>
        <input type="text" id="vendaManualFrete" placeholder="Valor do frete reembolsado pelo cliente (opcional, R$)" />
        <input type="text" id="vendaManualCanal" placeholder="Canal (ex: Atacado, Feira, Venda direta)" />
        <input type="date" id="vendaManualData" value="${todayStr()}" />
        <div class="form-row">
          <button class="confirm-btn" id="salvarVendaManual">Lançar venda</button>
          <button class="toggle-btn" id="cancelarVendaManual">Cancelar</button>
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

    ${state.showSkusPendentes ? `
      <div class="form-card">
        <div class="section-title" style="margin-bottom:2px">SKUs pendentes de vincular</div>
        <div class="section-subtitle" style="margin-bottom:12px">Vieram em algum import de vendas mas não bateram com nenhum produto cadastrado. Vincule ao produto certo pra aplicar a baixa de estoque e já ficar automático nos próximos imports.</div>
        ${state.vendasSkuPendentes.length === 0 ? `<div class="empty-state">Nenhum SKU pendente no momento 🎉</div>` : `
          <div style="display:flex;flex-direction:column;gap:10px">
            ${state.vendasSkuPendentes.map((v) => `
              <div class="alert-card" style="border-color:var(--amber)55">
                <div class="alert-card-row">
                  <div class="alert-dot" style="background:var(--amber)"></div>
                  <div style="flex:1">
                    <div class="alert-name">${esc(v.sku)}</div>
                    ${v.descricao ? `<div style="font-size:12px;color:var(--text)">${esc(v.descricao)}</div>` : ''}
                    ${v.varianteTexto ? `<div style="font-size:12px;color:var(--teal)">🎨 ${esc(v.varianteTexto)}</div>` : ''}
                    <div class="alert-meta">${v.quantidade} peça(s) · ${v.pedidos} pedido(s) · ${fmt(v.faturamento)}${v.plataformaNome ? ` · ${esc(v.plataformaNome)}` : ''} · última venda ${v.ultimaData ? new Date(v.ultimaData + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</div>
                  </div>
                </div>
                <div class="form-row" style="margin-top:8px">
                  <select id="vincularSkuProduto-${v.id}" data-pendente-produto-select="${v.id}" style="flex:1">
                    <option value="">Selecione o produto (e a cor, se tiver)...</option>
                    <option value="__criar_kit__" ${state.pendenteSelecaoAtual[v.id] === '__criar_kit__' ? 'selected' : ''}>➕ Criar um kit novo pra essa combinação</option>
                    ${state.produtos.map((p) => {
                      const vs = variantesDoProduto(p.id);
                      if (vs.length > 0) {
                        return vs.map((variante) => `<option value="${p.id}|${variante.id}" ${state.pendenteSelecaoAtual[v.id] === `${p.id}|${variante.id}` ? 'selected' : ''}>${esc(p.nome)} — ${esc(variante.nome)}</option>`).join('');
                      }
                      return `<option value="${p.id}" ${(state.pendenteSelecaoAtual[v.id] || state.pendenteKitAtivo[v.id]) === p.id ? 'selected' : ''}>${esc(p.nome)}${p.sku ? ' — ' + esc(p.sku) : ''}${p.ehKit ? ' 🎁' : ''}</option>`;
                    }).join('')}
                  </select>
                  <button class="confirm-btn" data-vincular-sku="${v.id}">Vincular</button>
                  <button class="trash-btn" data-remover-sku-pendente="${v.id}" title="Ignorar esse SKU">🗑</button>
                </div>
                ${state.pendenteKitAtivo[v.id] ? (() => {
                  const kitProdutoId = state.pendenteKitAtivo[v.id];
                  const componentesExistentes = state.kitComponentes.filter((k) => k.produtoKitId === kitProdutoId);
                  return `
                    <div class="form-hint" style="margin-top:10px;margin-bottom:2px">🎁 Esse produto é um kit — escolhe a cor de cada peça que compõe ele (vale pra essa baixa retroativa E fica valendo como padrão pros próximos imports desse SKU, sem precisar escolher de novo)</div>
                    ${Array.from({ length: 4 }, (_, i) => {
                      const comp = componentesExistentes[i];
                      const valorAtual = comp ? `${comp.componenteProdutoId}|${comp.componenteVarianteId || ''}` : '';
                      return `
                        <div class="form-row" style="margin-top:4px">
                          <select id="pendenteKitComp-${v.id}-${i}" style="flex:1">
                            <option value="">Componente (opcional)</option>
                            ${state.produtos.filter((prod) => prod.id !== kitProdutoId && !prod.ehKit).map((prod) => {
                              const vsComp = variantesDoProduto(prod.id);
                              if (vsComp.length > 0) {
                                return vsComp.map((vc) => `<option value="${prod.id}|${vc.id}" ${valorAtual === `${prod.id}|${vc.id}` ? 'selected' : ''}>${esc(prod.nome)} — ${esc(vc.nome)}</option>`).join('');
                              }
                              return `<option value="${prod.id}|" ${valorAtual === `${prod.id}|` ? 'selected' : ''}>${esc(prod.nome)}</option>`;
                            }).join('')}
                          </select>
                          <input type="text" id="pendenteKitCompQtd-${v.id}-${i}" placeholder="Qtd" value="${comp ? comp.quantidade : '1'}" style="max-width:70px" inputmode="numeric" />
                        </div>
                      `;
                    }).join('')}
                  `;
                })() : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>
    ` : ''}

    <div class="stats-grid" style="margin-top:14px">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.1)">💰</div>
        <div class="stat-label">Faturamento no período</div>
        <div class="stat-value">${fmt(faturamentoMes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,182,39,0.1)">🧾</div>
        <div class="stat-label">Pedidos</div>
        <div class="stat-value">${qtdPedidosMes}</div>
        ${unidadesResumoMesTotal > 0 && unidadesResumoMesTotal !== qtdPedidosMes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${unidadesResumoMesTotal} peças no total (compare com "Unidades Vendidas" da plataforma — diferença é normal quando um pedido tem mais de 1 peça)</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,46,126,0.1)">🎯</div>
        <div class="stat-label">Ticket médio</div>
        <div class="stat-value">${fmt(ticketMedio)}</div>
        ${unidadesResumoMesTotal > 0 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${fmt(unidadesResumoMesTotal > 0 ? faturamentoMes / unidadesResumoMesTotal : 0)} por peça (compare com "Preço Médio" da plataforma — ticket médio é por pedido, preço médio é por peça)</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(0,212,160,0.1)">📈</div>
        <div class="stat-label">Lucro bruto${!temDadosDeLucro ? ' *' : ''}</div>
        <div class="stat-value" style="color:${lucroMes >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(lucroMes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(255,46,126,0.1)">📉</div>
        <div class="stat-label">Lucro líquido${!temDadosDeLucro ? ' *' : ''}</div>
        <div class="stat-value" style="color:${lucroLiquidoMes >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(lucroLiquidoMes)}</div>
      </div>
    </div>
    ${faturamentoNaoVinculadoMes > 1 && pctVinculadoMes < 95 ? `
      <div class="alert-card" style="border-color:var(--amber)55;margin-top:10px">
        <div class="alert-card-row">
          <div class="alert-dot" style="background:var(--amber)"></div>
          <div style="flex:1">
            <div class="alert-name" style="color:var(--amber)">⚠️ Lucro bruto incompleto: só ${pctVinculadoMes.toFixed(0)}% do faturamento desse mês entrou na conta</div>
            <div class="alert-status">${fmt(faturamentoNaoVinculadoMes)} em vendas ainda estão com SKU pendente (não vinculado a produto) e por isso não contam nem receita, nem custo, nem lucro aqui — o Lucro bruto real deve ser bem maior que o mostrado. Vincula os SKUs pendentes acima pra corrigir.</div>
          </div>
        </div>
      </div>
    ` : ''}
    <div class="section-subtitle" style="margin-top:${faturamentoNaoVinculadoMes > 1 && pctVinculadoMes < 95 ? '10px' : '-8px'};margin-bottom:8px">Lucro bruto = venda − custo direto da peça (tecido, corte, mão de obra, insumos) − taxa da plataforma. Lucro líquido = lucro bruto − custos fixos (${fmt(custosFixosMes)}, ex: aluguel, ferramentas) − cupom (${fmt(descontoCupomMes)}) − ads (${fmt(gastoAdsMes)}).${!temDadosDeLucro ? ' * Só considera vendas com produto identificado.' : ''}</div>

    ${descontoCupomMes > 0 || gastoAdsMes > 0 ? `
      <div class="section-title-wrap" style="margin-top:20px">
        <div><div class="section-title">📢 Marketing no período</div><div class="section-subtitle">Cupom e anúncios já importados (dos relatórios da plataforma)</div></div>
      </div>
      <div class="stats-grid">
        ${descontoCupomMes > 0 ? `
          <div class="stat-card">
            <div class="stat-icon" style="background:rgba(255,182,39,0.1)">🎟️</div>
            <div class="stat-label">Desconto de cupom</div>
            <div class="stat-value" style="color:var(--red)">${fmt(descontoCupomMes)}</div>
          </div>
        ` : ''}
        ${gastoAdsMes > 0 ? `
          <div class="stat-card">
            <div class="stat-icon" style="background:rgba(255,46,126,0.1)">📢</div>
            <div class="stat-label">Ads — total investido</div>
            <div class="stat-value" style="color:var(--red)">${fmt(gastoAdsMes)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background:rgba(255,46,126,0.1)">💸</div>
            <div class="stat-label">Ads — saiu do seu bolso</div>
            <div class="stat-value" style="color:var(--red)">${fmt(gastoAdsBolsoMes)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background:rgba(0,212,160,0.1)">🎁</div>
            <div class="stat-label">Ads — a Shopee te deu</div>
            <div class="stat-value" style="color:var(--teal)">${fmt(creditoGratisAdsMes)}</div>
          </div>
        ` : ''}
      </div>
      <div class="section-subtitle" style="margin-top:-8px;margin-bottom:8px">Cupom e Ads já entram descontados no Lucro líquido e no DRE — esse painel é só pra você enxergar o detalhe rápido, sem precisar abrir o Financeiro.</div>
    ` : ''}

    <div class="section-title-wrap" style="margin-top:24px">
      <div><div class="section-title">Evolução — últimos 6 meses</div><div class="section-subtitle">Faturamento total de vendas por mês</div></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">
      ${faturamentoPorMes.map((m) => `
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:48px;font-size:12.5px;color:var(--text-muted)">${mesLabel(m.mes)}</div>
          <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:6px;overflow:hidden;height:22px">
            <div style="height:100%;width:${(m.total / maiorFaturamentoMes) * 100}%;background:${m.mes === mesReferenciaEvolucao ? 'var(--pink)' : 'var(--teal)'};border-radius:6px"></div>
          </div>
          <div style="width:110px;text-align:right;font-size:13px;font-weight:600">${fmt(m.total)}</div>
        </div>
      `).join('')}
    </div>

    <div class="section-title-wrap">
      <div><div class="section-title">Comparação entre plataformas</div><div class="section-subtitle">No período selecionado</div></div>
    </div>
    ${comparacaoPlataformas.length === 0 ? `<div class="empty-state">Nenhuma venda nesse período ainda.</div>` : `
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:24px">
        ${comparacaoPlataformas.map((p) => `
          <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:6px 10px">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nome)}</div>
              <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin-top:3px">
                <div style="height:100%;width:${(p.faturamento / maiorFaturamentoPlataforma) * 100}%;background:var(--teal);border-radius:3px"></div>
              </div>
            </div>
            <div style="flex:0 0 auto;text-align:right;font-size:12px;white-space:nowrap">
              <div style="color:var(--teal);font-weight:600">${fmt(p.faturamento)}</div>
              <div style="color:var(--text-muted)">${p.pedidos} ped. · ${fmt(p.ticketMedio)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Ranking de produtos ${ordenarRankingPor === 'margem' ? '— pior margem primeiro' : 'mais vendidos'}</div><div class="section-subtitle">No período selecionado</div></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="toggle-btn ${ordenarRankingPor === 'quantidade' ? 'active-teal' : ''}" data-ordenar-ranking="quantidade">Mais vendidos</button>
        <button class="toggle-btn ${ordenarRankingPor === 'margem' ? 'active-teal' : ''}" data-ordenar-ranking="margem">Pior margem</button>
        ${renderControleColunas('rankingProdutos')}
      </div>
    </div>
    ${state.vendasSkuPendentes.length > 0 ? `
      <div class="form-hint" style="margin-top:-4px;margin-bottom:8px;color:var(--amber)">⚠️ Tem ${state.vendasSkuPendentes.length} SKU(s) ainda pendente(s) de vincular — os produtos abaixo podem estar com quantidade/lucro subestimados (ou nem aparecer aqui) até você vincular tudo. Vale conferir "🔗 SKUs pendentes" antes de decidir sobre preço.</div>
    ` : ''}
    ${rankingProdutos.length === 0 ? `<div class="empty-state">Nenhum SKU vinculado vendeu nesse período ainda (ou é um período anterior a esse recurso — o ranking por período só existe a partir de agora).</div>` : `
      <div style="display:grid;grid-template-columns:${gridColumnsStyle('rankingProdutos', 320)};gap:6px;margin-bottom:24px">
        ${rankingProdutos.map((p, i) => `
          <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;padding:6px 10px">
            <div style="flex:0 0 20px;font-size:11px;color:var(--text-muted);font-weight:700">${i + 1}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nome)}</div>
              <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin-top:3px">
                <div style="height:100%;width:${ordenarRankingPor === 'margem' ? Math.min(100, Math.max(0, p.margem)) : (p.quantidade / maiorQtdRanking) * 100}%;background:${ordenarRankingPor === 'margem' && p.margem < 15 ? 'var(--amber)' : 'var(--pink)'};border-radius:3px"></div>
              </div>
            </div>
            <div style="flex:0 0 auto;text-align:right;font-size:12px;white-space:nowrap">
              <div><strong>${p.quantidade}</strong> un · <span style="color:${p.margem >= 15 ? 'var(--teal)' : 'var(--amber)'}">${p.margem.toFixed(0)}%</span></div>
              <div style="color:${p.lucro >= 0 ? 'var(--teal)' : 'var(--red)'}">${fmt(p.lucro)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title-wrap">
      <div><div class="section-title">Histórico de pedidos</div><div class="section-subtitle">Vendas importadas no período selecionado</div></div>
      ${canaisHistorico.length > 1 ? `
        <select id="filtroHistoricoCanal" style="width:auto">
          <option value="todos" ${(!state.filtroHistoricoCanal || state.filtroHistoricoCanal === 'todos') ? 'selected' : ''}>Todos os canais</option>
          ${canaisHistorico.map((c) => `<option value="${esc(c)}" ${state.filtroHistoricoCanal === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      ` : ''}
    </div>
    ${historicoFiltrado.length === 0 ? `<div class="empty-state">${historicoOrdenado.length === 0 ? 'Nenhuma venda nesse mês ainda.' : 'Nenhuma venda desse canal nesse mês.'}</div>` : `
      <div class="tx-list">
        ${historicoFiltrado.map((t) => renderTxRow(t)).join('')}
      </div>
    `}
  `;
}

function attachVendasHandlers(c) {
  wireSeletorPeriodo('vendas');

  document.querySelectorAll('[data-ordenar-ranking]').forEach((btn) => {
    btn.addEventListener('click', () => { state.ordenarRankingPor = btn.dataset.ordenarRanking; render(); });
  });

  const toggleUpload = document.getElementById('toggleUpload');
  if (toggleUpload) toggleUpload.addEventListener('click', () => { state.showUpload = !state.showUpload; render(); });

  const toggleVendaManual = document.getElementById('toggleVendaManual');
  if (toggleVendaManual) toggleVendaManual.addEventListener('click', () => { state.showVendaManualForm = !state.showVendaManualForm; render(); });
  const cancelarVendaManual = document.getElementById('cancelarVendaManual');
  if (cancelarVendaManual) cancelarVendaManual.addEventListener('click', () => { state.showVendaManualForm = false; window.__vendaManualProdutoId = null; window.__vendaManualItens = []; render(); });
  const vendaManualProdutoSelect = document.getElementById('vendaManualProduto');
  if (vendaManualProdutoSelect) vendaManualProdutoSelect.addEventListener('change', (e) => { window.__vendaManualProdutoId = e.target.value; render(); });

  document.querySelectorAll('[data-remover-item-venda-manual]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.removerItemVendaManual);
      (window.__vendaManualItens || []).splice(idx, 1);
      render();
    });
  });

  const addItemVendaManual = document.getElementById('addItemVendaManual');
  if (addItemVendaManual) addItemVendaManual.addEventListener('click', () => {
    const produtoId = document.getElementById('vendaManualProduto').value;
    const valorPorPeca = parseBRNumber(document.getElementById('vendaManualItemValor').value);
    if (!produtoId) { alert('Selecione o produto desse modelo.'); return; }
    const produto = state.produtos.find((p) => p.id === produtoId);
    const vs = variantesDoProduto(produtoId);
    let qtdTotal = 0;
    let coresQtd = {};
    let detalheCores = '';
    if (vs.length > 0) {
      const partesCores = [];
      vs.forEach((v) => {
        const qtdCor = Number(document.getElementById(`vendaManualCorQtd-${v.id}`)?.value) || 0;
        coresQtd[v.id] = qtdCor;
        qtdTotal += qtdCor;
        if (qtdCor > 0) partesCores.push(`${v.nome} x${qtdCor}`);
      });
      detalheCores = partesCores.join(', ');
      if (qtdTotal <= 0) { alert('Informe a quantidade vendida de pelo menos uma cor.'); return; }
    } else {
      qtdTotal = Number(document.getElementById('vendaManualQtd').value);
      if (!qtdTotal || qtdTotal <= 0) { alert('Informe a quantidade.'); return; }
    }
    if (!valorPorPeca || valorPorPeca <= 0) { alert('Informe o valor por peça desse modelo.'); return; }
    const valorItem = valorPorPeca * qtdTotal;
    if (!window.__vendaManualItens) window.__vendaManualItens = [];
    window.__vendaManualItens.push({ produtoId, produtoNome: produto?.nome || '', qtdTotal, coresQtd, valor: valorItem, valorPorPeca, detalheCores });
    window.__vendaManualProdutoId = null;
    render();
  });

  const salvarVendaManual = document.getElementById('salvarVendaManual');
  if (salvarVendaManual) salvarVendaManual.addEventListener('click', async () => {
    const itens = window.__vendaManualItens || [];
    const frete = parseBRNumber(document.getElementById('vendaManualFrete').value) || 0;
    const canal = document.getElementById('vendaManualCanal').value;
    const data = document.getElementById('vendaManualData').value || todayStr();
    if (itens.length === 0) { alert('Adiciona pelo menos um modelo antes de lançar a venda.'); return; }
    let custoTotalGeral = 0;
    let valorTotalGeral = 0;
    let qtdTotalGeral = 0;
    itens.forEach((it) => {
      const custoUnit = calcularCustoTotalProduto(it.produtoId);
      custoTotalGeral += custoUnit * it.qtdTotal;
      valorTotalGeral += it.valor;
      qtdTotalGeral += it.qtdTotal;
    });
    const lucro = valorTotalGeral - custoTotalGeral;
    await lancarVendaManualMultipla(itens, frete, canal, data);
    state.showVendaManualForm = false;
    window.__vendaManualProdutoId = null;
    window.__vendaManualItens = [];
    await loadData();
    let msg = `Lançado! ${itens.length} modelo(s), ${qtdTotalGeral} peça(s) no total, por ${fmt(valorTotalGeral)}.\n\nCusto: ${fmt(custoTotalGeral)} · Lucro: ${fmt(lucro)} (${valorTotalGeral > 0 ? ((lucro / valorTotalGeral) * 100).toFixed(0) : 0}% de margem)`;
    if (frete > 0) {
      msg += `\n\n+ Frete reembolsado: ${fmt(frete)} (não entra no faturamento nem no lucro de venda, só passa pelo caixa).`;
    }
    alert(msg);
  });

  const toggleSkusPendentes = document.getElementById('toggleSkusPendentes');
  if (toggleSkusPendentes) toggleSkusPendentes.addEventListener('click', () => { state.showSkusPendentes = !state.showSkusPendentes; render(); });

  const recalcularTaxasBtn = document.getElementById('recalcularTaxas');
  if (recalcularTaxasBtn) recalcularTaxasBtn.addEventListener('click', async () => {
    if (!confirm('Isso vai corrigir a taxa de todas as vendas com taxa zerada, usando a faixa de taxa CADASTRADA HOJE em cada plataforma. Continuar?')) return;
    await recalcularTaxasFaltantes();
  });

  const filtroHistoricoCanal = document.getElementById('filtroHistoricoCanal');
  if (filtroHistoricoCanal) filtroHistoricoCanal.addEventListener('change', (e) => { state.filtroHistoricoCanal = e.target.value; render(); });

  const toggleImportacoesVendas = document.getElementById('toggleImportacoesVendas');
  if (toggleImportacoesVendas) toggleImportacoesVendas.addEventListener('click', () => { state.showImportacoesVendas = !state.showImportacoesVendas; render(); });
  document.querySelectorAll('[data-desfazer-importacao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Desfazer essa importação? Isso restaura o estoque, o total vendido e o preço médio de todos os produtos afetados pro que estava antes dessa importação, e apaga os lançamentos, o detalhe de vendas e os SKUs pendentes que ela criou.\n\nAção não pode ser desfeita de novo — confirma?')) return;
      const sucesso = await desfazerImportacaoVendas(btn.dataset.desfazerImportacao);
      await loadData();
      if (sucesso) alert('Importação desfeita — estoque restaurado.');
    });
  });

  const buscarReversaoData = document.getElementById('buscarReversaoData');
  if (buscarReversaoData) buscarReversaoData.addEventListener('click', () => {
    const dataInicio = document.getElementById('reversaoDataInicio').value;
    const dataFim = document.getElementById('reversaoDataFim').value || dataInicio;
    if (!dataInicio) { alert('Escolha uma data de início primeiro.'); return; }
    window.__reversaoDataInicioSelecionada = dataInicio;
    window.__reversaoDataFimSelecionada = dataFim;
    window.__reversaoPrevia = { ...calcularPreviaReversaoPorData(dataInicio, dataFim), dataInicio, dataFim };
    render();
  });
  document.querySelectorAll('[data-confirmar-reversao-data]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const dataInicio = btn.dataset.confirmarReversaoData;
      const dataFim = btn.dataset.reversaoFim || dataInicio;
      const rotuloPeriodo = dataInicio === dataFim
        ? new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')
        : `${new Date(dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(dataFim + 'T00:00:00').toLocaleDateString('pt-BR')}`;
      if (!confirm(`Reverter todas as vendas de ${rotuloPeriodo}?\n\nIsso apaga os lançamentos e o detalhe de vendas desse período, e devolve o estoque — inclusive de produtos com cor, quando a venda já tem a cor registrada. Vendas antigas sem essa informação salva você redistribui na mão depois.\n\nConfirma?`)) return;
      const apagarPendentes = document.getElementById('reversaoApagarPendentes')?.checked || false;
      const sucesso = await reverterVendasPorData(dataInicio, dataFim, apagarPendentes);
      window.__reversaoPrevia = null;
      window.__reversaoDataInicioSelecionada = null;
      window.__reversaoDataFimSelecionada = null;
      await loadData();
      if (sucesso) alert('Revertido! Se sobrou algum produto com cor da lista "não sabe qual vendeu" (venda antiga), confere e redistribui manualmente.');
    });
  });

  document.querySelectorAll('[data-pendente-produto-select]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const pendenteId = sel.dataset.pendenteProdutoSelect;
      const valorSelecionado = sel.value;
      if (valorSelecionado === '__criar_kit__') {
        const pendente = state.vendasSkuPendentes.find((v) => v.id === pendenteId);
        const nomeSugerido = [pendente?.descricao, pendente?.varianteTexto].filter(Boolean).join(' — ') || pendente?.sku || 'Novo kit';
        const nome = prompt('Nome do kit pra essa combinação:', nomeSugerido);
        if (!nome) { sel.value = state.pendenteSelecaoAtual[pendenteId] || ''; return; }
        const criado = await addProduto({ nome, estoqueAtual: 0, estoqueMinimo: 0, custoUnitario: 0, valorMaoObra: 0, tipo: 'kit' });
        if (!criado) return;
        await loadData();
        state.pendenteSelecaoAtual[pendenteId] = criado.id;
        state.pendenteKitAtivo[pendenteId] = criado.id;
        render();
        return;
      }
      state.pendenteSelecaoAtual[pendenteId] = valorSelecionado;
      const [produtoId] = valorSelecionado.split('|');
      const produto = state.produtos.find((p) => p.id === produtoId);
      if (produto?.ehKit || produto?.tipo === 'kit') {
        state.pendenteKitAtivo[pendenteId] = produtoId;
        render();
      } else if (state.pendenteKitAtivo[pendenteId]) {
        delete state.pendenteKitAtivo[pendenteId];
        render();
      }
    });
  });

  document.querySelectorAll('[data-vincular-sku]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pendenteId = btn.dataset.vincularSku;
      const valorSelecionado = document.getElementById(`vincularSkuProduto-${pendenteId}`).value;
      if (!valorSelecionado) { alert('Selecione o produto antes de vincular.'); return; }
      const [produtoId, varianteId] = valorSelecionado.split('|');
      if (state.pendenteKitAtivo[pendenteId] === produtoId) {
        const componentes = [];
        for (let i = 0; i < 4; i++) {
          const selComp = document.getElementById(`pendenteKitComp-${pendenteId}-${i}`);
          const inputQtd = document.getElementById(`pendenteKitCompQtd-${pendenteId}-${i}`);
          if (!selComp || !selComp.value) continue;
          const [compProdutoId, compVarianteId] = selComp.value.split('|');
          const qtd = Number(inputQtd?.value) || 1;
          if (compProdutoId && qtd > 0) componentes.push({ produtoId: compProdutoId, varianteId: compVarianteId || null, quantidade: qtd });
        }
        if (componentes.length === 0) { alert('Escolhe pelo menos uma cor/componente do kit antes de vincular.'); return; }
        await salvarComponentesKit(produtoId, componentes);
        await loadData();
      }
      await vincularSkuPendente(pendenteId, produtoId, varianteId || null);
      delete state.pendenteKitAtivo[pendenteId];
      delete state.pendenteSelecaoAtual[pendenteId];
      await loadData();
    });
  });
  document.querySelectorAll('[data-remover-sku-pendente]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Ignorar esse SKU? Ele some da lista de pendentes sem aplicar baixa de estoque nenhuma. Você pode vincular manualmente depois cadastrando o SKU direto no produto, se precisar.')) {
        await removerSkuPendente(btn.dataset.removerSkuPendente);
      }
    });
  });

  const csvInput = document.getElementById('csvInput');
  if (csvInput) csvInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // fatura/extrato de anúncios da Shopee — formato bem diferente (linhas de metadado antes
    // da tabela), detecta ANTES do parse genérico pra não virar lixo
    if (/adwords_bill/i.test(file.name) || /\.csv$/i.test(file.name)) {
      const previaTexto = await file.text();
      if (/hist[oó]rico de transa[çc][õo]es de an[uú]ncios/i.test(previaTexto)) {
        await processarFaturaAdsShopee(file);
        e.target.value = '';
        return;
      }
    }

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
    const dataArquivoInfo = guessDataFromFilename(file.name);
    const dataArquivo = dataArquivoInfo.data;
    let houveLinhaSemDataPropria = false;

    // relatório de "desempenho de cupom" da Shopee (nome do arquivo começa com "voucher_",
    // ou tem a coluna característica "Custo (Pedidos Pagos) (BRL)") — é bem diferente de um
    // relatório de vendas: não lista peça por peça, só dá o custo TOTAL do dia gasto em cupom.
    // Lança isso como uma despesa separada, pra reduzir o lucro do dia sem precisar saber
    // exatamente qual pedido teve cupom — mais preciso que a taxa estimada sozinha
    const ehRelatorioVoucher = /^voucher/i.test(file.name) || (rows[0] && 'custo (pedidos pagos) (brl)' in rows[0]);
    if (ehRelatorioVoucher) {
      // período de vários dias (ex: "01/07/2026 - 31/07/2026" no nome do arquivo) — a Shopee
      // já separa isso por dia sozinha, numa aba diferente ("Tendências das Métricas"), com uma
      // linha por dia (formato "DD/MM/AAAA", sem hora — diferente do relatório de 1 dia só, que
      // usa essa mesma aba mas com granularidade por HORA)
      if (dataArquivoInfo.ehPeriodo) {
        const linhasTendencia = await parseXLSX(file, 'Tendências das Métricas');
        if (!linhasTendencia) { alert('Não achei a aba "Tendências das Métricas" nesse arquivo — não consigo separar por dia.'); e.target.value = ''; return; }
        const registrosPorDia = linhasTendencia
          .map((r) => {
            const periodo = String(r['período'] || '').trim();
            const m = periodo.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // só linhas de UM DIA (sem hora)
            if (!m) return null;
            const [, d, mo, y] = m;
            return {
              dataDia: `${y}-${mo}-${d}`,
              custo: parseBRNumber(String(r['custo (pedidos pagos) (brl)'] || '0')),
              pedidos: Number(r['pedidos (pedidos pagos)'] || 0),
            };
          })
          .filter((r) => r && r.custo > 0);
        if (registrosPorDia.length === 0) { alert('Não achei nenhum dia com custo de cupom nesse período.'); e.target.value = ''; return; }
        const totalPeriodo = registrosPorDia.reduce((a, r) => a + r.custo, 0);
        const listaResumo = registrosPorDia.map((r) => `${new Date(r.dataDia + 'T00:00:00').toLocaleDateString('pt-BR')}: ${fmt(r.custo)}`).join('\n');
        if (!confirm(`Achei ${registrosPorDia.length} dia(s) de cupom nesse período${plataforma ? ` — ${plataforma.nome}` : ''}:\n\n${listaResumo}\n\nTotal: ${fmt(totalPeriodo)}\n\nLançar um lançamento de despesa por dia (${registrosPorDia.length} lançamento(s) no total)?`)) { e.target.value = ''; return; }
        for (const r of registrosPorDia) {
          await addTx({
            tipo: 'saida', valor: r.custo, categoria: 'Desconto de cupom', natureza: 'variavel',
            descricao: `Cupom${plataforma ? ' ' + plataforma.nome : ''} — custeado pela loja (${r.pedidos} pedido(s) afetados)`, data: r.dataDia,
          });
        }
        await loadData();
        alert(`Lançado! ${registrosPorDia.length} dia(s) de cupom registrados, totalizando ${fmt(totalPeriodo)}.`);
        e.target.value = '';
        return;
      }
      const linha = rows[0];
      if (!linha) { alert('Não consegui ler os dados desse relatório de cupom.'); e.target.value = ''; return; }
      const custoCupom = parseBRNumber(String(linha['custo (pedidos pagos) (brl)'] || '0'));
      const pedidosPagos = Number(linha['pedidos (pedidos pagos)'] || 0);
      const dataCupom = dataArquivo || todayStr();
      if (custoCupom <= 0) { alert('Esse relatório de cupom não tem custo nenhum registrado nesse dia — nada pra lançar.'); e.target.value = ''; return; }
      if (!confirm(`Achei um relatório de desempenho de cupom (não é relatório de vendas).\n\nCusto total de cupom em ${new Date(dataCupom + 'T00:00:00').toLocaleDateString('pt-BR')}: ${fmt(custoCupom)} (afetou ${pedidosPagos} pedido(s) pagos)${plataforma ? ` — ${plataforma.nome}` : ''}.\n\nLançar isso como despesa nesse dia, pra descontar do lucro?`)) { e.target.value = ''; return; }
      const txCupom = await addTx({
        tipo: 'saida', valor: custoCupom, categoria: 'Desconto de cupom', natureza: 'variavel',
        descricao: `Cupom${plataforma ? ' ' + plataforma.nome : ''} — custeado pela loja (${pedidosPagos} pedido(s) afetados)`, data: dataCupom,
      });
      await loadData();
      if (txCupom) alert(`Lançado! ${fmt(custoCupom)} de cupom em ${new Date(dataCupom + 'T00:00:00').toLocaleDateString('pt-BR')}.`);
      e.target.value = '';
      return;
    }

    // foto de como está tudo ANTES de processar — se algo der errado, dá pra restaurar
    // exatamente esse estado com o botão de desfazer, sem precisar recalcular nada
    const snapshotAntes = {
      produtos: state.produtos.map((p) => ({ id: p.id, estoqueAtual: p.estoqueAtual, totalVendido: p.totalVendido, precoVendaMedio: p.precoVendaMedio })),
      variantes: state.variantes.map((v) => ({ id: v.id, estoqueAtual: v.estoqueAtual })),
      insumos: state.insumos.map((i) => ({ id: i.id, quantidadeDisponivel: i.quantidadeDisponivel, custoMedioUnitario: i.custoMedioUnitario })),
    };

    // mapa de SKU (minúsculo, sem espaço nas pontas) -> { produto, variante }
    // cada produto pode ter vários SKUs separados por vírgula (ex: "TOP-JACK, TOP-JACKK"),
    // e cada cor também pode ter os seus próprios SKUs — quando bate com o SKU de uma cor
    // específica, a baixa vai pro estoque daquela cor em vez do estoque geral do produto
    const skuMap = new Map();
    state.produtos.forEach((p) => {
      if (!p.sku) return;
      p.sku.split(',').forEach((s) => {
        const key = s.trim().toLowerCase();
        if (key) skuMap.set(key, { produto: p, variante: null });
      });
    });
    state.variantes.forEach((v) => {
      if (!v.skuVariante) return;
      const produto = state.produtos.find((p) => p.id === v.produtoId);
      if (!produto) return;
      v.skuVariante.split(',').forEach((s) => {
        const key = s.trim().toLowerCase();
        if (key) skuMap.set(key, { produto, variante: v });
      });
    });

    const novos = [];
    const deducoes = new Map(); // produtoId -> { qtd, ultimaData, faturamento } (total do import, usado pra baixar estoque)
    const detalhesVendas = new Map(); // produtoId|plataformaId|data -> { produtoId, plataformaId, plataformaNome, sku, quantidade, valor, data } (granular, pra ranking/comparação por período)
    const skusNaoEncontrados = new Map(); // "sku||variante" -> { sku, qtd, faturamento, ultimaData, plataformaNome, varianteTexto } — separado por variação pra não misturar cores diferentes que usam o mesmo SKU base
    const pedidosPorPlataforma = new Map(); // plataformaId (ou '_sem_plataforma') -> Set de pedidos
    const linhasSemPedidoPorPlataforma = new Map(); // fallback quando a linha não tem ID do pedido
    // resumo diário por plataforma, de TODA linha — independente de o SKU já estar vinculado
    // ou não, pra "pedidos"/"ticket médio" ficarem certos desde já
    const resumoDiarioMap = new Map(); // "plataformaNome|data" -> { pedidos, unidades, faturamento }
    const canceladosDiarioMap = new Map(); // "plataformaNome|data" -> { pedidos, unidades } — pedidos com R$0,00 (cancelado/sem repasse), separado pra não inflar "vendas"
    let temSku = false;
    let totalTaxas = 0;
    let totalTaxasReais = 0;
    let totalTaxasEstimadas = 0;

    rows.forEach((row) => {
      const raw = guessValueField(row);
      if (raw === null) return; // coluna de valor nem existe nessa planilha — não dá pra processar essa linha de jeito nenhum
      const valor = parseBRNumber(String(raw));

      const descricaoItem = guessDescricaoField(row, file.name);
      const dataDaLinhaPropria = guessDataField(row);
      if (!dataDaLinhaPropria) houveLinhaSemDataPropria = true;
      const dataLinha = dataDaLinhaPropria || dataArquivo || todayStr();
      const plataformaLinha = guessPlataformaFromRow(row, state.plataformas) || plataforma;
      // relatórios "por variante" trazem o TOTAL de várias vendas numa linha só (ex: 39
      // unidades, R$1.403,61) — pra escolher a faixa de taxa certa e cobrar a taxa fixa o
      // número certo de vezes, precisa do preço por unidade, não do total do lote
      const qtdLinha = guessQuantidadeField(row) || 1;
      const pedidosLinha = guessPedidosField(row) || 1;

      // pedido com valor R$0,00 (cancelado, sem repasse, etc.) NÃO conta como venda real —
      // fica só numa contagem separada, informativa, pra não dar a falsa impressão de que
      // vendeu mais peças do que realmente vendeu. Não mexe em taxa, estoque, SKU pendente
      // nem no resumo de "pedidos"/"unidades" que aparece pra você
      if (!valor) {
        const chaveCancel = `${plataformaLinha ? plataformaLinha.nome : ''}|${dataLinha}`;
        const atualCancel = canceladosDiarioMap.get(chaveCancel) || { pedidos: 0, unidades: 0 };
        atualCancel.pedidos += pedidosLinha;
        atualCancel.unidades += qtdLinha;
        canceladosDiarioMap.set(chaveCancel, atualCancel);
        return;
      }

      const chaveResumo = `${plataformaLinha ? plataformaLinha.nome : ''}|${dataLinha}`;
      const atualResumo = resumoDiarioMap.get(chaveResumo) || { pedidos: 0, unidades: 0, faturamento: 0 };
      atualResumo.pedidos += pedidosLinha;
      atualResumo.unidades += qtdLinha;
      atualResumo.faturamento += valor;
      resumoDiarioMap.set(chaveResumo, atualResumo);

      const valorUnitario = qtdLinha > 0 ? valor / qtdLinha : valor;
      const taxaEscolhida = taxaDaPlataformaParaValor(plataformaLinha, valorUnitario);
      const taxaPctLinha = taxaEscolhida.pct;
      const taxaFixaLinha = taxaEscolhida.fixa;
      const idPedidoLinha = guessIdPedidoField(row);
      const chavePlataforma = plataformaLinha ? plataformaLinha.id : '_sem_plataforma';
      if (idPedidoLinha) {
        if (!pedidosPorPlataforma.has(chavePlataforma)) pedidosPorPlataforma.set(chavePlataforma, new Set());
        pedidosPorPlataforma.get(chavePlataforma).add(idPedidoLinha.trim().toLowerCase());
      } else {
        // sem coluna de ID do pedido nessa planilha (ex: relatório "Sales by Variant", que
        // resume por SKU) — soma o valor real da coluna "Pedidos Válidos" daquela linha, não
        // conta só "+1 por linha" (senão subestima MUITO os pedidos reais, e por tabela
        // desconta insumo de menos, tipo envelope/etiqueta que são "por pedido")
        linhasSemPedidoPorPlataforma.set(chavePlataforma, (linhasSemPedidoPorPlataforma.get(chavePlataforma) || 0) + pedidosLinha);
      }

      // cada linha do relatório pode somar VÁRIAS vendas juntas numa linha só (ex: 39
      // unidades numa linha) — quebra em lançamentos individuais, um por unidade, pra cada
      // venda aparecer separada no Financeiro, em vez de um bloco só com tudo somado
      const criarLancamentosPorUnidade = (valorTotal, qtd, criarLinha) => {
        let somaParcial = 0;
        for (let i = 0; i < qtd; i++) {
          const ultima = i === qtd - 1;
          const valorUnit = ultima ? Math.round((valorTotal - somaParcial) * 100) / 100 : Math.round((valorTotal / qtd) * 100) / 100;
          somaParcial += valorUnit;
          criarLinha(valorUnit);
        }
      };

      criarLancamentosPorUnidade(valor, qtdLinha, (valorUnit) => {
        novos.push({
          tipo: 'entrada', valor: valorUnit,
          categoria: plataformaLinha ? `Venda ${plataformaLinha.nome}` : 'Venda marketplace',
          descricao: descricaoItem,
          data: dataLinha,
          idPedido: idPedidoLinha,
        });
      });

      const taxaReal = guessTaxaRealField(row);
      let taxaTotalLinha = 0;
      if (taxaReal !== null && taxaReal > 0) {
        totalTaxas += taxaReal;
        totalTaxasReais++;
        taxaTotalLinha = taxaReal;
        criarLancamentosPorUnidade(taxaReal, qtdLinha, (valorUnit) => {
          novos.push({
            tipo: 'saida', valor: valorUnit, categoria: 'Taxas de marketplace', natureza: 'variavel',
            descricao: `Taxa real${plataformaLinha ? ' ' + plataformaLinha.nome : ''} — ${descricaoItem}`,
            data: dataLinha,
          });
        });
      } else if (taxaPctLinha > 0 || taxaFixaLinha > 0) {
        const taxaValor = Math.round((valor * (taxaPctLinha / 100) + taxaFixaLinha * qtdLinha) * 100) / 100;
        totalTaxas += taxaValor;
        totalTaxasEstimadas++;
        taxaTotalLinha = taxaValor;
        criarLancamentosPorUnidade(taxaValor, qtdLinha, (valorUnit) => {
          novos.push({
            tipo: 'saida', valor: valorUnit, categoria: 'Taxas de marketplace', natureza: 'variavel',
            descricao: `Taxa estimada ${plataformaLinha.nome} (${taxaPctLinha}% + ${fmt(taxaFixaLinha)}) — ${descricaoItem}`,
            data: dataLinha,
          });
        });
      }

      const sku = guessSkuField(row);
      if (sku) {
        temSku = true;
        // quando o mesmo SKU cobre várias combinações de cor (comum em kit com N cores
        // possíveis, ou produto que usa 1 SKU genérico pra todas as cores), o casamento
        // primeiro tenta "SKU + texto da variação" (mais específico) antes do SKU sozinho —
        // assim cada combinação vinculada fica de fato separada das outras, mesmo tendo o
        // mesmo código de SKU
        const varianteTextoLinhaMatch = guessVarianteTextoField(row);
        const chaveComposta = varianteTextoLinhaMatch ? `${sku.trim().toLowerCase()}||${normalizarVarianteTexto(varianteTextoLinhaMatch).toLowerCase()}` : null;
        const match = (chaveComposta && skuMap.get(chaveComposta)) || skuMap.get(sku.trim().toLowerCase());
        const qtd = qtdLinha;
        if (match) {
          const { produto, variante } = match;
          const atual = deducoes.get(produto.id) || { qtd: 0, ultimaData: dataLinha, faturamento: 0, porVariante: new Map(), semVariante: 0 };
          atual.qtd += qtd;
          atual.faturamento += valor;
          if (dataLinha > atual.ultimaData) atual.ultimaData = dataLinha;
          if (variante) {
            atual.porVariante.set(variante.id, (atual.porVariante.get(variante.id) || 0) + qtd);
          } else {
            atual.semVariante += qtd;
          }
          deducoes.set(produto.id, atual);

          const chaveDetalhe = `${produto.id}|${variante ? variante.id : ''}|${plataformaLinha ? plataformaLinha.id : ''}|${dataLinha}`;
          const atualDetalhe = detalhesVendas.get(chaveDetalhe) || {
            produtoId: produto.id, varianteId: variante ? variante.id : null, plataformaId: plataformaLinha ? plataformaLinha.id : null,
            plataformaNome: plataformaLinha ? plataformaLinha.nome : null, sku: sku.trim(), quantidade: 0, valor: 0, data: dataLinha, pedidos: 0, taxa: 0,
          };
          atualDetalhe.quantidade += qtd;
          atualDetalhe.valor += valor;
          atualDetalhe.pedidos += pedidosLinha;
          atualDetalhe.taxa += taxaTotalLinha;
          detalhesVendas.set(chaveDetalhe, atualDetalhe);
        } else {
          const chavePendente = sku.trim().toLowerCase() + '||' + (varianteTextoLinhaMatch ? varianteTextoLinhaMatch.trim().toLowerCase() : '');
          const atual = skusNaoEncontrados.get(chavePendente) || { sku: sku.trim(), qtd: 0, faturamento: 0, pedidos: 0, taxa: 0, ultimaData: dataLinha, plataformaNome: plataformaLinha ? plataformaLinha.nome : null, descricao: descricaoItem, varianteTexto: varianteTextoLinhaMatch };
          atual.qtd += qtd;
          atual.faturamento += valor;
          atual.pedidos += pedidosLinha;
          atual.taxa += taxaTotalLinha;
          if (dataLinha > atual.ultimaData) atual.ultimaData = dataLinha;
          skusNaoEncontrados.set(chavePendente, atual);
        }
      }
    });

    if (!novos.length) {
      alert('Não encontrei nenhuma coluna de valor reconhecível nesse arquivo. Me manda o nome das colunas que eu ajusto.');
      state.showUpload = false;
      render();
      return;
    }

    const transacaoIdsCriadas = await addTxBatch(novos);
    const vendasDetalheIdsCriadas = detalhesVendas.size ? await addVendasDetalheBatch([...detalhesVendas.values()]) : [];
    const skuPendenteIdsCriados = skusNaoEncontrados.size ? await registrarSkusPendentes(skusNaoEncontrados) : [];

    // aplica baixa de estoque + soma no total vendido + atualiza preço médio de venda
    let unidadesCorAmbigua = 0;
    for (const [produtoId, info] of deducoes.entries()) {
      const produto = state.produtos.find((p) => p.id === produtoId);
      if (!produto) continue;
      if (produto.ehKit) {
        // kit não guarda estoque próprio — desconta direto dos componentes. Se a venda veio
        // com a combinação de cor identificada (ex: SKU específico de "Amarelo Bebê +
        // Branco"), abate a cor certa do produto unitário — só cai no padrão fixo da ficha
        // técnica quando a venda bateu no SKU genérico do kit, sem indicar a combinação
        for (const [kitVarianteId, qtdCombo] of info.porVariante.entries()) {
          await baixarEstoqueVenda(produto, kitVarianteId, qtdCombo);
        }
        if (info.semVariante > 0) await baixarEstoqueVenda(produto, null, info.semVariante);
        const novoTotalVendidoKit = (produto.totalVendido || 0) + info.qtd;
        await registrarVendaProduto(produtoId, produto.estoqueAtual, novoTotalVendidoKit, info.ultimaData);
        await atualizarPrecoVendaMedio(produtoId, info.faturamento, info.qtd);
        // insumos "na venda" (ex: bojo) da ficha técnica do PRÓPRIO kit — antes esse passo
        // era pulado pra produtos kit, então nunca descontava bojo nas vendas que batiam
        // automático (só quando vinculava manual um SKU pendente)
        await baixarEstoquePorFichaTecnica(produtoId, info.qtd, info.ultimaData);
        continue;
      }
      const vs = variantesDoProduto(produtoId);
      // baixa de cada cor identificada pelo SKU
      for (const [varianteId, qtdCor] of info.porVariante.entries()) {
        const variante = state.variantes.find((v) => v.id === varianteId);
        if (variante) await updateVarianteEstoque(varianteId, variante.estoqueAtual - qtdCor);
      }
      // parte que bateu só no SKU genérico do produto (não numa cor específica)
      let novoEstoque = produto.estoqueAtual;
      if (info.semVariante > 0) {
        if (vs.length === 0) {
          novoEstoque = produto.estoqueAtual - info.semVariante;
        } else {
          // produto tem cor cadastrada mas o SKU que bateu foi o genérico — não dá pra saber
          // de qual cor descontar, então não mexe no estoque de nenhuma cor pra não errar
          unidadesCorAmbigua += info.semVariante;
        }
      }
      const novoTotalVendido = (produto.totalVendido || 0) + info.qtd;
      await registrarVendaProduto(produtoId, novoEstoque, novoTotalVendido, info.ultimaData);
      await atualizarPrecoVendaMedio(produtoId, info.faturamento, info.qtd);
      // se o SKU vendido tem ficha técnica (ex: um kit), desconta insumos e produtos componentes também
      await baixarEstoquePorFichaTecnica(produtoId, info.qtd, info.ultimaData);
    }

    // conta pedidos por plataforma (pedidos únicos onde tem ID; fallback pra contagem de
    // linhas só quando aquela plataforma não trouxe ID do pedido em nenhuma linha)
    const chavesPlataforma = new Set([...pedidosPorPlataforma.keys(), ...linhasSemPedidoPorPlataforma.keys()]);
    const pedidosPorPlataformaCount = new Map();
    chavesPlataforma.forEach((chave) => {
      const viaPedido = pedidosPorPlataforma.get(chave)?.size || 0;
      const contagem = viaPedido > 0 ? viaPedido : (linhasSemPedidoPorPlataforma.get(chave) || 0);
      pedidosPorPlataformaCount.set(chave, contagem);
    });
    const totalPedidosImportados = [...pedidosPorPlataformaCount.values()].reduce((a, n) => a + n, 0);
    const usouEstimativaPorLinha = [...pedidosPorPlataforma.values()].every((s) => s.size === 0) || pedidosPorPlataforma.size === 0;

    // insumos usados por pedido (envelope, etiqueta de rastreio) — respeitando a quantidade
    // configurada por plataforma (ex: Mercado Livre = 2 etiquetas, padrão = 1)
    const insumosEnvio = state.insumos.filter((i) => i.usadoNoEnvio);
    for (const insumo of insumosEnvio) {
      let totalParaBaixar = 0;
      pedidosPorPlataformaCount.forEach((qtdPedidos, chave) => {
        const plataformaId = chave === '_sem_plataforma' ? null : chave;
        totalParaBaixar += qtdPedidos * qtdInsumoPorPedido(insumo.id, plataformaId);
      });
      if (totalParaBaixar > 0) await baixarInsumo(insumo.id, totalParaBaixar);
    }

    await acumularResumoDiario(resumoDiarioMap);
    await salvarImportacaoVendas(file.name, snapshotAntes, transacaoIdsCriadas, vendasDetalheIdsCriadas, skuPendenteIdsCriados);
    state.showUpload = false;
    await loadData();

    const qtdVendas = novos.filter((n) => n.tipo === 'entrada').length;
    let resumo = `${qtdVendas} venda(s) importada(s).\n\n↩️ Se algo saiu errado, vá em "📜 Ver importações" pra desfazer essa importação inteira (restaura o estoque de antes automaticamente).`;
    const pedidosCancelados = [...canceladosDiarioMap.values()].reduce((a, c) => a + c.pedidos, 0);
    const unidadesCanceladas = [...canceladosDiarioMap.values()].reduce((a, c) => a + c.unidades, 0);
    if (pedidosCancelados > 0) {
      resumo += `\n\n🚫 ${pedidosCancelados} pedido(s) (${unidadesCanceladas} peça(s)) vieram com R$0,00 de pagamento — provavelmente cancelados ou sem repasse. Não contam como venda em nenhum número do Rosa (nem Pedidos, nem Unidades, nem Faturamento), só pra não dar impressão de venda que não teve.`;
    }
    if (houveLinhaSemDataPropria && dataArquivoInfo.ehPeriodo) {
      resumo += `\n\n⚠️ Essa planilha resume um período de vários dias (não traz a data de cada venda individual) — lancei tudo com data ${new Date(dataArquivo + 'T00:00:00').toLocaleDateString('pt-BR')} (o último dia do período), só como referência. Se quiser separar por dia certinho, use um relatório de pedidos que traga a data de cada venda.`;
    }
    if (totalTaxas > 0) {
      resumo += `\nTaxas descontadas: ${fmt(totalTaxas)}`;
      const partes = [];
      if (totalTaxasReais > 0) partes.push(`${totalTaxasReais} com valor real do relatório`);
      if (totalTaxasEstimadas > 0) partes.push(`${totalTaxasEstimadas} estimada(s) por %`);
      if (partes.length) resumo += ` (${partes.join(', ')}).`;
    }
    if (temSku) {
      resumo += `\n${deducoes.size} produto(s) com estoque baixado automaticamente.`;
      if (unidadesCorAmbigua > 0) {
        resumo += `\n\n⚠️ ${unidadesCorAmbigua} peça(s) venderam com um SKU que identifica o produto mas não a cor específica — o estoque geral não foi mexido pra não descontar da cor errada. Cadastre o SKU de cada cor (em Estoque, no produto) pra isso parar de acontecer.`;
      }
      if (skusNaoEncontrados.size) {
        resumo += `\n\nSKUs não encontrados no cadastro (${skusNaoEncontrados.size}) ficaram pendentes de vinculação — vá em Vendas > SKUs pendentes de vincular pra associar ao produto certo (a baixa de estoque é aplicada assim que você vincular).`;
      }
    } else {
      resumo += `\n(Nenhuma coluna de SKU foi encontrada, então o estoque não foi ajustado.)`;
    }
    if (insumosEnvio.length > 0) {
      resumo += `\n\n📦 ${totalPedidosImportados} pedido(s)${usouEstimativaPorLinha ? ' (estimado por linha, sem coluna de ID do pedido)' : ''} — baixado de: ${insumosEnvio.map((i) => i.nome).join(', ')} (respeitando a quantidade configurada por plataforma).`;
    }
    alert(resumo);
  });

  attachTxRowHandlers();
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
    const cartaoId = document.getElementById('tecidoCartaoSelect')?.value;
    const cartao = cartaoId ? state.cartoesCredito.find((cc) => cc.id === cartaoId) : null;
    const numParcelas = cartao ? (Number(document.getElementById('tecidoNumParcelas').value) || 1) : 1;
    if (!cor || !rolos || rolos <= 0 || !valor) { alert('Selecione ou digite a cor, e preencha quantidade de rolos e valor.'); return; }
    await comprarTecido(cor, rolos, valor, data, !historico, numParcelas, cartao);
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
    window.__numCoresOrdemCorte = 1;
    render();
  });

  document.querySelectorAll('[id^="ordemCor-"]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      const custo = opt ? Number(opt.dataset.custo || 0) : 0;
      const indice = sel.id.replace('ordemCor-', '');
      const rolosInput = document.getElementById(`ordemRolos-${indice}`);
      const valorInput = document.getElementById(`ordemValor-${indice}`);
      const atualizarSugestao = () => {
        const qtd = Number(rolosInput.value) || 0;
        if (qtd > 0 && custo > 0) valorInput.value = (qtd * custo).toFixed(2).replace('.', ',');
      };
      rolosInput.oninput = atualizarSugestao;
      atualizarSugestao();
    });
  });

  const adicionarCorOrdemCorte = document.getElementById('adicionarCorOrdemCorte');
  if (adicionarCorOrdemCorte) adicionarCorOrdemCorte.addEventListener('click', () => {
    window.__numCoresOrdemCorte = (window.__numCoresOrdemCorte || 1) + 1;
    render();
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
      const numLinhas = window.__numCoresOrdemCorte || 1;
      const linhas = [];
      for (let i = 0; i < numLinhas; i++) {
        const cor = document.getElementById(`ordemCor-${i}`)?.value;
        const rolos = Number(document.getElementById(`ordemRolos-${i}`)?.value);
        const valor = parseBRNumber(document.getElementById(`ordemValor-${i}`)?.value || '0');
        if (cor && rolos > 0) linhas.push({ cor, rolos, valor });
      }
      if (linhas.length === 0) { alert('Selecione pelo menos uma cor e informe a quantidade de rolos.'); return; }
      // valor do corte é do lote inteiro (cortadas juntas) — divide proporcional aos rolos de
      // cada cor, pra cada ordem individual carregar seu pedaço justo do custo do corte
      const totalRolos = linhas.reduce((a, l) => a + l.rolos, 0);
      const grupoId = linhas.length > 1 ? crypto.randomUUID() : null;
      let somaParcialCorte = 0;
      for (let i = 0; i < linhas.length; i++) {
        const ultima = i === linhas.length - 1;
        const valorCorteLinha = ultima
          ? Math.round((valorCorte - somaParcialCorte) * 100) / 100
          : Math.round((valorCorte * (linhas[i].rolos / totalRolos)) * 100) / 100;
        somaParcialCorte += valorCorteLinha;
        const ok = await criarOrdemCorte(linhas[i].cor, linhas[i].rolos, linhas[i].valor, data, 'principal', valorCorteLinha, grupoId);
        if (!ok) return;
      }
      state.showOrdemCorteForm = false;
      window.__ordemTipo = 'principal';
      window.__numCoresOrdemCorte = 1;
      await loadData();
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

  document.querySelectorAll('[data-abrir-conclusao-grupo]').forEach((btn) => {
    btn.addEventListener('click', () => { state.grupoConcluindoId = btn.dataset.abrirConclusaoGrupo; render(); });
  });
  document.querySelectorAll('[data-cancelar-conclusao-grupo]').forEach((btn) => {
    btn.addEventListener('click', () => { state.grupoConcluindoId = null; render(); });
  });
  document.querySelectorAll('[data-confirmar-conclusao-grupo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const grupoId = btn.dataset.confirmarConclusaoGrupo;
      const ordensDoGrupo = state.ordensCorte.filter((o) => o.grupoId === grupoId);
      const itensTotais = [];
      for (let i = 0; i < 7; i++) {
        const produtoId = document.getElementById(`grupoItemProduto-${grupoId}-${i}`)?.value;
        const quantidade = Number(document.getElementById(`grupoItemQtd-${grupoId}-${i}`)?.value);
        if (produtoId && quantidade > 0) itensTotais.push({ produtoId, quantidade });
      }
      if (itensTotais.length === 0) { alert('Informe pelo menos um modelo e a quantidade de peças.'); return; }
      // não divide nada por cor — grava o total combinado numa ordem "representante" do
      // grupo (a primeira), e só marca as outras cores do mesmo grupo como concluídas junto,
      // sem itens próprios. A separação por cor de verdade só acontece quando a costureira
      // devolver as peças prontas, lá em "Registrar produção" (onde já dá pra escolher a cor)
      const [representante, ...outras] = ordensDoGrupo;
      await concluirOrdemCorte(representante.id, itensTotais);
      for (const outra of outras) {
        await concluirOrdemCorte(outra.id, []);
      }
      state.grupoConcluindoId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-aplicar-custo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const produto = state.produtos.find((p) => p.id === btn.dataset.aplicarCusto);
      if (!produto) return;
      const novoCusto = Number(btn.dataset.custo);
      await updateProduto(produto.id, { nome: produto.nome, sku: produto.sku, estoqueAtual: produto.estoqueAtual, estoqueMinimo: produto.estoqueMinimo, custoUnitario: novoCusto, custoEstimado: false, valorMaoObra: produto.valorMaoObra });
      await loadData();
    });
  });

  const toggleCompraInsumo = document.getElementById('toggleCompraInsumo');
  if (toggleCompraInsumo) toggleCompraInsumo.addEventListener('click', () => {
    state.showCompraInsumoForm = !state.showCompraInsumoForm;
    window.__insumoNovo = false;
    window.__insumoSelecionado = '';
    window.__insumoNomeNovoTexto = '';
    render();
  });

  const insumoSelect = document.getElementById('insumoSelect');
  if (insumoSelect) insumoSelect.addEventListener('change', (e) => {
    window.__insumoSelecionado = e.target.value;
    window.__insumoNovo = e.target.value === '__novo__';
    render();
  });

  const insumoNomeNovoInput = document.getElementById('insumoNomeNovo');
  if (insumoNomeNovoInput) insumoNomeNovoInput.addEventListener('input', (e) => { window.__insumoNomeNovoTexto = e.target.value; });

  const salvarCompraInsumo = document.getElementById('salvarCompraInsumo');
  if (salvarCompraInsumo) salvarCompraInsumo.addEventListener('click', async () => {
    const selecionado = document.getElementById('insumoSelect').value;
    const nome = selecionado === '__novo__'
      ? document.getElementById('insumoNomeNovo').value.trim()
      : selecionado.trim();
    const quantidade = parseBRNumber(document.getElementById('insumoQuantidade').value);
    const unidade = document.getElementById('insumoUnidade').value;
    const valor = parseBRNumber(document.getElementById('insumoValor').value);
    const categoria = document.getElementById('insumoCategoria').value;
    const data = document.getElementById('insumoData').value || todayStr();
    const historico = document.getElementById('insumoHistorico')?.checked;
    const cartaoId = document.getElementById('insumoCartaoSelect')?.value;
    const cartao = cartaoId ? state.cartoesCredito.find((cc) => cc.id === cartaoId) : null;
    const numParcelas = cartao ? (Number(document.getElementById('insumoNumParcelas').value) || 1) : 1;
    if (!nome || !quantidade || quantidade <= 0 || !valor) { alert('Selecione ou digite o insumo, e preencha quantidade e valor.'); return; }
    await comprarInsumo(nome, unidade, quantidade, valor, categoria, data, !historico, numParcelas, cartao);
    state.showCompraInsumoForm = false;
    window.__insumoNovo = false;
    window.__insumoSelecionado = '';
    window.__insumoNomeNovoTexto = '';
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

  document.querySelectorAll('[data-toggle-envio]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleEnvio;
      const atual = btn.dataset.envio === 'true';
      await toggleInsumoUsadoNoEnvio(id, !atual);
      await loadData();
    });
  });

  document.querySelectorAll('[data-config-envio]').forEach((btn) => {
    btn.addEventListener('click', () => { state.configEnvioInsumoId = btn.dataset.configEnvio; render(); });
  });
  document.querySelectorAll('[data-cancelar-qtd-envio]').forEach((btn) => {
    btn.addEventListener('click', () => { state.configEnvioInsumoId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-qtd-envio]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const insumoId = btn.dataset.salvarQtdEnvio;
      const valores = {};
      state.plataformas.forEach((plat) => {
        const val = Number(document.getElementById(`qtdEnvio-${insumoId}-${plat.id}`)?.value) || 1;
        valores[plat.id] = val;
      });
      const qtdManual = Number(document.getElementById(`qtdEnvioManual-${insumoId}`)?.value) || 1;
      await salvarQtdPorPlataforma(insumoId, valores);
      await salvarQtdVendaManual(insumoId, qtdManual);
      state.configEnvioInsumoId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-editar-insumo]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingInsumoId = btn.dataset.editarInsumo; render(); });
  });
  document.querySelectorAll('[data-cancelar-edit-insumo]').forEach((btn) => {
    btn.addEventListener('click', () => { state.editingInsumoId = null; render(); });
  });
  document.querySelectorAll('[data-salvar-edit-insumo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditInsumo;
      const nome = document.getElementById(`editInsumoNome-${id}`).value.trim();
      const qtd = parseBRNumber(document.getElementById(`editInsumoQtd-${id}`).value);
      const custo = parseBRNumber(document.getElementById(`editInsumoCusto-${id}`).value);
      const minimo = parseBRNumber(document.getElementById(`editInsumoMinimo-${id}`).value);
      if (!nome) { alert('Informe o nome do insumo.'); return; }
      await updateInsumo(id, nome, qtd, custo, minimo);
      state.editingInsumoId = null;
      await loadData();
    });
  });
  // custo médio = valor total ÷ quantidade, recalculado ao digitar
  if (state.editingInsumoId) {
    const id = state.editingInsumoId;
    const valorInput = document.getElementById(`editInsumoValorTotal-${id}`);
    const qtdInput = document.getElementById(`editInsumoQtd-${id}`);
    const custoInput = document.getElementById(`editInsumoCusto-${id}`);
    if (valorInput && qtdInput && custoInput) {
      const recalcularCustoInsumo = () => {
        const valor = parseBRNumber(valorInput.value);
        const qtd = parseBRNumber(qtdInput.value);
        if (valor > 0 && qtd > 0) custoInput.value = (valor / qtd).toFixed(2).replace('.', ',');
      };
      valorInput.addEventListener('input', recalcularCustoInsumo);
      qtdInput.addEventListener('input', recalcularCustoInsumo);
    }
  }

  document.querySelectorAll('[data-abrir-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.distribuindoOrdemId = btn.dataset.abrirDistribuicao; render(); });
  });
  document.querySelectorAll('[data-fechar-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', () => { state.distribuindoOrdemId = null; render(); });
  });
  document.querySelectorAll('[data-dist-variante-select]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const itemId = sel.dataset.distVarianteSelect;
      const inputNova = document.getElementById(`distVarianteNova-${itemId}`);
      const divMisto = document.getElementById(`distMisto-${itemId}`);
      if (inputNova) inputNova.style.display = sel.value === '__nova__' ? '' : 'none';
      if (divMisto) divMisto.style.display = sel.value === '__misto__' ? '' : 'none';
    });
  });

  document.querySelectorAll('[data-confirmar-distribuicao]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.confirmarDistribuicao;
      const produtoId = btn.dataset.produto;
      const costureiraId = document.getElementById(`distCostureira-${itemId}`).value;
      const restante = Number(btn.dataset.restante);
      const varianteSelect = document.getElementById(`distVariante-${itemId}`);
      let varianteId = varianteSelect ? varianteSelect.value : '';
      if (!costureiraId) { alert('Selecione a costureira.'); return; }

      if (varianteId === '__misto__') {
        const vs = variantesDoProduto(produtoId);
        const porCor = vs.map((v) => ({ varianteId: v.id, qtd: Number(document.getElementById(`distMistoQtd-${itemId}-${v.id}`)?.value) || 0 })).filter((x) => x.qtd > 0);
        const total = porCor.reduce((a, x) => a + x.qtd, 0);
        if (total <= 0) { alert('Informe a quantidade de pelo menos uma cor.'); return; }
        if (total > restante) { alert(`Só restam ${restante} peça(s) desse modelo pra distribuir.`); return; }
        for (const x of porCor) {
          await distribuirPecas(itemId, produtoId, x.varianteId, costureiraId, x.qtd, todayStr());
        }
        await loadData();
        return;
      }

      const quantidade = Number(document.getElementById(`distQtd-${itemId}`).value);
      if (!quantidade || quantidade <= 0) { alert('Informe a quantidade.'); return; }
      if (quantidade > restante) { alert(`Só restam ${restante} peça(s) desse modelo pra distribuir.`); return; }
      if (varianteId === '__nova__') {
        const nomeCor = document.getElementById(`distVarianteNova-${itemId}`).value.trim();
        if (!nomeCor) { alert('Digite o nome da cor nova.'); return; }
        const criada = await addVariante(produtoId, nomeCor, '');
        if (!criada) return;
        varianteId = criada.id;
      }
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

    const toggleResumo = document.getElementById('toggleResumoPorDia');
    if (toggleResumo) toggleResumo.addEventListener('click', () => { state.mostrarResumoPorDia = !state.mostrarResumoPorDia; render(); });

    document.querySelectorAll('[data-prod-detalhe-tipo]').forEach((btn) => {
      btn.addEventListener('click', () => { window.__prodDetalheTipo = btn.dataset.prodDetalheTipo; window.__prodFormMotivoDefeito = null; render(); });
    });

    const detalheMotivoSelect = document.getElementById('detalheMotivoDefeito');
    if (detalheMotivoSelect) detalheMotivoSelect.addEventListener('change', (e) => { window.__prodFormMotivoDefeito = e.target.value; render(); });

    const detalheProdutoSelect = document.getElementById('detalheProduto');
    if (detalheProdutoSelect) detalheProdutoSelect.addEventListener('change', (e) => { window.__prodFormProdutoId = e.target.value; render(); });

    const salvarDetalhe = document.getElementById('salvarDetalheProducao');
    if (salvarDetalhe) salvarDetalhe.addEventListener('click', async () => {
      if (salvarDetalhe.disabled) return; // já está salvando, ignora clique duplicado
      const costureiraId = salvarDetalhe.dataset.costureira;
      const produtoId = document.getElementById('detalheProduto').value;
      const varianteSelect = document.getElementById('detalheVariante');
      const varianteId = varianteSelect ? varianteSelect.value : '';
      let quantidade = Number(document.getElementById('detalheQuantidade').value);
      const data = document.getElementById('detalheData').value || todayStr();
      const tipo = window.__prodDetalheTipo || 'producao';
      const jaPago = document.getElementById('detalheJaPago')?.checked;
      const origemSelect = document.getElementById('detalheOrigemDistribuicao');
      const origemValor = origemSelect ? origemSelect.value : '';
      const origemDistribuicaoId = origemValor.startsWith('lote:') ? origemValor.slice(5) : null;
      const origemVarianteId = origemDistribuicaoId ? undefined : (origemValor === '__sem_cor__' ? null : (origemValor || undefined));
      if (!produtoId || !quantidade || quantidade <= 0) { alert('Selecione o produto e informe a quantidade.'); return; }
      // pra peça boa precisa saber a cor (vai somar estoque dela). Pra defeito não precisa —
      // não mexe em estoque de cor nenhuma, e às vezes nem dá pra saber qual cor deu defeito
      if (tipo === 'producao' && varianteSelect && !varianteId) { alert('Selecione a cor.'); return; }
      let motivoDefeito = null;
      let valorAjuste = null;
      if (tipo === 'defeito') {
        motivoDefeito = document.getElementById('detalheMotivoDefeito')?.value || '';
        if (!motivoDefeito) { alert('Selecione o motivo do defeito.'); return; }
        quantidade = -quantidade;
        if (motivoDefeito === 'costureira') {
          const valorDigitado = parseBRNumber(document.getElementById('detalheValorDesconto')?.value || '');
          if (valorDigitado > 0) {
            valorAjuste = -valorDigitado;
          } // se deixar em branco, valorAjuste fica null e usa o valor normal da peça (comportamento padrão)
        } else {
          valorAjuste = 0; // erro de corte/tecido ou outro motivo: não desconta nada dela
        }
      }
      const textoOriginalBtn = salvarDetalhe.textContent;
      salvarDetalhe.disabled = true;
      salvarDetalhe.textContent = 'Salvando...';
      await registrarProducao(costureiraId, produtoId, quantidade, data, varianteId || null, jaPago, origemVarianteId, motivoDefeito, valorAjuste, origemDistribuicaoId);
      state.showProducaoForm = false;
      window.__prodDetalheTipo = 'producao';
      window.__prodFormProdutoId = null;
      window.__prodFormMotivoDefeito = null;
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

  // ---- Tela de peças em produção por modelo/cor ----
  if (state.mostrarPecasPorModelo) {
    const voltar = document.getElementById('voltarPecasPorModelo');
    if (voltar) voltar.addEventListener('click', () => { state.mostrarPecasPorModelo = false; state.modeloExpandido = null; render(); });
    document.querySelectorAll('[data-toggle-modelo]').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.toggleModelo);
        state.modeloExpandido = state.modeloExpandido === idx ? null : idx;
        render();
      });
    });
    return;
  }

  // ---- Tela principal de Produção ----
  const abrirPecasPorModelo = document.getElementById('abrirPecasPorModelo');
  if (abrirPecasPorModelo) abrirPecasPorModelo.addEventListener('click', () => { state.mostrarPecasPorModelo = true; render(); });

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
        await updateProduto(p.id, { nome: p.nome, sku: p.sku, estoqueAtual: p.estoqueAtual, estoqueMinimo: p.estoqueMinimo, custoUnitario: p.custoUnitario, custoEstimado: p.custoEstimado, valorMaoObra: novoValor });
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
      if (e.target.closest('[data-remover-costureira]') || e.target.closest('[data-editar-costureira]')) return;
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

  document.querySelectorAll('[data-gerar-numero-costureira]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await gerarNumeroIdentificacaoRetroativo(btn.dataset.gerarNumeroCostureira);
      await loadData();
    });
  });

  document.querySelectorAll('[data-editar-costureira]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.editingCostureiraId = btn.dataset.editarCostureira;
      render();
    });
  });
  document.querySelectorAll('[data-cancelar-edit-costureira]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.editingCostureiraId = null;
      render();
    });
  });
  document.querySelectorAll('[data-salvar-edit-costureira]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.salvarEditCostureira;
      const nome = document.getElementById(`editCostNome-${id}`).value.trim();
      const numero = document.getElementById(`editCostNumero-${id}`).value.trim();
      const meta = Number(document.getElementById(`editCostMeta-${id}`).value) || 0;
      const ativa = document.getElementById(`editCostAtiva-${id}`).checked;
      if (!nome) { alert('Informe o nome da costureira.'); return; }
      if (numero && ativa) {
        const conflito = state.costureiras.find((c) => c.id !== id && c.ativa && c.numeroIdentificacao === numero);
        if (conflito && !confirm(`O número "${numero}" já está em uso por ${conflito.nome} (ativa). Se continuar, as duas vão compartilhar o mesmo número nas fichas — isso não quebra o sistema (o número de série de cada ficha continua único), mas pode confundir na hora de identificar de olho qual costureira é qual. Continuar mesmo assim?`)) return;
      }
      await updateCostureira(id, nome, ativa, meta, numero);
      state.editingCostureiraId = null;
      await loadData();
    });
  });

  document.querySelectorAll('[data-pagar-costureira]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ids = btn.dataset.ids.split(',');
      const valorProducao = Number(btn.dataset.valor);
      const nome = btn.dataset.nome;
      const costureiraId = btn.dataset.pagarCostureira;
      const desconto = parseBRNumber(document.getElementById(`descontoVale-${costureiraId}`)?.value || '0');
      const dataPagamento = document.getElementById(`dataPagamento-${costureiraId}`)?.value || todayStr();
      const valorReal = Math.max(0, valorProducao - desconto);
      const mensagem = desconto > 0
        ? `Confirmar pagamento de ${nome}?\n\nProdução da semana: ${fmt(valorProducao)}\nDesconto de vale: -${fmt(desconto)}\nValor que sai da conta: ${fmt(valorReal)}\nData no Financeiro: ${new Date(dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR')}\n\nIsso marca toda a produção como paga (não vai mais acumular com a próxima semana), mas só lança ${fmt(valorReal)} no Financeiro.`
        : `Confirmar pagamento de ${fmt(valorProducao)} pra ${nome}, com data de ${new Date(dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR')} no Financeiro?`;
      if (!confirm(mensagem)) return;
      await marcarProducaoPaga(ids);
      await addTx({
        tipo: 'saida', valor: valorReal, categoria: 'Mão de obra — produção', natureza: 'variavel',
        descricao: desconto > 0 ? `Produção — ${nome} (${fmt(valorProducao)} produzido, ${fmt(desconto)} descontado de vale)` : `Produção — ${nome}`, data: dataPagamento,
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

  const toggleForaDeLinha = document.getElementById('toggleForaDeLinha');
  if (toggleForaDeLinha) toggleForaDeLinha.addEventListener('click', () => { state.estoqueMostrarForaLinha = !state.estoqueMostrarForaLinha; render(); });

  document.querySelectorAll('[data-aplicar-ultimo-corte]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const produto = state.produtos.find((p) => p.id === btn.dataset.aplicarUltimoCorte);
      if (!produto) return;
      const novoCusto = Number(btn.dataset.valor);
      await updateProduto(produto.id, { nome: produto.nome, sku: produto.sku, estoqueAtual: produto.estoqueAtual, estoqueMinimo: produto.estoqueMinimo, custoUnitario: novoCusto, custoEstimado: false, valorMaoObra: produto.valorMaoObra });
      await loadData();
    });
  });

  document.querySelectorAll('[data-toggle-ativo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.toggleAtivo;
      const ativoAtual = btn.dataset.ativo === 'true';
      const novoAtivo = !ativoAtual;
      if (!novoAtivo && !confirm('Tirar esse produto de linha? Ele some da lista principal, mas todo o histórico continua guardado — você pode reativar quando quiser.')) return;
      await toggleProdutoAtivo(id, novoAtivo);
      await loadData();
    });
  });

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

  const toggleSemCor = document.getElementById('toggleProdutosSemCor');
  if (toggleSemCor) toggleSemCor.addEventListener('click', () => { state.showProdutosSemCor = !state.showProdutosSemCor; render(); });

  document.querySelectorAll('[data-editar-sem-cor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.showProdutosSemCor = false;
      state.estoqueBusca = btn.dataset.nomeProduto;
      state.editingProdutoId = btn.dataset.editarSemCor;
      window.__editProdutoTipo = null;
      render();
    });
  });

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
    const custoEstimado = document.getElementById('pCustoEstimado')?.checked || false;
    const valorMaoObra = parseBRNumber(document.getElementById('pMaoObra').value);
    const tipo = window.__novoProdutoTipo || 'unitario';
    if (!nome) { alert('Informe o nome do produto.'); return; }

    const cores = [];
    for (let i = 0; i < (window.__numCoresNovoProduto || 5); i++) {
      const corNome = document.getElementById(`pCorNome-${i}`)?.value.trim();
      const corSku = document.getElementById(`pCorSku-${i}`)?.value.trim();
      if (corNome) cores.push({ nome: corNome, sku: corSku });
    }

    const produtoCriado = await addProduto({ nome, sku, estoqueAtual: cores.length ? 0 : estoqueAtual, estoqueMinimo, custoUnitario, custoEstimado, valorMaoObra, tipo });
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
  document.querySelectorAll('[data-var-editar]').forEach((input) => {
    const salvar = async () => {
      const atual = Number(input.dataset.atual) || 0;
      const novo = calcularNovoValorEstoque(input.value, atual);
      await updateVarianteEstoque(input.dataset.varEditar, novo);
      await loadData();
    };
    input.addEventListener('change', salvar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });
  document.querySelectorAll('[data-var-sku-editar]').forEach((input) => {
    input.addEventListener('change', async () => {
      await updateVarianteSku(input.dataset.varSkuEditar, input.value.trim());
      await loadData();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
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
  document.querySelectorAll('[data-produto-editar]').forEach((input) => {
    const salvar = async () => {
      const atual = Number(input.dataset.atual) || 0;
      const novo = calcularNovoValorEstoque(input.value, atual);
      await updateProdutoEstoque(input.dataset.produtoEditar, novo);
      await loadData();
    };
    input.addEventListener('change', salvar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
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
  document.querySelectorAll('[data-ir-para-ficha]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = 'ficha';
      state.editingFichaTecnicaId = btn.dataset.irParaFicha;
      state.editingProdutoId = null;
      render();
    });
  });
  document.querySelectorAll('[data-toggle-eh-kit]').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      window.__editProdutoEhKit = window.__editProdutoEhKit || {};
      window.__editProdutoEhKit[chk.dataset.toggleEhKit] = e.target.checked;
      render();
    });
  });
  document.querySelectorAll('[data-salvar-edit-produto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.salvarEditProduto;
      const nome = document.getElementById(`editPNome-${id}`).value.trim();
      const sku = document.getElementById(`editPSku-${id}`).value.trim();
      const estoqueAtual = Number(document.getElementById(`editPEstoqueAtual-${id}`).value) || 0;
      const estoqueMinimo = Number(document.getElementById(`editPEstoqueMinimo-${id}`).value) || 0;
      const produtoOriginal = state.produtos.find((p) => p.id === id);
      // custo e mão de obra não se editam mais aqui — preserva o que já estava salvo
      const custoUnitario = produtoOriginal?.custoUnitario || 0;
      const custoEstimado = produtoOriginal?.custoEstimado || false;
      const valorMaoObra = produtoOriginal?.valorMaoObra || 0;
      const tipo = window.__editProdutoTipo || produtoOriginal?.tipo || 'unitario';
      if (!nome) { alert('Informe o nome do produto.'); return; }
      await updateProduto(id, { nome, sku, estoqueAtual, estoqueMinimo, custoUnitario, custoEstimado, valorMaoObra, tipo });

      const ehKit = window.__editProdutoEhKit?.[id] ?? produtoOriginal?.ehKit;
      if (ehKit) {
        const componentes = [];
        for (let i = 0; i < 4; i++) {
          const valor = document.getElementById(`editKitComp-${id}-${i}`)?.value;
          const qtd = Number(document.getElementById(`editKitCompQtd-${id}-${i}`)?.value) || 0;
          if (valor && qtd > 0) {
            const [produtoId, varianteId] = valor.split('|');
            componentes.push({ produtoId, varianteId: varianteId || null, quantidade: qtd });
          }
        }
        if (componentes.length === 0) { alert('Marcou como kit mas não escolheu nenhum componente — configure pelo menos um componente com quantidade.'); return; }
        await salvarComponentesKit(id, componentes);
      } else if (produtoOriginal?.ehKit) {
        await salvarComponentesKit(id, []);
      }

      state.editingProdutoId = null;
      window.__editProdutoTipo = null;
      if (window.__editProdutoEhKit) delete window.__editProdutoEhKit[id];
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

// link direto pra funcionária bater ponto: rosa-julieta-app.vercel.app/?ponto=1
// pula direto pra tela de PIN, sem precisar clicar em "Sou funcionária"
if (new URLSearchParams(window.location.search).get('ponto')) {
  window.__gateModoPonto = true;
}

// Segurança: se já existe sessão salva (a pessoa já tinha feito login antes), carrega
// tudo normalmente. Se ainda não, NÃO busca o financeiro/estoque/produção — só o mínimo
// (funcionárias) pra tela de gate conseguir validar o PIN de ponto. O resto só entra
// depois que o código de acesso ou o PIN forem confirmados (ver renderGate).
(async () => {
  if (state.papel) {
    await loadData();
    await garantirRecorrentes();
    setupRealtime();
  } else {
    await loadFuncionariasParaGate();
  }
})();
