// ============================================================
// CASA OLIVEIRA - APPS SCRIPT API
//
// COMO ATUALIZAR:
// 1. Abra: docs.google.com/spreadsheets/d/12HfN3lxg-JVC-vT7_4FXC334xAakItc5jjYQt8lyCWk
// 2. Extensoes -> Apps Script
// 3. Apague tudo e cole este codigo
// 4. Salve (Ctrl+S)
// 5. Implantar -> Gerenciar implantacoes -> editar (lapis) ->
//    Versao: "Nova vers\u00e3o" -> Implantar
//    (NAO crie uma implantacao nova: o URL mudaria e o sistema pararia)
//
// As senhas em texto puro que ja estao na planilha sao convertidas para
// hash sozinhas, no primeiro login de cada pessoa. Ninguem precisa
// cadastrar senha de novo.
// ============================================================

const SHEET_ID = '12HfN3lxg-JVC-vT7_4FXC334xAakItc5jjYQt8lyCWk';

// Endereco do sistema publicado - usado no e-mail de convite
const URL_SISTEMA = 'https://gocosta24-code.github.io/sistema/';

function getSpreadsheet() {
  try { return SpreadsheetApp.openById(SHEET_ID); }
  catch(e) { return SpreadsheetApp.getActiveSpreadsheet(); }
}

const ABAS = {
  pacientes:      'Pacientes',
  profissionais:  'Profissionais',
  pts:            'PTS',
  avaliacoes:     'Avaliacoes',
  reunioes:       'Reunioes',
  alertas:        'Alertas',
  monitoramentos: 'Monitoramentos',
  checklists:     'Checklists',
  evolucoes:      'Evolucoes',
  espera:         'ListaEspera',
  servicos:       'Servicos',
  catalogo:       'Catalogo',
  leads:          'Leads',
  lead_historico: 'LeadHistorico',
  programas:      'Programas',
  myscore:        'MyScore',
  atelie:         'Atelie',
  documentos:     'Documentos',
  mensagens:      'Mensagens',
  orcamentos:     'Orcamentos',
  exercicios:     'Exercicios',
  prescricoes:    'Prescricoes',
};

// Onde os anexos ficam guardados no Drive da clinica. A pasta e criada
// sozinha na primeira vez; cada paciente ganha uma subpasta.
const PASTA_DOCS = 'Casa Oliveira - Documentos';

// Limite por arquivo. O Apps Script aceita ~10 MB de requisicao e o base64
// engorda o arquivo em cerca de um terco, entao 6 MB de PDF ainda cabe com
// folga.
const MAX_ARQUIVO_MB = 6;

// --- ENTRY POINTS --------------------------------------------
function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    const params = e.parameter || {};
    let body = {};
    // Priority 1: GET ?data= param (main method - no CORS issues)
    if (params.data) {
      try { body = JSON.parse(decodeURIComponent(params.data)); } catch(ex) {}
    }
    // Priority 2: POST body (fallback)
    if (!body.action && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch(ex) {}
    }
    // Priority 3: individual GET params
    const action = body.action || params.action;
    const token  = body.token  || params.token;

    // Recuperacao de senha roda sem sessao - quem esqueceu a senha nao tem token
    const SEM_LOGIN = ['login','login_paciente','solicitar_reset','redefinir_senha'];
    if (SEM_LOGIN.indexOf(action) === -1 && !validarToken(token)) {
      return resp({ok:false, erro:'Token inv\u00e1lido ou expirado'});
    }

    // Conta de paciente so alcanca o proprio prontuario. A permissao e
    // decidida aqui pelo que esta gravado no token, nunca pelo que o
    // navegador diz ser - senao bastaria forjar o pedido para ler a ficha
    // de outra pessoa.
    const ACOES_PACIENTE = ['logout','meu_prontuario','minha_posicao','alterar_senha_paciente',
                            'meus_documentos','baixar_documento','minhas_mensagens','enviar_mensagem',
                            'meus_exercicios'];
    if (SEM_LOGIN.indexOf(action) === -1) {
      const info = getInfoToken(token);
      const ehPaciente = info && info.role === 'paciente';
      if (ehPaciente && ACOES_PACIENTE.indexOf(action) === -1) {
        return resp({ok:false, erro:'Sem permiss\u00e3o'});
      }
      if (!ehPaciente && ACOES_PACIENTE.indexOf(action) !== -1 && action !== 'logout') {
        return resp({ok:false, erro:'Esta \u00e1rea \u00e9 do paciente'});
      }
    }

    // O CRUD generico nao confere papel: quem esta logado escreve em qualquer
    // aba. Para o catalogo isso nao serve - e cadastro da clinica, nao
    // registro de atendimento -, entao a escrita e barrada aqui, no servidor,
    // e nao so escondendo o botao na tela.
    if (ACOES_ESCRITA.indexOf(action) !== -1 && ABAS_SO_GESTAO.indexOf(body.tabela) !== -1) {
      const perfil = perfilDaEquipe(token);
      if (!perfil || perfil.role !== 'admin') {
        return resp({ok:false, erro:'S\u00f3 a gest\u00e3o pode alterar o cat\u00e1logo'});
      }
    }

    switch(action) {
      case 'login':           return resp(login(body));
      case 'login_paciente':  return resp(loginPaciente(body));
      case 'logout':          return resp(logout(token));
      case 'solicitar_reset': return resp(solicitarReset(body));
      case 'redefinir_senha': return resp(redefinirSenha(body));
      case 'meu_prontuario':  return resp(meuProntuario(token));
      case 'minha_posicao':   return resp(minhaPosicao(token));
      case 'alterar_senha_paciente': return resp(alterarSenhaPaciente(body, token));
      case 'listar':        return resp(listar(body));
      case 'salvar':        return resp(salvar(body));
      case 'atualizar':     return resp(atualizar(body));
      case 'deletar':       return resp(deletar(body));
      case 'listar_profs':  return resp(listarProfs(token));
      case 'convidar_prof': return resp(convidarProf(body, token));
      case 'alterar_senha': return resp(alterarSenha(body, token));
      case 'dar_acesso_paciente': return resp(darAcessoPaciente(body, token));
      case 'meus_documentos':   return resp(meusDocumentos(token));
      case 'baixar_documento':  return resp(baixarDocumento(body, token));
      case 'enviar_documento':  return resp(enviarDocumento(body, token));
      case 'excluir_documento': return resp(excluirDocumento(body, token));
      case 'minhas_mensagens':  return resp(minhasMensagens(token));
      case 'enviar_mensagem':   return resp(enviarMensagem(body, token));
      case 'mensagens_paciente':return resp(mensagensPaciente(body, token));
      case 'mensagens_abertas': return resp(mensagensAbertas(token));
      case 'listar_catalogo':   return resp(listarCatalogo(token));
      case 'listar_leads':      return resp(listarLeads(token));
      case 'salvar_lead':       return resp(salvarLead(body, token));
      case 'mover_lead':        return resp(moverLead(body, token));
      case 'historico_lead':    return resp(historicoLead(body, token));
      case 'converter_lead':    return resp(converterLead(body, token));
      case 'marcar_mensagem':   return resp(marcarMensagem(body, token));
      case 'obter_config':      return resp(obterConfig(token));
      case 'salvar_config':     return resp(salvarConfigClinica(body, token));
      case 'gerar_orcamento':   return resp(gerarOrcamento(body, token));
      case 'meus_exercicios':   return resp(meusExercicios(token));
      default:              return resp({ok:false, erro:'A\u00e7\u00e3o desconhecida: '+action});
    }
  } catch(err) {
    return resp({ok:false, erro:err.toString()});
  }
}

// --- SENHAS ---------------------------------------------------
// O e-mail entra no hash como salt: duas pessoas com a mesma senha
// geram hashes diferentes.
function hashSenha(email, senha) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(email).toLowerCase().trim() + ':' + String(senha),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(b){
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function pareceHash(v) {
  return /^[0-9a-f]{64}$/.test(String(v||''));
}

// Sem caracteres ambiguos (0/O, 1/l/I) - a pessoa digita isto vindo do e-mail
function gerarSenha() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i=0;i<10;i++) s += chars.charAt(Math.floor(Math.random()*chars.length));
  return s;
}

// Aceita o hash novo e, durante a transicao, a senha em texto puro que
// ainda estiver gravada. Devolve se bateu e se precisa migrar.
function conferirSenha(email, guardada, informada) {
  if (!guardada) return {ok:true, migrar:true};   // conta sem senha definida
  if (pareceHash(guardada)) {
    return {ok: guardada === hashSenha(email, informada), migrar:false};
  }
  return {ok: String(guardada) === String(informada), migrar:true};
}

// --- AUTH -----------------------------------------------------
function login(body) {
  const email = (body.email||'').toLowerCase().trim();
  const senha = body.senha||'';
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');
  const iSenha = h.indexOf('senha_hash');
  const iNome  = h.indexOf('nome');
  const iRole  = h.indexOf('nivel_acesso');
  const iFuncao= h.indexOf('funcao');
  const iId    = h.indexOf('id');
  const iStatus= h.indexOf('status');

  for (let i=1;i<dados.length;i++) {
    const row = dados[i];
    if ((row[iEmail]||'').toLowerCase().trim() === email) {
      if ((row[iStatus]||'').toLowerCase() === 'inativo') return {ok:false,erro:'Conta inativa'};

      const check = conferirSenha(email, row[iSenha], senha);
      if (!check.ok) return {ok:false,erro:'Senha incorreta'};

      // Migra a senha em texto puro para hash no primeiro login
      if (check.migrar && senha) {
        sheet.getRange(i+1, iSenha+1).setValue(hashSenha(email, senha));
      }

      const token = Utilities.base64Encode(email+':'+Date.now()+':'+Math.random());
      salvarToken(token, email, row[iRole]||'profissional');
      return {ok:true, token, usuario:{id:row[iId],nome:row[iNome],email:row[iEmail],
                                      role:row[iRole]||'profissional',
                                      funcao:(iFuncao===-1?'':row[iFuncao])||''}};
    }
  }
  return {ok:false, erro:'E-mail n\u00e3o encontrado'};
}

function logout(token) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Tokens');
  if (!sheet) return {ok:true};
  const dados = sheet.getDataRange().getValues();
  for (let i=dados.length-1;i>=1;i--) {
    if (dados[i][0]===token) sheet.deleteRow(i+1);
  }
  return {ok:true};
}

function salvarToken(token, email, role, refId) {
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Tokens');
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,5).setValues([['token','email','role','expira','ref_id']]);
  }
  const dados = sheet.getDataRange().getValues();
  // Remover tokens antigos deste email no mesmo papel: a equipe e o paciente
  // podem usar o mesmo e-mail sem derrubar um ao outro
  for (let i=dados.length-1;i>=1;i--) {
    if ((dados[i][1]||'').toLowerCase()===email.toLowerCase() &&
        String(dados[i][2]||'')===String(role)) sheet.deleteRow(i+1);
  }
  const expira = new Date(); expira.setDate(expira.getDate()+7);
  sheet.appendRow([token,email,role,expira.toISOString(), refId||'']);
}

