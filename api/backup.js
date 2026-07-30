// Captura qualquer erro já na hora de carregar a biblioteca do Supabase —
// se isso falhar silenciosamente, a função crasha sem log nenhum. Isolando
// aqui, garantimos uma resposta com a mensagem real do erro.
let createClient;
let erroAoCarregar = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (err) {
  erroAoCarregar = err;
}

// Todas as tabelas do sistema Rosa Julieta
const TABELAS = [
  'produtos',
  'variantes',
  'transacoes',
  'plataformas',
  'costureiras',
  'producoes',
  'materia_prima',
  'ordens_corte',
  'ordens_corte_itens',
  'insumos',
  'distribuicoes',
  'ficha_tecnica_itens',
  'insumo_plataforma_qtd',
  'funcionarias',
  'pontos',
  'ferias_tiradas',
  'solicitacoes_ponto',
  'horas_extras_liquidadas',
  'banco_horas_lancamentos',
  'emprestimos',
  'emprestimo_parcelas',
  'cartoes_credito'
];

const RETENCAO_DIAS = 30; // apaga backups com mais de 30 dias pra não estourar o limite de storage

module.exports = async (req, res) => {
  if (erroAoCarregar) {
    return res.status(500).json({
      status: 'erro',
      etapa: 'carregar biblioteca @supabase/supabase-js',
      mensagem: erroAoCarregar.message,
      stack: erroAoCarregar.stack,
    });
  }

  try {
    // MODO TESTE TEMPORÁRIO: acessando com ?debug=1 na URL, pula a checagem de senha,
    // só pra ver a mensagem de erro direto no navegador. Remover depois de resolver o problema.
    const modoDebug = req.query && req.query.debug === '1';
    const auth = req.headers['authorization'];
    if (!modoDebug && auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Variáveis de ambiente do Supabase não configuradas' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const dump = { gerado_em: new Date().toISOString(), tabelas: {} };
    const tabelasComErro = [];

    for (const tabela of TABELAS) {
      const { data, error } = await supabase.from(tabela).select('*');
      if (error) {
        tabelasComErro.push(`${tabela}: ${error.message}`);
        continue;
      }
      dump.tabelas[tabela] = data;
    }

    const agora = new Date();
    const dataHora = agora.toISOString().slice(0, 16).replace('T', '_').replace(':', 'h') + 'm';
    const nomeArquivo = `backup-${dataHora}.json`;

    const { error: uploadError } = await supabase.storage
      .from('backups')
      .upload(nomeArquivo, JSON.stringify(dump, null, 2), {
        contentType: 'application/json',
        upsert: false
      });

    if (uploadError) throw new Error(`Erro ao salvar backup no Storage: ${uploadError.message}`);

    const { data: arquivos, error: listError } = await supabase.storage.from('backups').list();
    let removidos = 0;

    if (!listError && arquivos) {
      const limite = new Date();
      limite.setDate(limite.getDate() - RETENCAO_DIAS);

      const antigos = arquivos
        .filter((f) => f.created_at && new Date(f.created_at) < limite)
        .map((f) => f.name);

      if (antigos.length > 0) {
        await supabase.storage.from('backups').remove(antigos);
        removidos = antigos.length;
      }
    }

    return res.status(200).json({
      status: 'ok',
      arquivo: nomeArquivo,
      tabelas_salvas: TABELAS.length - tabelasComErro.length,
      tabelas_com_erro: tabelasComErro,
      backups_antigos_removidos: removidos
    });
  } catch (err) {
    return res.status(500).json({ status: 'erro', etapa: 'execução', mensagem: err.message, stack: err.stack });
  }
};
