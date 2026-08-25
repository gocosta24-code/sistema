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
  programas:      'Programas',
  myscore:        'MyScore',
  atelie:         'Atelie',
};

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
    const ACOES_PACIENTE = ['logout','meu_prontuario','minha_posicao','alterar_senha_paciente'];
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
      return {ok:true, token, usuario:{id:row[iId],nome:row[iNome],email:row[iEmail],role:row[iRole]||'profissional'}};
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

  return {ok:true, dados:{
    nome: p.nome,
    linha: p.linha,
    terapeuta_nome: p.terapeuta_nome,
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
  const abas = ['Pacientes','PTS','Avaliacoes','Reunioes','Alertas','Monitoramentos','Checklists','Evolucoes','ListaEspera','Servicos','MyScore','Atelie','Programas'];
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