function validarToken(token) {
  if (!token) return false;
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('Tokens');
    if (!sheet) return false;
    const dados = sheet.getDataRange().getValues();
    const agora = new Date();
    for (let i=1;i<dados.length;i++) {
      if (dados[i][0]===token && agora < new Date(dados[i][3])) return true;
    }
  } catch(e){}
  return false;
}

function getInfoToken(token) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('Tokens');
    if (!sheet) return null;
    const dados = sheet.getDataRange().getValues();
    for (let i=1;i<dados.length;i++) {
      if (dados[i][0]===token) return {email:dados[i][1], role:dados[i][2], refId:dados[i][4]||''};
    }
  } catch(e){}
  return null;
}

function alterarSenha(body, token) {
  const info = getInfoToken(token);
  if (!info) return {ok:false,erro:'Token inv\u00e1lido'};

  const nova = String(body.nova_senha||'');
  if (nova.length < 6) return {ok:false,erro:'A nova senha precisa ter ao menos 6 caracteres'};

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');
  const iSenha = h.indexOf('senha_hash');
  for (let i=1;i<dados.length;i++) {
    if ((dados[i][iEmail]||'').toLowerCase()===info.email.toLowerCase()) {
      // Sem esta conferencia, quem alcanca uma sessao aberta troca a senha
      const check = conferirSenha(info.email, dados[i][iSenha], String(body.senha_atual||''));
      if (!check.ok) return {ok:false,erro:'Senha atual incorreta'};

      sheet.getRange(i+1, iSenha+1).setValue(hashSenha(info.email, nova));
      return {ok:true};
    }
  }
  return {ok:false,erro:'Usu\u00e1rio n\u00e3o encontrado'};
}

// --- RECUPERACAO DE SENHA -------------------------------------
// Link de uso unico por e-mail, valido por 1 hora. Enviar uma senha nova
// pronta deixaria ela guardada na caixa de entrada para sempre.
const RESET_VALIDADE_MIN = 60;
const RESET_INTERVALO_MIN = 2;   // espera minima entre dois pedidos

function acharProfissional(email) {
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');
  for (let i=1;i<dados.length;i++) {
    if ((dados[i][iEmail]||'').toLowerCase().trim() === String(email).toLowerCase().trim()) {
      return {linha:i+1, row:dados[i], h:h, sheet:sheet};
    }
  }
  return null;
}

function solicitarReset(body) {
  const email = String(body.email||'').toLowerCase().trim();
  // Resposta sempre igual: dizer "e-mail n\u00e3o encontrado" revelaria quem
  // tem conta para qualquer pessoa que chutasse enderecos.
  const generica = {ok:true};
  if (!email) return generica;

  // A area do paciente usa o mesmo caminho: serve tanto para definir a senha
  // no primeiro acesso quanto para recupera-la depois
  const ehPaciente = String(body.tipo||'') === 'paciente';

  let nomePessoa = '';
  if (ehPaciente) {
    const pac = acharPacientePorEmail(email);
    if (!pac) return generica;
    if (String(pac.obj.acesso||'').toLowerCase() === 'bloqueado') return generica;
    nomePessoa = pac.obj.nome || '';
  } else {
    const prof = acharProfissional(email);
    if (!prof) return generica;
    const iStatus = prof.h.indexOf('status');
    if ((prof.row[iStatus]||'').toLowerCase() === 'inativo') return generica;
    nomePessoa = prof.row[prof.h.indexOf('nome')] || '';
  }

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Resets');
  if (sheet.getLastRow() === 0) sheet.appendRow(['token','email','expira','usado','criado_em','tipo']);

  const dados = sheet.getDataRange().getValues();
  const agora = new Date();

  // Trava simples contra alguem disparar dezenas de e-mails
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][1]||'').toLowerCase() === email && dados[i][4]) {
      const criado = new Date(dados[i][4]);
      if (!isNaN(criado) && (agora - criado) < RESET_INTERVALO_MIN*60*1000) return generica;
    }
  }

  // Invalida pedidos anteriores desta pessoa
  for (let i=dados.length-1;i>=1;i--) {
    if (String(dados[i][1]||'').toLowerCase() === email) sheet.deleteRow(i+1);
  }

  const token = gerarTokenReset();
  const expira = new Date(agora.getTime() + RESET_VALIDADE_MIN*60*1000);
  sheet.appendRow([token, email, expira.toISOString(), '', agora.toISOString(),
                   ehPaciente ? 'paciente' : 'equipe']);

  const link = URL_SISTEMA + '?reset=' + encodeURIComponent(token) +
               (ehPaciente ? '&area=paciente' : '');
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Sua senha \u2014 Casa Oliveira',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px">' +
        '<h2 style="color:#1d6b58">Casa Oliveira</h2>' +
        '<p>Ol\u00e1, <strong>' + nomePessoa + '</strong>!</p>' +
        '<p>Use o bot\u00e3o abaixo para criar sua senha de acesso.</p>' +
        '<p style="margin:24px 0"><a href="' + link + '" ' +
        'style="background:#1d6b58;color:#fff;padding:12px 22px;border-radius:8px;' +
        'text-decoration:none;display:inline-block">Criar minha senha</a></p>' +
        '<p style="color:#666;font-size:13px">O link vale por ' + RESET_VALIDADE_MIN +
        ' minutos e s\u00f3 pode ser usado uma vez.</p>' +
        '<p style="color:#666;font-size:13px">Se n\u00e3o foi voc\u00ea que pediu, ignore este ' +
        'e-mail \u2014 sua senha atual continua valendo.</p>' +
        '</div>'
    });
  } catch(e) { /* sem cota de e-mail: o pedido fica registrado mesmo assim */ }

  return generica;
}

function gerarTokenReset() {
  const bytes = Utilities.getUuid().replace(/-/g,'');
  return bytes + Math.floor(Math.random()*1e9).toString(36);
}

function redefinirSenha(body) {
  const token = String(body.token_reset||'');
  const nova  = String(body.nova_senha||'');
  if (!token) return {ok:false, erro:'Link inv\u00e1lido'};
  if (nova.length < 6) return {ok:false, erro:'A nova senha precisa ter ao menos 6 caracteres'};

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Resets');
  if (!sheet) return {ok:false, erro:'Link inv\u00e1lido ou expirado'};

  const dados = sheet.getDataRange().getValues();
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][0]) !== token) continue;

    if (dados[i][3]) return {ok:false, erro:'Este link j\u00e1 foi usado. Pe\u00e7a um novo.'};
    if (new Date() >= new Date(dados[i][2])) return {ok:false, erro:'Este link expirou. Pe\u00e7a um novo.'};

    const email = String(dados[i][1]||'');
    const tipo = String(dados[i][5]||'equipe');

    if (tipo === 'paciente') {
      const pac = acharPacientePorEmail(email);
      if (!pac) return {ok:false, erro:'Cadastro n\u00e3o encontrado'};
      let iS = pac.h.indexOf('senha_hash');
      if (iS === -1) {
        pac.h.push('senha_hash');
        iS = pac.h.length - 1;
        pac.sheet.getRange(1, iS+1).setValue('senha_hash');
      }
      pac.sheet.getRange(pac.linha, iS+1).setValue(hashSenha(email, nova));
      let iA = pac.h.indexOf('acesso');
      if (iA === -1) {
        pac.h.push('acesso');
        iA = pac.h.length - 1;
        pac.sheet.getRange(1, iA+1).setValue('acesso');
      }
      pac.sheet.getRange(pac.linha, iA+1).setValue('Liberado');
    } else {
      const prof = acharProfissional(email);
      if (!prof) return {ok:false, erro:'Usu\u00e1rio n\u00e3o encontrado'};
      const iSenha = prof.h.indexOf('senha_hash');
      prof.sheet.getRange(prof.linha, iSenha+1).setValue(hashSenha(email, nova));
    }

    sheet.getRange(i+1, 4).setValue(new Date().toISOString());   // marca como usado

    // Derruba as sessoes abertas: se a conta foi acessada por outra pessoa,
    // trocar a senha sozinho nao a colocaria para fora.
    const st = ss.getSheetByName('Tokens');
    if (st) {
      const td = st.getDataRange().getValues();
      for (let j=td.length-1;j>=1;j--) {
        if (String(td[j][1]||'').toLowerCase() === email.toLowerCase()) st.deleteRow(j+1);
      }
    }
    return {ok:true};
  }
  return {ok:false, erro:'Link inv\u00e1lido ou expirado'};
}


// --- AREA DO PACIENTE -----------------------------------------
// Regra que sustenta tudo aqui: o paciente e identificado pelo ref_id
// gravado no token no momento do login. Nenhuma funcao desta secao aceita
// id vindo do navegador - e o que impede alguem de pedir a ficha alheia.

function acharPacientePorEmail(email) {
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Pacientes');
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return null;
  const h = dados[0];
  const iEmail = h.indexOf('email');
  if (iEmail === -1) return null;
  const alvo = String(email).toLowerCase().trim();
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iEmail]||'').toLowerCase().trim() === alvo) {
      const o = {}; h.forEach((k,j)=>o[k]=dados[i][j]);
      return {obj:o, linha:i+1, h:h, sheet:sheet};
    }
  }
  return null;
}

function acharPacientePorId(id) {
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Pacientes');
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return null;
  const h = dados[0];
  const iId = h.indexOf('id');
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iId]) === String(id)) {
      const o = {}; h.forEach((k,j)=>o[k]=dados[i][j]);
      return {obj:o, linha:i+1, h:h, sheet:sheet};
    }
  }
  return null;
}

function loginPaciente(body) {
  const email = String(body.email||'').toLowerCase().trim();
  const senha = String(body.senha||'');
  if (!email || !senha) return {ok:false, erro:'Informe e-mail e senha'};

  const achado = acharPacientePorEmail(email);
  // Mesma mensagem para e-mail inexistente e senha errada: dizer qual dos
  // dois falhou revelaria quem e paciente da clinica
  const generico = {ok:false, erro:'E-mail ou senha incorretos'};
  if (!achado) return generico;

  const p = achado.obj;
  if (!p.senha_hash) return {ok:false, erro:'Seu acesso ainda n\u00e3o foi liberado. Fale com a cl\u00ednica.'};
  if (String(p.acesso||'').toLowerCase() === 'bloqueado') return {ok:false, erro:'Acesso bloqueado. Fale com a cl\u00ednica.'};

  const check = conferirSenha(email, p.senha_hash, senha);
  if (!check.ok) return generico;
  if (check.migrar) {
    const iSenha = achado.h.indexOf('senha_hash');
    achado.sheet.getRange(achado.linha, iSenha+1).setValue(hashSenha(email, senha));
  }

  const token = Utilities.base64Encode('pac:'+email+':'+Date.now()+':'+Math.random());
  salvarToken(token, email, 'paciente', p.id);
  return {ok:true, token, usuario:{nome:p.nome, email:p.email, role:'paciente'}};
}

