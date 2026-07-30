const { createClient } = require('@supabase/supabase-js');

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
  // Só aceita a chamada se vier com o CRON_SECRET certo
  // (a Vercel envia isso sozinha quando dispara o cron job)
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Variáveis de ambiente do Supabase não configuradas' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const dump = { gerado_em: new Date().toISOString(), tabelas: {} };
    const tabelasComErro = [];

    for (const tabela of TABELAS) {
      const { data, error } = await supabase.from(tabela).select('*');
      if (error) {
        // não derruba o backup inteiro se UMA tabela nova ainda não existir no banco —
        // só registra o aviso e segue salvando o resto
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

    // Limpeza: remove backups mais antigos que RETENCAO_DIAS
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
    return res.status(500).json({ status: 'erro', mensagem: err.message });
  }
};