// Devolve so o que a clinica escolheu comunicar. O prontuario tecnico -
// checklists, PTS interno, evolucoes - nao sai daqui.
function meuProntuario(token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};

  const achado = acharPacientePorId(info.refId);
  if (!achado) return {ok:false, erro:'Cadastro n\u00e3o encontrado'};
  const p = achado.obj;

  // Funcao e registro do terapeuta, para o paciente saber quem o atende e
  // com que credencial - "Dr. Paulo" sozinho diz pouco
  let terapeutaFuncao = '', terapeutaRegistro = '';
  if (p.terapeuta_nome) {
    const ssp = getSpreadsheet();
    const sp = ssp.getSheetByName('Profissionais');
    if (sp && sp.getLastRow() > 1) {
      const dp = sp.getDataRange().getValues();
      const hp = dp[0];
      const iNome = hp.indexOf('nome'), iFun = hp.indexOf('funcao'), iReg = hp.indexOf('registro');
      const alvo = String(p.terapeuta_nome).trim().toLowerCase();
      for (let i=1;i<dp.length;i++) {
        if (String(dp[i][iNome]||'').trim().toLowerCase() === alvo) {
          terapeutaFuncao  = iFun >= 0 ? (dp[i][iFun]||'') : '';
          terapeutaRegistro = iReg >= 0 ? (dp[i][iReg]||'') : '';
          break;
        }
      }
    }
  }

  return {ok:true, dados:{
    nome: p.nome,
    linha: p.linha,
    terapeuta_nome: p.terapeuta_nome,
    terapeuta_funcao: terapeutaFuncao,
    terapeuta_registro: terapeutaRegistro,
    servicos: p.servicos,
    status: p.status,
    plano: p.plano_paciente || '',
    plano_atualizado_em: p.plano_atualizado_em || '',
    orientacoes: p.orientacoes_paciente || '',
    proximo_contato: p.proximo_contato || '',
  }};
}

function minhaPosicao(token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente') return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('ListaEspera');
  if (!sheet || sheet.getLastRow() < 2) return {ok:true, dados:null};

  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');
  const iStatus = h.indexOf('status');
  const iEntrada = h.indexOf('data_entrada');
  const iPrior = h.indexOf('prioridade');
  const iLinha = h.indexOf('linha');
  const iId = h.indexOf('id');
  if (iEmail === -1) return {ok:true, dados:null};

  const email = String(info.email||'').toLowerCase().trim();

  const fila = [];
  for (let i=1;i<dados.length;i++) {
    const r = {}; h.forEach((k,j)=>r[k]=dados[i][j]);
    if (!r.id) continue;
    if (String(r.status||'Aguardando').toLowerCase() !== 'aguardando') continue;
    fila.push(r);
  }

  // Mesma ordem que a clinica ve: prioridade primeiro, depois quem chegou antes
  const peso = s => String(s||'').toLowerCase()==='alta' ? 0 : (String(s||'').toLowerCase()==='baixa' ? 2 : 1);
  fila.sort(function(a,b){
    const d = peso(a.prioridade) - peso(b.prioridade);
    if (d !== 0) return d;
    return String(a.data_entrada||'').localeCompare(String(b.data_entrada||''));
  });

  const meuIdx = fila.findIndex(function(r){
    return String(r.email||'').toLowerCase().trim() === email;
  });
  if (meuIdx === -1) return {ok:true, dados:null};

  const meu = fila[meuIdx];

  // A pessoa pode aguardar em mais de uma linha, e a posicao muda em cada
  // uma. Devolvemos todas para o portal nao mostrar so metade da verdade.
  const separar = function(v){
    return String(v||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
  };
  const minhasLinhas = separar(meu.linha);
  const posicoes = minhasLinhas.map(function(l){
    const naLinha = fila.filter(function(r){ return separar(r.linha).indexOf(l) !== -1; });
    return {
      linha: l,
      posicao: naLinha.findIndex(function(r){ return String(r.id)===String(meu.id); }) + 1,
      total: naLinha.length
    };
  }).filter(function(x){ return x.posicao > 0; });

  const principal = posicoes[0] || {linha: meu.linha||'', posicao: meuIdx+1, total: fila.length};

  return {ok:true, dados:{
    posicao: principal.posicao,
    total_na_linha: principal.total,
    linha: principal.linha,
    filas: posicoes,
    programas: meu.programa || '',
    servicos: meu.servicos || '',
    desde: meu.data_entrada || '',
    observacao: meu.aviso_paciente || '',
  }};
}

function alterarSenhaPaciente(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};
  const nova = String(body.nova_senha||'');
  if (nova.length < 6) return {ok:false, erro:'A nova senha precisa ter ao menos 6 caracteres'};

  const achado = acharPacientePorId(info.refId);
  if (!achado) return {ok:false, erro:'Cadastro n\u00e3o encontrado'};

  const check = conferirSenha(info.email, achado.obj.senha_hash, String(body.senha_atual||''));
  if (!check.ok) return {ok:false, erro:'Senha atual incorreta'};

  const iSenha = achado.h.indexOf('senha_hash');
  achado.sheet.getRange(achado.linha, iSenha+1).setValue(hashSenha(info.email, nova));
  return {ok:true};
}

// A clinica libera o acesso e o paciente recebe a senha por e-mail
function darAcessoPaciente(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'admin') return {ok:false, erro:'Sem permiss\u00e3o de admin'};

  const email = String(body.email||'').toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) return {ok:false, erro:'E-mail inv\u00e1lido'};
  if (!body.paciente_id) return {ok:false, erro:'Paciente n\u00e3o informado'};

  const achado = acharPacientePorId(body.paciente_id);
  if (!achado) return {ok:false, erro:'Paciente n\u00e3o encontrado'};

  // Um e-mail nao pode servir a dois cadastros: o login ficaria ambiguo e
  // a pessoa errada poderia acabar vendo a ficha errada
  const outro = acharPacientePorEmail(email);
  if (outro && String(outro.obj.id) !== String(body.paciente_id)) {
    return {ok:false, erro:'Este e-mail j\u00e1 est\u00e1 em uso por outro paciente'};
  }

  const setar = (coluna, valor) => {
    let idx = achado.h.indexOf(coluna);
    if (idx === -1) {
      achado.h.push(coluna);
      idx = achado.h.length - 1;
      achado.sheet.getRange(1, idx+1).setValue(coluna);
    }
    achado.sheet.getRange(achado.linha, idx+1).setValue(valor);
  };
  setar('email', email);
  setar('acesso', 'Liberado');

  // Duas formas de entregar o acesso. A senha definida na hora existe para
  // quem nao usa e-mail - pessoa idosa, quem nao tem o habito de abrir link -
  // e nesse caso a clinica entrega em maos.
  const senhaEscolhida = String(body.senha||'').trim();
  if (senhaEscolhida) {
    if (senhaEscolhida.length < 6) return {ok:false, erro:'A senha precisa ter ao menos 6 caracteres'};
    setar('senha_hash', hashSenha(email, senhaEscolhida));
    return {ok:true, modo:'senha_definida'};
  }

  // Caminho normal: link de uso unico, para a senha nao ficar guardada na
  // caixa de entrada para sempre
  const r = solicitarReset({email: email, tipo: 'paciente'});
  return {ok:true, modo:'link_enviado', enviado: !!r.ok};
}


// --- DOCUMENTOS -----------------------------------------------
// Os arquivos ficam no Drive da clinica, nao na planilha. A planilha guarda
// so os dados do anexo; o conteudo so sai daqui depois de conferir de quem
// e o pedido, entao um link vazado nao entrega o arquivo de ninguem.

// A pasta leva o nome do paciente, para a clinica se achar no Drive, mas o
// vinculo e pelo id da pasta, guardado na ficha. Procurar pela pasta pelo
// nome quebraria em dois casos reais: duas pessoas de mesmo nome cairiam na
// mesma pasta, e renomear o paciente (ou a pasta, direto no Drive) faria o
// sistema criar outra e perder de vista a primeira.
function pastaDoPaciente(pacienteId, nomePaciente) {
  const pac = acharPacientePorId(pacienteId);

  // Ja vinculada? usa aquela, mesmo que tenha sido renomeada no Drive
  if (pac && pac.obj.drive_pasta) {
    try {
      const p = DriveApp.getFolderById(pac.obj.drive_pasta);
      if (!p.isTrashed()) return p;
    } catch(e) { /* apagada de vez: cria outra abaixo */ }
  }

  const achadas = DriveApp.getFoldersByName(PASTA_DOCS);
  const raiz = achadas.hasNext() ? achadas.next() : DriveApp.createFolder(PASTA_DOCS);

  // O nome sozinho nao basta para quem abre o Drive: duas pessoas de mesmo
  // nome dariam duas pastas identicas, impossiveis de distinguir. A data de
  // nascimento e como a clinica ja diferencia homonimos; sem ela, entra um
  // codigo curto tirado do id.
  const limpo = String(nomePaciente||'Paciente').replace(/[\\/:*?"<>|]/g,'-').trim() || 'Paciente';
  let marca = '';
  if (pac && pac.obj.data_nascimento) {
    const d = String(pac.obj.data_nascimento).slice(0,10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    marca = m ? (m[3] + '-' + m[2] + '-' + m[1]) : d;
  }
  if (!marca) marca = String(pacienteId).slice(-5);
  const nova = raiz.createFolder(limpo + ' (' + marca + ')');

  // Guarda o id na ficha para nunca mais depender do nome
  if (pac) {
    let iCol = pac.h.indexOf('drive_pasta');
    if (iCol === -1) {
      iCol = pac.h.length;
      pac.sheet.getRange(1, iCol+1).setValue('drive_pasta');
    }
    pac.sheet.getRange(pac.linha, iCol+1).setValue(nova.getId());
  }
  return nova;
}

function enviarDocumento(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role === 'paciente') return {ok:false, erro:'Sem permiss\u00e3o'};
  if (!body.paciente_id) return {ok:false, erro:'Paciente n\u00e3o informado'};
  if (!body.arquivo)     return {ok:false, erro:'Arquivo vazio'};
  if (!body.nome)        return {ok:false, erro:'Nome do arquivo vazio'};

  // base64 ocupa cerca de 4/3 do arquivo original
  const bytesAprox = String(body.arquivo).length * 0.75;
  if (bytesAprox > MAX_ARQUIVO_MB * 1024 * 1024) {
    return {ok:false, erro:'Arquivo maior que ' + MAX_ARQUIVO_MB + ' MB'};
  }

  const pac = acharPacientePorId(body.paciente_id);
  if (!pac) return {ok:false, erro:'Paciente n\u00e3o encontrado'};

  let arquivo;
  try {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(body.arquivo),
      body.tipo || 'application/octet-stream',
      body.nome
    );
    arquivo = pastaDoPaciente(body.paciente_id, pac.obj.nome).createFile(blob);
  } catch(e) {
    return {ok:false, erro:'N\u00e3o foi poss\u00edvel guardar o arquivo: ' + e.toString()};
  }

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss, 'Documentos');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','paciente_id','nome','tipo','categoria','drive_id','tamanho',
                     'visivel_paciente','enviado_por','enviado_nome','criado_em']);
  }
  const id = 'doc_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  sheet.appendRow([
    id, body.paciente_id, body.nome, body.tipo||'', body.categoria||'Outro',
    arquivo.getId(), Math.round(bytesAprox),
    body.visivel_paciente === false ? 'Nao' : 'Sim',
    info.email, body.enviado_nome || '', new Date().toISOString()
  ]);

  return {ok:true, id: id};
}

function linhaDocumento(id) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Documentos');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iId = h.indexOf('id');
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iId]) === String(id)) {
      const o = {}; h.forEach(function(k,j){ o[k]=dados[i][j]; });
      return {obj:o, linha:i+1, h:h, sheet:sheet};
    }
  }
  return null;
}

function baixarDocumento(body, token) {
  const info = getInfoToken(token);
  if (!info) return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};
  if (!body.id) return {ok:false, erro:'Documento n\u00e3o informado'};

  const doc = linhaDocumento(body.id);
  if (!doc) return {ok:false, erro:'Documento n\u00e3o encontrado'};

  // O paciente so alcanca o proprio arquivo, e so o que a clinica marcou
  // como visivel. A conferencia usa o ref_id do token, nunca o id enviado.
  if (info.role === 'paciente') {
    if (String(doc.obj.paciente_id) !== String(info.refId)) {
      return {ok:false, erro:'Sem permiss\u00e3o'};
    }
    if (String(doc.obj.visivel_paciente||'Sim').toLowerCase().indexOf('n') === 0) {
      return {ok:false, erro:'Sem permiss\u00e3o'};
    }
  }

  try {
    const arquivo = DriveApp.getFileById(doc.obj.drive_id);
    return {ok:true, dados:{
      nome: doc.obj.nome,
      tipo: doc.obj.tipo || arquivo.getMimeType(),
      conteudo: Utilities.base64Encode(arquivo.getBlob().getBytes())
    }};
  } catch(e) {
    return {ok:false, erro:'Arquivo n\u00e3o encontrado no Drive'};
  }
}

function excluirDocumento(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role === 'paciente') return {ok:false, erro:'Sem permiss\u00e3o'};
  const doc = linhaDocumento(body.id);
  if (!doc) return {ok:false, erro:'Documento n\u00e3o encontrado'};

  // Vai para a lixeira do Drive, nao some de vez: anexo de prontuario
  // apagado por engano precisa ter volta.
  try { DriveApp.getFileById(doc.obj.drive_id).setTrashed(true); } catch(e) {}
  doc.sheet.deleteRow(doc.linha);
  return {ok:true};
}

function meusDocumentos(token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Documentos');
  if (!sheet || sheet.getLastRow() < 2) return {ok:true, dados:[]};

  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const saida = [];
  for (let i=1;i<dados.length;i++) {
    const o = {}; h.forEach(function(k,j){ o[k]=dados[i][j]; });
    if (!o.id) continue;
    if (String(o.paciente_id) !== String(info.refId)) continue;
    if (String(o.visivel_paciente||'Sim').toLowerCase().indexOf('n') === 0) continue;
    // drive_id fica de fora: o paciente nao precisa dele e ele identifica o
    // arquivo dentro do Drive da clinica
    saida.push({id:o.id, nome:o.nome, tipo:o.tipo, categoria:o.categoria,
                tamanho:o.tamanho, criado_em:o.criado_em});
  }
  return {ok:true, dados:saida};
}

// --- MENSAGENS ------------------------------------------------
// A conversa e do paciente com a clinica, nao com uma pessoa. E o que
// diferencia isto do WhatsApp: qualquer um da equipe responsavel responde,
// e a gestao enxerga tudo.

// Colunas da aba. As tres ultimas nasceram com a central de mensagens; a
// planilha em producao ja tinha as outras, entao elas sao acrescentadas em
// vez de recriadas.
const MSG_CABECALHO = ['id','paciente_id','de','autor_email','autor_nome','texto',
                       'criado_em','lida_paciente','lida_equipe',
                       'status','fechada_em','fechada_por'];

function abaMensagens() {
  const sheet = getOuCria(getSpreadsheet(), 'Mensagens');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(MSG_CABECALHO);
    return sheet;
  }
  const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const faltando = MSG_CABECALHO.filter(function(c){ return h.indexOf(c) === -1; });
  if (faltando.length) sheet.getRange(1, h.length+1, 1, faltando.length).setValues([faltando]);
  return sheet;
}

function cabecalhoMensagens(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function minhasMensagens(token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};
  return {ok:true, dados: lerMensagens(info.refId), marcadas: marcarLidas(info.refId, 'paciente')};
}

function mensagensPaciente(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role === 'paciente') return {ok:false, erro:'Sem permiss\u00e3o'};
  if (!body.paciente_id) return {ok:false, erro:'Paciente n\u00e3o informado'};
  return {ok:true, dados: lerMensagens(body.paciente_id), marcadas: marcarLidas(body.paciente_id, 'equipe')};
}

function lerMensagens(pacienteId) {
  const sheet = abaMensagens();
  if (sheet.getLastRow() < 2) return [];
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const saida = [];
  for (let i=1;i<dados.length;i++) {
    const o = {}; h.forEach(function(k,j){ o[k]=dados[i][j]; });
    if (o.id && String(o.paciente_id) === String(pacienteId)) saida.push(o);
  }
  saida.sort(function(a,b){ return String(a.criado_em||'').localeCompare(String(b.criado_em||'')); });
  return saida;
}

// Marca como lido o que veio do outro lado, para o contador de nao lidas
function marcarLidas(pacienteId, quemLe) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Mensagens');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iPac = h.indexOf('paciente_id');
  const iDe  = h.indexOf('de');
  let iLida  = h.indexOf('lida_' + quemLe);
  if (iLida === -1) {
    iLida = h.length;
    sheet.getRange(1, iLida+1).setValue('lida_' + quemLe);
  }
  const outro = quemLe === 'paciente' ? 'equipe' : 'paciente';
  let n = 0;
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iPac]) !== String(pacienteId)) continue;
    if (String(dados[i][iDe]) !== outro) continue;
    if (dados[i][iLida]) continue;
    sheet.getRange(i+1, iLida+1).setValue(new Date().toISOString());
    n++;
  }
  return n;
}

function enviarMensagem(body, token) {
  const info = getInfoToken(token);
  if (!info) return {ok:false, erro:'Sess\u00e3o inv\u00e1lida'};

  const texto = String(body.texto||'').trim();
  if (!texto) return {ok:false, erro:'Escreva a mensagem'};
  if (texto.length > 4000) return {ok:false, erro:'Mensagem longa demais'};

  const ehPaciente = info.role === 'paciente';
  // Paciente so escreve na propria conversa: o destino vem do token
  const pacienteId = ehPaciente ? info.refId : body.paciente_id;
  if (!pacienteId) return {ok:false, erro:'Paciente n\u00e3o informado'};

  const sheet = abaMensagens();
  const h = cabecalhoMensagens(sheet);
  const id = 'msg_' + Date.now() + '_' + Math.floor(Math.random()*9999);

  // O que o paciente manda entra em aberto e so sai da central quando alguem
  // responde. O registro manual da equipe (conversa que aconteceu por fora)
  // so fica em aberto se quem anotou disser que ainda espera retorno.
  const emAberto = ehPaciente || String(body.status||'').toLowerCase() === 'aberta';
  const valores = {
    id: id, paciente_id: pacienteId, de: ehPaciente ? 'paciente' : 'equipe',
    autor_email: info.email, autor_nome: body.autor_nome || '', texto: texto,
    criado_em: new Date().toISOString(), status: emAberto ? 'aberta' : 'fechada'
  };
  sheet.appendRow(h.map(function(k){ return valores[k] === undefined ? '' : valores[k]; }));

  // Responder pelo prontuario ja baixa a bandeirinha na central: ninguem
  // precisa lembrar de voltar na tela de Mensagens so para marcar de novo.
  if (!ehPaciente && !emAberto) fecharPendencias(sheet, h, pacienteId, body.autor_nome || info.email);

  return {ok:true, id:id};
}


// --- CENTRAL DE MENSAGENS -------------------------------------
// Uma tela unica com tudo que ainda espera a equipe, para ninguem ter de
// abrir prontuario por prontuario atras de pendencia. "Aberta" e a mensagem
// que pede acao: o que o paciente escreveu, ou a conversa que aconteceu por
// fora e foi anotada aqui com retorno combinado.

const MSG_STATUS = ['aberta','respondida','fechada'];

// Linhas gravadas antes da coluna status: o que veio do paciente continua
// pedindo resposta, o que a equipe mandou nao. Ter lido nao e ter respondido.
function statusDaMensagem(o) {
  const s = String(o.status||'').trim().toLowerCase();
  if (s) return s;
  return String(o.de) === 'paciente' ? 'aberta' : 'fechada';
}

// O papel e a area de quem pediu vem da planilha pelo e-mail do token, nunca
// do que o navegador manda - e o que impede um profissional de pedir a fila
// da clinica inteira.
function perfilDaEquipe(token) {
  const info = getInfoToken(token);
  if (!info || info.role === 'paciente') return null;
  const p = acharProfissional(info.email);
  const campo = function(nome) {
    if (!p) return '';
    const i = p.h.indexOf(nome);
    return i === -1 ? '' : String(p.row[i]||'').trim();
  };
  return {
    email: info.email,
    nome: campo('nome'),
    funcao: campo('funcao'),
    role: campo('nivel_acesso') || info.role || 'profissional',
    linhas: campo('linhas').toLowerCase().split(',')
              .map(function(x){ return x.trim(); }).filter(function(x){ return x; })
  };
}

function podeVerPaciente(perfil, pac) {
  if (!pac) return false;
  if (perfil.role === 'admin') return true;
  if (perfil.role === 'coordenador') {
    // Coordenadora sem area preenchida enxerga tudo, como ja acontece no
    // resto do sistema. E a coluna "linhas" da aba Profissionais que estreita.
    if (!perfil.linhas.length || perfil.linhas.indexOf('todos') !== -1) return true;
    return perfil.linhas.indexOf(String(pac.linha||'').trim().toLowerCase()) !== -1;
  }
  const meu = String(pac.terapeuta_nome||'').trim().toLowerCase();
  return !!meu && meu === String(perfil.nome||'').trim().toLowerCase();
}

// Nome, linha e terapeuta saem sempre da ficha do paciente. Copiar isso para
// dentro da mensagem daria uma lista desatualizada no dia em que o paciente
// trocasse de terapeuta.
function mapaPacientes() {
  const sheet = getOuCria(getSpreadsheet(), 'Pacientes');
  const dados = sheet.getDataRange().getValues();
  const mapa = {};
  if (dados.length < 2) return mapa;
  const h = dados[0];
  const iId = h.indexOf('id'), iNome = h.indexOf('nome');
  const iLinha = h.indexOf('linha'), iTer = h.indexOf('terapeuta_nome');
  for (let i=1;i<dados.length;i++) {
    const id = String(dados[i][iId]||'');
    if (!id) continue;
    mapa[id] = {
      id: id,
      nome:  iNome  === -1 ? '' : String(dados[i][iNome]||''),
      linha: iLinha === -1 ? '' : String(dados[i][iLinha]||''),
      terapeuta_nome: iTer === -1 ? '' : String(dados[i][iTer]||'')
    };
  }
  return mapa;
}

function textoData(v) {
  return v instanceof Date ? v.toISOString() : String(v||'');
}

function mensagensAbertas(token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil) return {ok:false, erro:'Sem permiss\u00e3o'};
  const sheet = abaMensagens();
  if (sheet.getLastRow() < 2) return {ok:true, dados:[]};

  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const pacs = mapaPacientes();
  const saida = [];
  for (let i=1;i<dados.length;i++) {
    const o = {}; h.forEach(function(k,j){ o[k] = dados[i][j]; });
    if (!o.id || statusDaMensagem(o) !== 'aberta') continue;
    const pac = pacs[String(o.paciente_id)];
    if (!podeVerPaciente(perfil, pac)) continue;
    saida.push({
      id: String(o.id),
      paciente_id: String(o.paciente_id),
      paciente_nome: pac.nome,
      linha: pac.linha,
      terapeuta_nome: pac.terapeuta_nome,
      de: String(o.de||''),
      autor_nome: String(o.autor_nome||''),
      texto: String(o.texto||''),
      criado_em: textoData(o.criado_em)
    });
  }
  // Mais antigo primeiro: quem espera ha mais tempo fica no topo, que e o
  // ponto de ter a central - nao deixar ninguem esquecido no fim da lista.
  saida.sort(function(a,b){ return a.criado_em.localeCompare(b.criado_em); });
  return {ok:true, dados: saida};
}

function marcarMensagem(body, token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil) return {ok:false, erro:'Sem permiss\u00e3o'};
  const novo = String(body.status||'fechada').trim().toLowerCase();
  if (MSG_STATUS.indexOf(novo) === -1) return {ok:false, erro:'Status inv\u00e1lido'};
  if (!body.id) return {ok:false, erro:'Mensagem n\u00e3o informada'};

  const sheet = abaMensagens();
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iId = h.indexOf('id'), iPac = h.indexOf('paciente_id');
  const pacs = mapaPacientes();
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iId]) !== String(body.id)) continue;
    // Mesma regra da listagem: so mexe no que teria direito de ver.
    if (!podeVerPaciente(perfil, pacs[String(dados[i][iPac])])) return {ok:false, erro:'Sem permiss\u00e3o'};
    gravarStatus(sheet, h, i+1, novo, perfil.nome || perfil.email);
    return {ok:true, id:String(body.id), status:novo};
  }
  return {ok:false, erro:'Mensagem n\u00e3o encontrada'};
}

function gravarStatus(sheet, h, linha, status, quem) {
  const fechada = status !== 'aberta';
  sheet.getRange(linha, h.indexOf('status')+1).setValue(status);
  sheet.getRange(linha, h.indexOf('fechada_em')+1).setValue(fechada ? new Date().toISOString() : '');
  sheet.getRange(linha, h.indexOf('fechada_por')+1).setValue(fechada ? quem : '');
}

function fecharPendencias(sheet, h, pacienteId, quem) {
  const dados = sheet.getDataRange().getValues();
  const iPac = h.indexOf('paciente_id');
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iPac]) !== String(pacienteId)) continue;
    const o = {}; h.forEach(function(k,j){ o[k] = dados[i][j]; });
    if (statusDaMensagem(o) !== 'aberta') continue;
    gravarStatus(sheet, h, i+1, 'respondida', quem);
  }
}


// --- CATALOGO DE SERVICOS -------------------------------------
// O que a clinica oferece, para a equipe consultar sem perguntar a ninguem.
// Mora na aba Catalogo e nao na aba Servicos: aquela ja guarda o servico
// agendado de cada paciente, que e outra coisa.
//
// Nao se confunde com a aba Programas: programa e etapa do fluxo e alimenta
// as opcoes da lista de espera; catalogo e o que a clinica oferece e tem
// preco. Foi decidido manter os dois separados para nao transformar produto
// em opcao de lista de espera.

const ABAS_SO_GESTAO = ['catalogo'];
const ACOES_ESCRITA  = ['salvar','atualizar','deletar'];

const CATALOGO_CABECALHO = ['id','nome','linha','descricao','valor','ativo','criado_em'];

function listarCatalogo(token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil) return {ok:false, erro:'Sem permiss\u00e3o'};

  const sheet = getOuCria(getSpreadsheet(), 'Catalogo');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CATALOGO_CABECALHO);
    return {ok:true, dados:[], pode_editar:false, ve_valor:false};
  }
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  // Preco e informacao comercial: o profissional ve o que oferecer, a gestao
  // e a coordenacao veem por quanto. O valor nem sai daqui para quem nao ve,
  // porque esconder so na tela nao esconde de quem olha a resposta.
  const veValor = perfil.role === 'admin' || perfil.role === 'coordenador';
  const saida = [];
  for (let i=1;i<dados.length;i++) {
    const o = {}; h.forEach(function(k,j){ o[k] = dados[i][j]; });
    if (!o.id) continue;
    saida.push({
      id: String(o.id),
      nome: String(o.nome||''),
      linha: String(o.linha||''),
      descricao: String(o.descricao||''),
      valor: veValor ? String(o.valor||'') : '',
      ativo: String(o.ativo||'Sim')
    });
  }
  saida.sort(function(a,b){ return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return {ok:true, dados: saida, pode_editar: perfil.role === 'admin', ve_valor: veValor};
}


// --- LEADS / CAPTACAO -----------------------------------------
// Funil de quem procurou a clinica antes de virar paciente. Duas abas: Leads
// guarda o estado atual de cada pessoa, LeadHistorico guarda cada passo do
// caminho. O estagio nunca e sobrescrito em silencio - toda mudanca vira uma
// linha de log, senao nao da para saber por que alguem parou no meio.

// >>> EDITE AQUI para mudar o funil <<<
// Esta e a unica lista de estagios do sistema: a tela monta as colunas com o
// que vier daqui. Mexer nesta linha muda o funil inteiro. Trocar um nome
// depois de ter lead gravado nao apaga nada, mas o lead fica no estagio
// antigo ate alguem move-lo - por isso renomear pede um passe na planilha.
const ESTAGIOS_LEAD = [
  'Novo Lead',
  'Primeiro Contato Feito',
  'Qualificado',
  'Agendou Avalia\u00e7\u00e3o',
  'Compareceu',
  'Virou Paciente',
  'Perdido'
];
const ESTAGIO_GANHO  = 'Virou Paciente';
const ESTAGIO_PERDIDO = 'Perdido';

const ORIGENS_LEAD = ['Instagram','Meta Ads','Indica\u00e7\u00e3o','Rua/Passante','Google','Outro'];
const MOTIVOS_PERDA = ['N\u00e3o respondeu','N\u00e3o tinha or\u00e7amento','Desistiu',
                       'Fora da \u00e1rea de atendimento','Outro'];

const LEAD_CABECALHO = ['id','nome','telefone','email','data_contato','origem','campanha',
                        'indicado_por','linha','responsavel','estagio','motivo_perda',
                        'paciente_id','criado_em','atualizado_em'];
const LEADLOG_CABECALHO = ['id','lead_id','em','de_estagio','para_estagio','obs','por'];

function abaComCabecalho(nome, cabecalho) {
  const sheet = getOuCria(getSpreadsheet(), nome);
  if (sheet.getLastRow() === 0) { sheet.appendRow(cabecalho); return sheet; }
  const h = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const faltando = cabecalho.filter(function(c){ return h.indexOf(c) === -1; });
  if (faltando.length) sheet.getRange(1, h.length+1, 1, faltando.length).setValues([faltando]);
  return sheet;
}

// Recepcao e funcao, nao nivel de acesso: quem atende o telefone entra no
// sistema como profissional. Por isso o funil olha a coluna funcao, e nao so
// o nivel - foi o jeito de dar o acesso sem inventar um quarto papel.
function ehRecepcao(perfil) {
  return /recep|comercial/i.test(String(perfil.funcao||''));
}
function podeVerLeads(perfil) {
  return perfil.role === 'admin' || perfil.role === 'coordenador' || ehRecepcao(perfil);
}
// Coordenacao acompanha o funil da area dela, mas quem mexe e a gestao e a
// recepcao, que fazem a triagem.
function podeEditarLeads(perfil) {
  return perfil.role === 'admin' || ehRecepcao(perfil);
}
function podeVerLead(perfil, lead) {
  if (perfil.role === 'admin' || ehRecepcao(perfil)) return true;
  if (perfil.role !== 'coordenador') return false;
  if (!perfil.linhas.length || perfil.linhas.indexOf('todos') !== -1) return true;
  return perfil.linhas.indexOf(String(lead.linha||'').trim().toLowerCase()) !== -1;
}

function lerAba(sheet) {
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return [];
  const h = dados[0];
  const saida = [];
  for (let i=1;i<dados.length;i++) {
    const o = {}; h.forEach(function(k,j){ o[k] = textoData(dados[i][j]); });
    if (o.id) saida.push(o);
  }
  return saida;
}

function listarLeads(token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil || !podeVerLeads(perfil)) return {ok:false, erro:'Sem permiss\u00e3o'};
  const leads = lerAba(abaComCabecalho('Leads', LEAD_CABECALHO))
    .filter(function(l){ return podeVerLead(perfil, l); })
    .sort(function(a,b){ return String(b.data_contato||'').localeCompare(String(a.data_contato||'')); });
  return {
    ok: true, dados: leads,
    estagios: ESTAGIOS_LEAD, origens: ORIGENS_LEAD, motivos: MOTIVOS_PERDA,
    estagio_ganho: ESTAGIO_GANHO, estagio_perdido: ESTAGIO_PERDIDO,
    pode_editar: podeEditarLeads(perfil)
  };
}

function acharLead(sheet, id) {
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iId = h.indexOf('id');
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][iId]) === String(id)) {
      const o = {}; h.forEach(function(k,j){ o[k] = textoData(dados[i][j]); });
      return {linha:i+1, h:h, dados:o};
    }
  }
  return null;
}

function gravarLead(sheet, h, linha, valores) {
  h.forEach(function(k, j){
    if (valores[k] !== undefined) sheet.getRange(linha, j+1).setValue(valores[k]);
  });
}

function registrarInteracao(leadId, de, para, obs, quem) {
  const sheet = abaComCabecalho('LeadHistorico', LEADLOG_CABECALHO);
  const h = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const valores = {
    id: 'lg_' + Date.now() + '_' + Math.floor(Math.random()*9999),
    lead_id: leadId, em: new Date().toISOString(),
    de_estagio: de || '', para_estagio: para || '', obs: obs || '', por: quem || ''
  };
  sheet.appendRow(h.map(function(k){ return valores[k] === undefined ? '' : valores[k]; }));
  return valores.id;
}

function salvarLead(body, token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil || !podeEditarLeads(perfil)) return {ok:false, erro:'Sem permiss\u00e3o'};
  const d = body.dados || {};
  const nome = String(d.nome||'').trim();
  if (!nome) return {ok:false, erro:'Informe o nome do lead'};

  const sheet = abaComCabecalho('Leads', LEAD_CABECALHO);
  const h = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const agora = new Date().toISOString();

  if (body.id) {
    const achado = acharLead(sheet, body.id);
    if (!achado) return {ok:false, erro:'Lead n\u00e3o encontrado'};
    if (!podeVerLead(perfil, achado.dados)) return {ok:false, erro:'Sem permiss\u00e3o'};
    // Estagio so muda por moverLead, que e quem escreve o historico
    const valores = {};
    LEAD_CABECALHO.forEach(function(k){
      if (['id','estagio','criado_em','paciente_id'].indexOf(k) === -1 && d[k] !== undefined) valores[k] = d[k];
    });
    valores.atualizado_em = agora;
    gravarLead(sheet, achado.h, achado.linha, valores);
    return {ok:true, id: body.id};
  }

  const id = 'ld_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  const estagio = ESTAGIOS_LEAD.indexOf(d.estagio) !== -1 ? d.estagio : ESTAGIOS_LEAD[0];
  const valores = {
    id: id, nome: nome, telefone: d.telefone||'', email: d.email||'',
    data_contato: d.data_contato || agora.slice(0,10),
    origem: d.origem||'', campanha: d.campanha||'', indicado_por: d.indicado_por||'',
    linha: d.linha||'', responsavel: d.responsavel || perfil.nome,
    estagio: estagio, motivo_perda: '', paciente_id: '',
    criado_em: agora, atualizado_em: agora
  };
  sheet.appendRow(h.map(function(k){ return valores[k] === undefined ? '' : valores[k]; }));
  registrarInteracao(id, '', estagio, d.obs || 'Lead cadastrado', perfil.nome || perfil.email);
  return {ok:true, id:id};
}

// Toda mudanca de estagio passa por aqui, e por isso nenhuma passa sem log.
// Serve tambem para so anotar uma conversa: sem estagio novo, vira uma linha
// de historico com a observacao.
function moverLead(body, token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil || !podeEditarLeads(perfil)) return {ok:false, erro:'Sem permiss\u00e3o'};
  const sheet = abaComCabecalho('Leads', LEAD_CABECALHO);
  const achado = acharLead(sheet, body.id);
  if (!achado) return {ok:false, erro:'Lead n\u00e3o encontrado'};

  const atual = String(achado.dados.estagio||'');
  const novo = body.estagio ? String(body.estagio) : atual;
  if (ESTAGIOS_LEAD.indexOf(novo) === -1) return {ok:false, erro:'Est\u00e1gio inv\u00e1lido'};

  const obs = String(body.obs||'').trim();
  // Perder um lead sem dizer por que e o que faz o funil nao ensinar nada
  const motivo = novo === ESTAGIO_PERDIDO ? String(body.motivo_perda||'') : '';
  if (novo === ESTAGIO_PERDIDO && !motivo) return {ok:false, erro:'Informe o motivo da perda'};

  const valores = {estagio: novo, atualizado_em: new Date().toISOString()};
  if (novo === ESTAGIO_PERDIDO) valores.motivo_perda = motivo;
  gravarLead(sheet, achado.h, achado.linha, valores);
  registrarInteracao(body.id, atual, novo,
    obs + (motivo ? (obs ? ' \u2014 ' : '') + 'Motivo: ' + motivo : ''),
    perfil.nome || perfil.email);
  return {ok:true, id:body.id, estagio:novo};
}

function historicoLead(body, token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil || !podeVerLeads(perfil)) return {ok:false, erro:'Sem permiss\u00e3o'};
  const achado = acharLead(abaComCabecalho('Leads', LEAD_CABECALHO), body.id);
  if (!achado) return {ok:false, erro:'Lead n\u00e3o encontrado'};
  if (!podeVerLead(perfil, achado.dados)) return {ok:false, erro:'Sem permiss\u00e3o'};
  const linhas = lerAba(abaComCabecalho('LeadHistorico', LEADLOG_CABECALHO))
    .filter(function(r){ return String(r.lead_id) === String(body.id); })
    .sort(function(a,b){ return String(b.em||'').localeCompare(String(a.em||'')); });
  return {ok:true, dados: linhas};
}

// Converter e apontar o lead para um cadastro que ja existe. Nao cria
// paciente: duplicar cadastro e o que se quer evitar.
function converterLead(body, token) {
  const perfil = perfilDaEquipe(token);
  if (!perfil || !podeEditarLeads(perfil)) return {ok:false, erro:'Sem permiss\u00e3o'};
  const sheet = abaComCabecalho('Leads', LEAD_CABECALHO);
  const achado = acharLead(sheet, body.id);
  if (!achado) return {ok:false, erro:'Lead n\u00e3o encontrado'};

  const pac = mapaPacientes()[String(body.paciente_id)];
  if (!pac) return {ok:false, erro:'Paciente n\u00e3o encontrado'};

  const atual = String(achado.dados.estagio||'');
  gravarLead(sheet, achado.h, achado.linha, {
    paciente_id: pac.id, estagio: ESTAGIO_GANHO, motivo_perda: '',
    linha: achado.dados.linha || pac.linha,
    atualizado_em: new Date().toISOString()
  });
  registrarInteracao(body.id, atual, ESTAGIO_GANHO,
    'Vinculado ao cadastro de ' + pac.nome, perfil.nome || perfil.email);
  return {ok:true, id:body.id, paciente_id:pac.id, paciente_nome:pac.nome};
}


// --- CONFIGURACAO DA CLINICA ----------------------------------
// Cabecalho dos documentos gerados: nome, CNPJ, contato e logo. Fica numa
// aba de chave/valor para a clinica mudar sem mexer no codigo.
const CONFIG_PADRAO = {
  nome: 'CASA OLIVEIRA',
  razao_social: 'Espa\u00e7o de Habilita\u00e7\u00e3o, Preven\u00e7\u00e3o, Reabilita\u00e7\u00e3o e Pr\u00e1ticas Integrativas Oliveira LTDA',
  cnpj: '43.017.332/0001-91',
  endereco: 'Rua Dr. Samuel Porto, 396, Sa\u00fade, S\u00e3o Paulo - SP',
  telefone: '(11) 96579-0254',
  cidade: 'S\u00e3o Paulo',
  assinatura: 'Casa Oliveira Sa\u00fade',
  lema: 'N\u00e3o \u00e9 cl\u00ednica, \u00e9 Casa',
  rodape: 'Metr\u00f4 Sa\u00fade \u2022 Desenvolvimento Infantil \u00b7 Sa\u00fade da Mulher \u00b7 Reabilita\u00e7\u00e3o F\u00edsica \u00b7 Sa\u00fade Mental \u00b7 Gerontologia \u00b7 Bem-Estar',
};

function lerConfig() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  const cfg = {};
  // Sem nada gravado ainda, vale o timbrado que a clinica ja usava - assim o
  // primeiro documento ja sai certo, sem depender de alguem preencher antes
  if (!sheet || sheet.getLastRow() < 2) {
    Object.keys(CONFIG_PADRAO).forEach(function(k){ cfg[k] = CONFIG_PADRAO[k]; });
    return cfg;
  }
  const dados = sheet.getDataRange().getValues();
  for (let i=1;i<dados.length;i++) {
    if (dados[i][0]) cfg[String(dados[i][0])] = dados[i][1];
  }
  // completa o que ainda nao foi preenchido
  Object.keys(CONFIG_PADRAO).forEach(function(k){
    if (!cfg[k]) cfg[k] = CONFIG_PADRAO[k];
  });
  return cfg;
}

function obterConfig(token) {
  const info = getInfoToken(token);
  if (!info || info.role === 'paciente') return {ok:false, erro:'Sem permissao'};
  return {ok:true, dados: lerConfig()};
}

function salvarConfigClinica(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'admin') return {ok:false, erro:'Sem permissao de admin'};

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss, 'Config');
  if (sheet.getLastRow() === 0) sheet.appendRow(['chave','valor']);

  const dados = sheet.getDataRange().getValues();
  const linhaDe = {};
  for (let i=1;i<dados.length;i++) linhaDe[String(dados[i][0])] = i+1;

  Object.keys(body.dados||{}).forEach(function(k){
    const v = body.dados[k];
    if (linhaDe[k]) sheet.getRange(linhaDe[k], 2).setValue(v);
    else sheet.appendRow([k, v]);
  });
  return {ok:true};
}

// --- ORCAMENTO ------------------------------------------------
// Gera um PDF com o cabecalho da clinica e guarda como documento do
// paciente, entao ele baixa pela propria area e leva ao convenio.
function gerarOrcamento(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role === 'paciente') return {ok:false, erro:'Sem permissao'};
  if (!body.paciente_id) return {ok:false, erro:'Paciente nao informado'};

  const tipo = String(body.tipo||'orcamento');
  if (tipo === 'declaracao' && !String(body.texto||'').trim())
    return {ok:false, erro:'Escreva o texto da declaracao'};
  if (tipo !== 'declaracao' && !(body.investimento||[]).length && !(body.protocolo||[]).length)
    return {ok:false, erro:'Preencha ao menos o protocolo ou o investimento'};

  const pac = acharPacientePorId(body.paciente_id);
  if (!pac) return {ok:false, erro:'Paciente nao encontrado'};

  const cfg = lerConfig();
  const numero = proximoNumeroOrcamento();
  const html = htmlDocumento(cfg, pac.obj, body, info);

  const rotulos = {declaracao:'Declara\u00e7\u00e3o', orcamento:'Or\u00e7amento', proposta:'Proposta'};
  const rotulo = rotulos[tipo] || 'Documento';

  let arquivo;
  try {
    const blob = Utilities.newBlob(html, 'text/html', 'doc.html')
                          .getAs('application/pdf')
                          .setName(rotulo + ' ' + numero.replace('/','-') + ' - ' + (pac.obj.nome||'') + '.pdf');
    arquivo = pastaDoPaciente(body.paciente_id, pac.obj.nome).createFile(blob);
  } catch(e) {
    return {ok:false, erro:'Nao foi possivel gerar o PDF: ' + e.toString()};
  }

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss, 'Documentos');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['id','paciente_id','nome','tipo','categoria','drive_id','tamanho',
                     'visivel_paciente','enviado_por','enviado_nome','criado_em']);
  }
  const id = 'doc_' + Date.now() + '_' + Math.floor(Math.random()*9999);
  sheet.appendRow([
    id, body.paciente_id, arquivo.getName(), 'application/pdf', rotulo,
    arquivo.getId(), arquivo.getSize(),
    body.visivel_paciente === false ? 'Nao' : 'Sim',
    info.email, body.autor_nome || '', new Date().toISOString()
  ]);

  // Guarda o conteudo para reabrir e refazer depois sem redigitar
  const so = getOuCria(ss, 'Orcamentos');
  if (so.getLastRow() === 0) {
    so.appendRow(['id','numero','tipo','paciente_id','conteudo','documento_id','criado_por','criado_em']);
  }
  so.appendRow([
    'orc_' + Date.now(), numero, tipo, body.paciente_id, JSON.stringify(body),
    id, info.email, new Date().toISOString()
  ]);

  return {ok:true, documento_id:id, numero:numero};
}

function proximoNumeroOrcamento() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Orcamentos');
  const ano = new Date().getFullYear();
  let maior = 0;
  if (sheet && sheet.getLastRow() > 1) {
    const dados = sheet.getDataRange().getValues();
    const iNum = dados[0].indexOf('numero');
    for (let i=1;i<dados.length;i++) {
      const m = /^(\d+)\/(\d{4})$/.exec(String(dados[i][iNum]||''));
      if (m && Number(m[2]) === ano) maior = Math.max(maior, Number(m[1]));
    }
  }
  return (maior + 1) + '/' + ano;
}

function totalDosItens(itens) {
  let t = 0;
  itens.forEach(function(i){
    t += (Number(i.quantidade)||0) * (Number(i.valor)||0);
  });
  return t;
}

function dinheiro(v) {
  const n = Number(v)||0;
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHtml(s) {
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// O layout segue os documentos que a clinica ja usava em Word: mesmo
// cabecalho institucional, secoes numeradas em verde, tabelas de duas colunas
// e o rodape com o lema. Tres tipos partilham a moldura e mudam o miolo.
function htmlDocumento(cfg, pac, body, info) {
  const tipo = String(body.tipo || 'orcamento');
  const hoje = new Date();
  const meses = ['janeiro','fevereiro','marco','abril','maio','junho','julho',
                 'agosto','setembro','outubro','novembro','dezembro'];
  const dataExtenso = (cfg.cidade || 'Sao Paulo') + ', ' + hoje.getDate() + ' de ' +
                      meses[hoje.getMonth()] + ' de ' + hoje.getFullYear();

  const titulos = {
    declaracao: 'DECLARACAO DE ACOMPANHAMENTO',
    orcamento:  'ORCAMENTO DE CUIDADO',
    proposta:   'PROPOSTA DE CUIDADO'
  };
  const titulo = body.titulo || titulos[tipo] || titulos.orcamento;

  const logo = cfg.logo
    ? '<img src="' + escapeHtml(cfg.logo) + '" class="logo">'
    : '<div class="marca">' + escapeHtml(cfg.nome || 'CASA OLIVEIRA') + '</div>';

  let miolo = '';
  if (tipo === 'declaracao') miolo = mioloDeclaracao(body);
  else miolo = mioloProposta(body, tipo);

  const assinatura = tipo === 'declaracao'
    ? '<div class="assina">' +
        '<div class="assina-nome">' + escapeHtml(body.assina_nome || info.email) + '</div>' +
        (body.assina_funcao ? '<div>' + escapeHtml(body.assina_funcao) + '</div>' : '') +
        (body.assina_registro ? '<div>' + escapeHtml(body.assina_registro) + '</div>' : '') +
      '</div>'
    : '<div class="assina">' +
        '<div class="assina-nome">' + escapeHtml(cfg.assinatura || cfg.nome || '') + '</div>' +
        (body.linha_rotulo ? '<div>Linha ' + escapeHtml(body.linha_rotulo) + '</div>' : '') +
      '</div>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '@page{margin:34px 42px;}' +
    'html,body{background:#ffffff !important;}' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#1a1714;font-size:11.5pt;line-height:1.55;' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '.topo{text-align:center;border-bottom:1.5px solid #4a7c59;padding-bottom:9px;margin-bottom:16px;}' +
    '.marca{font-family:Georgia,"Times New Roman",serif;font-size:22pt;font-weight:bold;color:#2d5a3d;letter-spacing:.5px;}' +
    '.logo{max-height:62px;max-width:230px;}' +
    '.razao{font-style:italic;font-size:8.5pt;color:#3a3a3a;margin-top:2px;}' +
    '.contato{font-size:8pt;color:#3a3a3a;margin-top:2px;}' +
    '.data{text-align:right;font-style:italic;font-size:10.5pt;margin:14px 0 16px;}' +
    'h1{font-family:Georgia,serif;font-size:16pt;color:#2d5a3d;text-align:center;margin:0 0 4px;letter-spacing:.3px;}' +
    '.sub{text-align:center;font-style:italic;font-size:10.5pt;color:#3a3a3a;margin-bottom:18px;}' +
    'h2{font-family:Georgia,serif;font-size:12pt;color:#2d5a3d;margin:18px 0 6px;' +
       'border-bottom:1px solid #cfe0d4;padding-bottom:3px;}' +
    'table{width:100%;border-collapse:collapse;margin:8px 0;}' +
    'td,th{border:1px solid #7f7f7f;padding:6px 9px;font-size:10.5pt;vertical-align:top;' +
      'background:#ffffff;color:#1a1714;}' +
    '.rot{background:#eaf2ec !important;font-weight:bold;color:#2d5a3d;width:34%;}' +
    'th{background:#eaf2ec !important;color:#2d5a3d;text-align:left;}' +
    'ul{margin:6px 0 0;padding-left:20px;} li{margin-bottom:5px;}' +
    'p{margin:0 0 11px;text-align:justify;}' +
    '.nota{font-style:italic;font-size:10pt;color:#3a3a3a;margin-top:10px;}' +
    '.assina{margin-top:30px;padding-top:12px;border-top:1px solid #1a1714;text-align:center;font-size:10.5pt;}' +
    '.assina-nome{font-weight:bold;}' +
    '.rodape{margin-top:34px;padding-top:9px;border-top:1px solid #cfe0d4;text-align:center;' +
       'font-size:8pt;color:#5c5650;}' +
    '.lema{font-style:italic;}' +
    '</style></head><body>' +
    '<div class="topo">' + logo +
      (cfg.razao_social ? '<div class="razao">' + escapeHtml(cfg.razao_social) + '</div>' : '') +
      '<div class="contato">' +
        (cfg.cnpj ? 'CNPJ ' + escapeHtml(cfg.cnpj) + ' &nbsp;&bull;&nbsp; ' : '') +
        (cfg.endereco ? escapeHtml(cfg.endereco) + ' &nbsp;&bull;&nbsp; ' : '') +
        (cfg.telefone ? escapeHtml(cfg.telefone) : '') +
      '</div></div>' +
    '<div class="data">' + escapeHtml(dataExtenso) + '</div>' +
    '<h1>' + escapeHtml(titulo) + '</h1>' +
    (body.subtitulo ? '<div class="sub">' + escapeHtml(body.subtitulo) + '</div>' : '') +
    (tipo !== 'declaracao' ? blocoPaciente(pac, body) : '') +
    miolo +
    '<p style="margin-top:22px"><i>\u00c0 disposi\u00e7\u00e3o.</i></p>' +
    assinatura +
    '<div class="rodape">' +
      (cfg.lema ? '<div class="lema">"' + escapeHtml(cfg.lema) + '"</div>' : '') +
      (cfg.rodape ? '<div>' + escapeHtml(cfg.rodape) + '</div>' : '') +
    '</div></body></html>';
}

function blocoPaciente(pac, body) {
  let t = '<table>';
  t += '<tr><td class="rot">Paciente</td><td>' + escapeHtml(pac.nome||'') + '</td></tr>';
  if (body.cpf) t += '<tr><td class="rot">CPF</td><td>' + escapeHtml(body.cpf) + '</td></tr>';
  return t + '</table>';
}

function mioloDeclaracao(body) {
  const paragrafos = String(body.texto||'').split(/\n\s*\n/).filter(function(p){ return p.trim(); });
  return paragrafos.map(function(p){
    return '<p>' + escapeHtml(p.trim()).replace(/\n/g,'<br>') + '</p>';
  }).join('');
}

function mioloProposta(body, tipo) {
  let h = '';
  let n = 0;

  if ((body.protocolo||[]).length) {
    n++;
    h += '<h2>' + n + '. ' + escapeHtml(body.protocolo_titulo || 'Protocolo Individualizado') + '</h2><ul>' +
      body.protocolo.map(function(i){ return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>';
  }
  if ((body.objetivos||[]).length) {
    n++;
    h += '<h2>' + n + '. Objetivos Terap\u00eauticos</h2><ul>' +
      body.objetivos.map(function(i){ return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul>';
  }
  // O cronograma e o que distingue a proposta do orcamento
  if (tipo === 'proposta' && (body.cronograma||[]).length) {
    n++;
    h += '<h2>' + n + '. Cronograma</h2>' +
      '<table><tr><th>Sessao</th><th>Dia da semana</th><th>Dia</th><th>Profissional</th></tr>' +
      body.cronograma.map(function(s, i){
        return '<tr><td>' + (i+1) + '</td><td>' + escapeHtml(s.dia_semana||'') +
               '</td><td>' + escapeHtml(s.data||'') + '</td><td>' + escapeHtml(s.profissional||'') + '</td></tr>';
      }).join('') + '</table>';
  }
  if ((body.investimento||[]).length) {
    n++;
    h += '<h2>' + n + '. Investimento</h2><table>' +
      body.investimento.map(function(l){
        return '<tr><td class="rot">' + escapeHtml(l.rotulo||'') + '</td><td>' + escapeHtml(l.valor||'') + '</td></tr>';
      }).join('') + '</table>';
  }
  if (body.observacoes) h += '<div class="nota">' + escapeHtml(body.observacoes) + '</div>';
  return h;
}

// --- EXERCICIOS -----------------------------------------------
// A clinica mantem a biblioteca (aba Exercicios, pelo CRUD comum) e o
// profissional monta a serie de cada paciente em Prescricoes. Aqui so
// entregamos ao paciente a serie que e dele.
function meusExercicios(token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sessao invalida'};

  const ss = getSpreadsheet();
  const sp = ss.getSheetByName('Prescricoes');
  if (!sp || sp.getLastRow() < 2) return {ok:true, dados:null};

  const dados = sp.getDataRange().getValues();
  const h = dados[0];
  let minha = null;
  for (let i=1;i<dados.length;i++) {
    const o = {}; h.forEach(function(k,j){ o[k]=dados[i][j]; });
    if (!o.id || String(o.paciente_id) !== String(info.refId)) continue;
    if (String(o.ativa||'Sim').toLowerCase().indexOf('n') === 0) continue;
    // vale a mais recente
    if (!minha || String(o.criado_em||'') > String(minha.criado_em||'')) minha = o;
  }
  if (!minha) return {ok:true, dados:null};

  // Traz os dados de cada exercicio da biblioteca, para o paciente ver
  // nome, series e como fazer - nao so um identificador
  const se = ss.getSheetByName('Exercicios');
  const biblioteca = {};
  if (se && se.getLastRow() > 1) {
    const de = se.getDataRange().getValues();
    const he = de[0];
    for (let i=1;i<de.length;i++) {
      const o = {}; he.forEach(function(k,j){ o[k]=de[i][j]; });
      if (o.id) biblioteca[String(o.id)] = o;
    }
  }

  let escolhidos = [];
  try { escolhidos = JSON.parse(minha.exercicios || '[]'); } catch(e) {}

  const lista = escolhidos.map(function(x){
    const b = biblioteca[String(x.id)] || {};
    return {
      nome: b.nome || x.nome || '',
      categoria: b.categoria || '',
      descricao: b.descricao || '',
      video: b.video || '',
      series: x.series || b.series || '',
      repeticoes: x.repeticoes || b.repeticoes || '',
      frequencia: x.frequencia || '',
      observacao: x.observacao || ''
    };
  }).filter(function(x){ return x.nome; });

  return {ok:true, dados:{
    titulo: minha.titulo || 'Exercicios para casa',
    orientacoes: minha.orientacoes || '',
    atualizado_em: minha.criado_em || '',
    exercicios: lista
  }};
}

// --- CRUD -----------------------------------------------------
function listar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inv\u00e1lida: '+body.tabela};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,tabela);
  const dados = sheet.getDataRange().getValues();
  if (dados.length<2) return {ok:true,dados:[]};
  const h = dados[0];
  let rows = dados.slice(1)
    .map(row => { const o={}; h.forEach((k,i)=>o[k]=row[i]); return o; })
    .filter(r => r.id && r.id!=='');

  if (body.filtros) {
    Object.entries(body.filtros).forEach(([k,v]) => {
      rows = rows.filter(r => String(r[k]||'').toLowerCase()===String(v||'').toLowerCase());
    });
  }

  // Profissional so ve seus pacientes
  if (body.tabela==='pacientes' && body.role==='profissional' && body.nome_usuario) {
    rows = rows.filter(r => (r.terapeuta_nome||'').toLowerCase()===(body.nome_usuario||'').toLowerCase());
  }

  return {ok:true, dados:rows};
}

function salvar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inv\u00e1lida'};
  if (!body.dados) return {ok:false,erro:'Dados vazios'};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,tabela);
  let dados = sheet.getDataRange().getValues();
  let h = dados[0];

  // ID unico
  const id = 'co_'+Date.now()+'_'+Math.floor(Math.random()*9999);
  body.dados.id = id;
  body.dados.criado_em = new Date().toISOString();

  // Adicionar headers que faltam
  const novos = Object.keys(body.dados).filter(k=>!h.includes(k));
  if (novos.length>0) {
    h = [...h,...novos];
    sheet.getRange(1,1,1,h.length).setValues([h]);
  }

  const linha = h.map(k => {
    const v = body.dados[k];
    if (v===undefined||v===null) return '';
    if (Array.isArray(v)) return v.join(', ');
    return v;
  });

  sheet.appendRow(linha);
  return {ok:true, id, dados:body.dados};
}

function atualizar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inv\u00e1lida'};
  if (!body.id) return {ok:false,erro:'ID n\u00e3o fornecido'};
  if (!body.dados) return {ok:false,erro:'Dados vazios'};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,tabela);
  const todos = sheet.getDataRange().getValues();
  let h = todos[0];
  const iId = h.indexOf('id');
  if (iId===-1) return {ok:false,erro:'Coluna id n\u00e3o existe'};

  for (let i=1;i<todos.length;i++) {
    if (String(todos[i][iId])===String(body.id)) {
      body.dados.atualizado_em = new Date().toISOString();
      Object.entries(body.dados).forEach(([k,v]) => {
        let col = h.indexOf(k);
        if (col===-1) {
          h.push(k);
          col = h.length-1;
          sheet.getRange(1,col+1).setValue(k);
        }
        const val = Array.isArray(v)?v.join(', '):(v===null?'':v);
        sheet.getRange(i+1,col+1).setValue(val);
      });
      return {ok:true, id:body.id};
    }
  }
  return {ok:false, erro:'ID n\u00e3o encontrado: '+body.id};
}

function deletar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inv\u00e1lida'};
  if (!body.id) return {ok:false,erro:'ID n\u00e3o fornecido'};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,tabela);
  const todos = sheet.getDataRange().getValues();
  const h = todos[0];
  const iId = h.indexOf('id');
  for (let i=1;i<todos.length;i++) {
    if (String(todos[i][iId])===String(body.id)) {
      sheet.deleteRow(i+1);
      return {ok:true};
    }
  }
  return {ok:false,erro:'N\u00e3o encontrado'};
}

// --- PROFISSIONAIS ---------------------------------------------
function listarProfs(token) {
  const info = getInfoToken(token);
  if (!info) return {ok:false,erro:'Token inv\u00e1lido'};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  if (dados.length<2) return {ok:true,dados:[]};
  const h = dados[0];
  const profs = dados.slice(1)
    .map(row => { const o={}; h.forEach((k,i)=>{ if(k!=='senha_hash') o[k]=row[i]; }); return o; })
    .filter(r => r.id && (r.status||'Ativo')!=='Inativo');
  return {ok:true, dados:profs};
}

function convidarProf(body, token) {
  const info = getInfoToken(token);
  if (!info||info.role!=='admin') return {ok:false,erro:'Sem permiss\u00e3o de admin'};
  if (!body.email||!body.nome) return {ok:false,erro:'Nome e e-mail obrigat\u00f3rios'};

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');

  // Verificar duplicata
  for (let i=1;i<dados.length;i++) {
    if ((dados[i][iEmail]||'').toLowerCase()===(body.email||'').toLowerCase()) {
      return {ok:false,erro:'E-mail j\u00e1 cadastrado'};
    }
  }

  const id = 'prof_'+Date.now();
  // Sem senha informada, sorteia uma. Um padrao fixo seria adivinhavel por
  // qualquer pessoa que conheca o e-mail de alguem da equipe.
  const senhaInicial = String(body.senha_inicial||'').trim() || gerarSenha();

  // Garantir header
  if (!h.includes('id')) {
    sheet.getRange(1,1,1,8).setValues([['id','nome','email','funcao','nivel_acesso','senha_hash','linhas','status']]);
  }

  // Guarda ja com hash - a senha em texto puro nao fica na planilha
  sheet.appendRow([id, body.nome, body.email, body.funcao||'', body.nivel||'profissional',
                   hashSenha(body.email, senhaInicial), (body.linhas||[]).join(', '), 'Ativo']);
  // registro profissional (CREFITO, CRP, CRFa) - assina os documentos gerados
  if (body.registro) {
    const hh = sheet.getDataRange().getValues()[0];
    let iReg = hh.indexOf('registro');
    if (iReg === -1) { iReg = hh.length; sheet.getRange(1, iReg+1).setValue('registro'); }
    sheet.getRange(sheet.getLastRow(), iReg+1).setValue(body.registro);
  }

  // Enviar e-mail
  try {
    MailApp.sendEmail({
      to: body.email,
      subject: 'Seu acesso ao Sistema Casa Oliveira',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px">' +
        '<h2 style="color:#1d6b58">Casa Oliveira</h2>' +
        '<p>Ol\u00e1, <strong>' + body.nome + '</strong>!</p>' +
        '<p>Voc\u00ea foi adicionado(a) ao sistema cl\u00ednico.</p>' +
        '<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0">' +
        '<p>\u1f4e7 E-mail: <strong>' + body.email + '</strong></p>' +
        '<p>\u1f511 Senha inicial: <strong>' + senhaInicial + '</strong></p>' +
        '</div>' +
        '<p>Acesse: <a href="' + URL_SISTEMA + '">Sistema Casa Oliveira</a></p>' +
        '<p style="color:#666;font-size:13px">Troque esta senha no primeiro acesso, ' +
        'pelo menu do seu perfil \u2192 Alterar senha.</p>' +
        '</div>'
    });
  } catch(e) { /* e-mail falhou, usuario ainda criado */ }

  return {ok:true, id, mensagem:'Profissional cadastrado e e-mail enviado.'};
}

// --- HELPERS --------------------------------------------------
function getOuCria(ss, nome) {
  return ss.getSheetByName(nome) || ss.insertSheet(nome);
}

function resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// --- AUTORIZACAO DO DRIVE -------------------------------------
// Rode esta funcao UMA VEZ pelo editor (menu Executar) para o Google pedir
// permissao de acesso ao Drive. Num app da web a tela de permissao nao
// aparece sozinha - o script apenas falha - entao ela precisa ser disparada
// aqui, pela dona do script.
function autorizarDrive() {
  const achadas = DriveApp.getFoldersByName(PASTA_DOCS);
  const pasta = achadas.hasNext() ? achadas.next() : DriveApp.createFolder(PASTA_DOCS);
  Logger.log('OK! Acesso ao Drive autorizado.');
  Logger.log('Pasta dos documentos: ' + pasta.getName());
  Logger.log('Link: ' + pasta.getUrl());
  return 'Drive autorizado. Pasta: ' + pasta.getUrl();
}

// --- SETUP (rode uma vez, so numa planilha nova) --------------
// ATENCAO: este repositorio e publico. Defina a senha abaixo na hora de
// rodar e apague o valor antes de salvar o arquivo de volta no Git.
const SENHA_INICIAL_ADMIN = 'TROQUE_AQUI';

function setupAdmin() {
  const ss = getSpreadsheet();
  if(!ss) { Logger.log('ERRO: Planilha n\u00e3o encontrada.'); return; }
  if (SENHA_INICIAL_ADMIN === 'TROQUE_AQUI') {
    Logger.log('ERRO: defina SENHA_INICIAL_ADMIN antes de rodar o setup.');
    return;
  }

  // Profissionais
  const sp = getOuCria(ss,'Profissionais');
  sp.clear();
  sp.getRange(1,1,1,8).setValues([['id','nome','email','funcao','nivel_acesso','senha_hash','linhas','status']]);
  const emailAdmin = 'clinicaoliveira20@gmail.com';
  sp.appendRow(['prof_admin','Dra. Ana Paula',emailAdmin,'Gestora / S\u00f3cia','admin',
                hashSenha(emailAdmin,SENHA_INICIAL_ADMIN),'Todos','Ativo']);

  // Tokens
  const st = getOuCria(ss,'Tokens');
  st.clear();
  st.getRange(1,1,1,4).setValues([['token','email','role','expira']]);

  // Pedidos de redefinicao de senha
  const sr = getOuCria(ss,'Resets');
  sr.clear();
  sr.getRange(1,1,1,5).setValues([['token','email','expira','usado','criado_em']]);

  // Abas de dados
  const abas = ['Pacientes','PTS','Avaliacoes','Reunioes','Alertas','Monitoramentos','Checklists','Evolucoes','ListaEspera','Servicos','MyScore','Atelie','Programas','Documentos','Mensagens','Orcamentos','Exercicios','Prescricoes','Config'];
  abas.forEach(nome => {
    const s = getOuCria(ss,nome);
    if (s.getLastRow()===0) s.appendRow(['id','criado_em']);
  });

  Logger.log('\u2705 Setup conclu\u00eddo! Login: ' + emailAdmin);
  SpreadsheetApp.flush();
}

// --- MIGRACAO (opcional) --------------------------------------
// O login ja converte cada senha sozinho. Rode isto so se quiser
// converter todas de uma vez - depois disso, ninguem consegue ler as
// senhas na planilha, nem quem tem acesso a ela.
function migrarSenhasParaHash() {
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');
  const iSenha = h.indexOf('senha_hash');
  let n = 0;
  for (let i=1;i<dados.length;i++) {
    const email = dados[i][iEmail];
    const senha = dados[i][iSenha];
    if (email && senha && !pareceHash(senha)) {
      sheet.getRange(i+1, iSenha+1).setValue(hashSenha(email, senha));
      n++;
    }
  }
  Logger.log('\u2705 ' + n + ' senha(s) convertida(s) para hash.');
  SpreadsheetApp.flush();
}
