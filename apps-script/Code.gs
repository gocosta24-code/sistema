// ============================================================
// CASA OLIVEIRA — APPS SCRIPT API
//
// COMO ATUALIZAR:
// 1. Abra: docs.google.com/spreadsheets/d/12HfN3lxg-JVC-vT7_4FXC334xAakItc5jjYQt8lyCWk
// 2. Extensões → Apps Script
// 3. Apague tudo e cole este código
// 4. Salve (Ctrl+S)
// 5. Implantar → Gerenciar implantações → editar (lápis) →
//    Versão: "Nova versão" → Implantar
//    (NÃO crie uma implantação nova: o URL mudaria e o sistema pararia)
//
// As senhas em texto puro que já estão na planilha são convertidas para
// hash sozinhas, no primeiro login de cada pessoa. Ninguém precisa
// cadastrar senha de novo.
// ============================================================

const SHEET_ID = '12HfN3lxg-JVC-vT7_4FXC334xAakItc5jjYQt8lyCWk';

// Endereço do sistema publicado — usado no e-mail de convite
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
};

// ─── ENTRY POINTS ────────────────────────────────────────────
function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    const params = e.parameter || {};
    let body = {};
    // Priority 1: GET ?data= param (main method — no CORS issues)
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

    // Recuperação de senha roda sem sessão — quem esqueceu a senha não tem token
    const SEM_LOGIN = ['login','login_paciente','solicitar_reset','redefinir_senha'];
    if (SEM_LOGIN.indexOf(action) === -1 && !validarToken(token)) {
      return resp({ok:false, erro:'Token inválido ou expirado'});
    }

    // Conta de paciente só alcança o próprio prontuário. A permissão é
    // decidida aqui pelo que está gravado no token, nunca pelo que o
    // navegador diz ser — senão bastaria forjar o pedido para ler a ficha
    // de outra pessoa.
    const ACOES_PACIENTE = ['logout','meu_prontuario','minha_posicao','alterar_senha_paciente'];
    if (SEM_LOGIN.indexOf(action) === -1) {
      const info = getInfoToken(token);
      const ehPaciente = info && info.role === 'paciente';
      if (ehPaciente && ACOES_PACIENTE.indexOf(action) === -1) {
        return resp({ok:false, erro:'Sem permissão'});
      }
      if (!ehPaciente && ACOES_PACIENTE.indexOf(action) !== -1 && action !== 'logout') {
        return resp({ok:false, erro:'Esta área é do paciente'});
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
      default:              return resp({ok:false, erro:'Ação desconhecida: '+action});
    }
  } catch(err) {
    return resp({ok:false, erro:err.toString()});
  }
}

// ─── SENHAS ───────────────────────────────────────────────────
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

// Sem caracteres ambíguos (0/O, 1/l/I) — a pessoa digita isto vindo do e-mail
function gerarSenha() {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i=0;i<10;i++) s += chars.charAt(Math.floor(Math.random()*chars.length));
  return s;
}

// Aceita o hash novo e, durante a transição, a senha em texto puro que
// ainda estiver gravada. Devolve se bateu e se precisa migrar.
function conferirSenha(email, guardada, informada) {
  if (!guardada) return {ok:true, migrar:true};   // conta sem senha definida
  if (pareceHash(guardada)) {
    return {ok: guardada === hashSenha(email, informada), migrar:false};
  }
  return {ok: String(guardada) === String(informada), migrar:true};
}

// ─── AUTH ─────────────────────────────────────────────────────
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
  return {ok:false, erro:'E-mail não encontrado'};
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
  if (!info) return {ok:false,erro:'Token inválido'};

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
      // Sem esta conferência, quem alcança uma sessão aberta troca a senha
      const check = conferirSenha(info.email, dados[i][iSenha], String(body.senha_atual||''));
      if (!check.ok) return {ok:false,erro:'Senha atual incorreta'};

      sheet.getRange(i+1, iSenha+1).setValue(hashSenha(info.email, nova));
      return {ok:true};
    }
  }
  return {ok:false,erro:'Usuário não encontrado'};
}

// ─── RECUPERAÇÃO DE SENHA ─────────────────────────────────────
// Link de uso único por e-mail, válido por 1 hora. Enviar uma senha nova
// pronta deixaria ela guardada na caixa de entrada para sempre.
const RESET_VALIDADE_MIN = 60;
const RESET_INTERVALO_MIN = 2;   // espera mínima entre dois pedidos

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
  // Resposta sempre igual: dizer "e-mail não encontrado" revelaria quem
  // tem conta para qualquer pessoa que chutasse endereços.
  const generica = {ok:true};
  if (!email) return generica;

  const prof = acharProfissional(email);
  if (!prof) return generica;

  const iStatus = prof.h.indexOf('status');
  if ((prof.row[iStatus]||'').toLowerCase() === 'inativo') return generica;

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Resets');
  if (sheet.getLastRow() === 0) sheet.appendRow(['token','email','expira','usado','criado_em']);

  const dados = sheet.getDataRange().getValues();
  const agora = new Date();

  // Trava simples contra alguém disparar dezenas de e-mails
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
  sheet.appendRow([token, email, expira.toISOString(), '', agora.toISOString()]);

  const iNome = prof.h.indexOf('nome');
  const link = URL_SISTEMA + '?reset=' + encodeURIComponent(token);
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Redefinir sua senha — Sistema Casa Oliveira',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px">' +
        '<h2 style="color:#1d6b58">Casa Oliveira</h2>' +
        '<p>Olá, <strong>' + (prof.row[iNome]||'') + '</strong>!</p>' +
        '<p>Recebemos um pedido para redefinir sua senha do sistema clínico.</p>' +
        '<p style="margin:24px 0"><a href="' + link + '" ' +
        'style="background:#1d6b58;color:#fff;padding:12px 22px;border-radius:8px;' +
        'text-decoration:none;display:inline-block">Criar nova senha</a></p>' +
        '<p style="color:#666;font-size:13px">O link vale por ' + RESET_VALIDADE_MIN +
        ' minutos e só pode ser usado uma vez.</p>' +
        '<p style="color:#666;font-size:13px">Se não foi você que pediu, ignore este ' +
        'e-mail — sua senha atual continua valendo.</p>' +
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
  if (!token) return {ok:false, erro:'Link inválido'};
  if (nova.length < 6) return {ok:false, erro:'A nova senha precisa ter ao menos 6 caracteres'};

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('Resets');
  if (!sheet) return {ok:false, erro:'Link inválido ou expirado'};

  const dados = sheet.getDataRange().getValues();
  for (let i=1;i<dados.length;i++) {
    if (String(dados[i][0]) !== token) continue;

    if (dados[i][3]) return {ok:false, erro:'Este link já foi usado. Peça um novo.'};
    if (new Date() >= new Date(dados[i][2])) return {ok:false, erro:'Este link expirou. Peça um novo.'};

    const email = String(dados[i][1]||'');
    const prof = acharProfissional(email);
    if (!prof) return {ok:false, erro:'Usuário não encontrado'};

    const iSenha = prof.h.indexOf('senha_hash');
    prof.sheet.getRange(prof.linha, iSenha+1).setValue(hashSenha(email, nova));

    sheet.getRange(i+1, 4).setValue(new Date().toISOString());   // marca como usado

    // Derruba as sessões abertas: se a conta foi acessada por outra pessoa,
    // trocar a senha sozinho não a colocaria para fora.
    const st = ss.getSheetByName('Tokens');
    if (st) {
      const td = st.getDataRange().getValues();
      for (let j=td.length-1;j>=1;j--) {
        if (String(td[j][1]||'').toLowerCase() === email.toLowerCase()) st.deleteRow(j+1);
      }
    }
    return {ok:true};
  }
  return {ok:false, erro:'Link inválido ou expirado'};
}


// ─── ÁREA DO PACIENTE ─────────────────────────────────────────
// Regra que sustenta tudo aqui: o paciente é identificado pelo ref_id
// gravado no token no momento do login. Nenhuma função desta seção aceita
// id vindo do navegador — é o que impede alguém de pedir a ficha alheia.

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
  // dois falhou revelaria quem é paciente da clínica
  const generico = {ok:false, erro:'E-mail ou senha incorretos'};
  if (!achado) return generico;

  const p = achado.obj;
  if (!p.senha_hash) return {ok:false, erro:'Seu acesso ainda não foi liberado. Fale com a clínica.'};
  if (String(p.acesso||'').toLowerCase() === 'bloqueado') return {ok:false, erro:'Acesso bloqueado. Fale com a clínica.'};

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

// Devolve só o que a clínica escolheu comunicar. O prontuário técnico —
// checklists, PTS interno, evoluções — não sai daqui.
function meuProntuario(token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sessão inválida'};

  const achado = acharPacientePorId(info.refId);
  if (!achado) return {ok:false, erro:'Cadastro não encontrado'};
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
  if (!info || info.role !== 'paciente') return {ok:false, erro:'Sessão inválida'};

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

  // Mesma ordem que a clínica vê: prioridade primeiro, depois quem chegou antes
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
  const naLinha = fila.filter(function(r){ return String(r.linha||'')===String(meu.linha||''); });
  const posLinha = naLinha.findIndex(function(r){ return String(r.id)===String(meu.id); }) + 1;

  return {ok:true, dados:{
    posicao: posLinha,
    total_na_linha: naLinha.length,
    linha: meu.linha || '',
    desde: meu.data_entrada || '',
    observacao: meu.aviso_paciente || '',
  }};
}

function alterarSenhaPaciente(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'paciente' || !info.refId) return {ok:false, erro:'Sessão inválida'};
  const nova = String(body.nova_senha||'');
  if (nova.length < 6) return {ok:false, erro:'A nova senha precisa ter ao menos 6 caracteres'};

  const achado = acharPacientePorId(info.refId);
  if (!achado) return {ok:false, erro:'Cadastro não encontrado'};

  const check = conferirSenha(info.email, achado.obj.senha_hash, String(body.senha_atual||''));
  if (!check.ok) return {ok:false, erro:'Senha atual incorreta'};

  const iSenha = achado.h.indexOf('senha_hash');
  achado.sheet.getRange(achado.linha, iSenha+1).setValue(hashSenha(info.email, nova));
  return {ok:true};
}

// A clínica libera o acesso e o paciente recebe a senha por e-mail
function darAcessoPaciente(body, token) {
  const info = getInfoToken(token);
  if (!info || info.role !== 'admin') return {ok:false, erro:'Sem permissão de admin'};

  const email = String(body.email||'').toLowerCase().trim();
  if (!email || email.indexOf('@') === -1) return {ok:false, erro:'E-mail inválido'};
  if (!body.paciente_id) return {ok:false, erro:'Paciente não informado'};

  const achado = acharPacientePorId(body.paciente_id);
  if (!achado) return {ok:false, erro:'Paciente não encontrado'};

  // Um e-mail não pode servir a dois cadastros: o login ficaria ambíguo e
  // a pessoa errada poderia acabar vendo a ficha errada
  const outro = acharPacientePorEmail(email);
  if (outro && String(outro.obj.id) !== String(body.paciente_id)) {
    return {ok:false, erro:'Este e-mail já está em uso por outro paciente'};
  }

  const senha = gerarSenha();
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
  setar('senha_hash', hashSenha(email, senha));
  setar('acesso', 'Liberado');

  try {
    MailApp.sendEmail({
      to: email,
      subject: 'Seu acesso — Casa Oliveira',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px">' +
        '<h2 style="color:#1d6b58">Casa Oliveira</h2>' +
        '<p>Olá, <strong>' + (achado.obj.nome||'') + '</strong>!</p>' +
        '<p>Você já pode acompanhar seu atendimento pela internet.</p>' +
        '<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0">' +
        '<p>📧 E-mail: <strong>' + email + '</strong></p>' +
        '<p>🔑 Senha: <strong>' + senha + '</strong></p>' +
        '</div>' +
        '<p>Acesse: <a href="' + URL_SISTEMA + '?area=paciente">Minha área</a></p>' +
        '<p style="color:#666;font-size:13px">Troque a senha no primeiro acesso. ' +
        'Se não reconhece este e-mail, avise a clínica.</p>' +
        '</div>'
    });
  } catch(e) { /* sem cota de e-mail: o acesso fica criado do mesmo jeito */ }

  return {ok:true, senha: senha};
}

// ─── CRUD ─────────────────────────────────────────────────────
function listar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inválida: '+body.tabela};
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

  // Profissional só vê seus pacientes
  if (body.tabela==='pacientes' && body.role==='profissional' && body.nome_usuario) {
    rows = rows.filter(r => (r.terapeuta_nome||'').toLowerCase()===(body.nome_usuario||'').toLowerCase());
  }

  return {ok:true, dados:rows};
}

function salvar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inválida'};
  if (!body.dados) return {ok:false,erro:'Dados vazios'};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,tabela);
  let dados = sheet.getDataRange().getValues();
  let h = dados[0];

  // ID único
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
  if (!tabela) return {ok:false,erro:'Tabela inválida'};
  if (!body.id) return {ok:false,erro:'ID não fornecido'};
  if (!body.dados) return {ok:false,erro:'Dados vazios'};
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,tabela);
  const todos = sheet.getDataRange().getValues();
  let h = todos[0];
  const iId = h.indexOf('id');
  if (iId===-1) return {ok:false,erro:'Coluna id não existe'};

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
  return {ok:false, erro:'ID não encontrado: '+body.id};
}

function deletar(body) {
  const tabela = ABAS[body.tabela];
  if (!tabela) return {ok:false,erro:'Tabela inválida'};
  if (!body.id) return {ok:false,erro:'ID não fornecido'};
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
  return {ok:false,erro:'Não encontrado'};
}

// ─── PROFISSIONAIS ─────────────────────────────────────────────
function listarProfs(token) {
  const info = getInfoToken(token);
  if (!info) return {ok:false,erro:'Token inválido'};
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
  if (!info||info.role!=='admin') return {ok:false,erro:'Sem permissão de admin'};
  if (!body.email||!body.nome) return {ok:false,erro:'Nome e e-mail obrigatórios'};

  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Profissionais');
  const dados = sheet.getDataRange().getValues();
  const h = dados[0];
  const iEmail = h.indexOf('email');

  // Verificar duplicata
  for (let i=1;i<dados.length;i++) {
    if ((dados[i][iEmail]||'').toLowerCase()===(body.email||'').toLowerCase()) {
      return {ok:false,erro:'E-mail já cadastrado'};
    }
  }

  const id = 'prof_'+Date.now();
  // Sem senha informada, sorteia uma. Um padrão fixo seria adivinhável por
  // qualquer pessoa que conheça o e-mail de alguém da equipe.
  const senhaInicial = String(body.senha_inicial||'').trim() || gerarSenha();

  // Garantir header
  if (!h.includes('id')) {
    sheet.getRange(1,1,1,8).setValues([['id','nome','email','funcao','nivel_acesso','senha_hash','linhas','status']]);
  }

  // Guarda já com hash — a senha em texto puro não fica na planilha
  sheet.appendRow([id, body.nome, body.email, body.funcao||'', body.nivel||'profissional',
                   hashSenha(body.email, senhaInicial), (body.linhas||[]).join(', '), 'Ativo']);

  // Enviar e-mail
  try {
    MailApp.sendEmail({
      to: body.email,
      subject: 'Seu acesso ao Sistema Casa Oliveira',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:480px">' +
        '<h2 style="color:#1d6b58">Casa Oliveira</h2>' +
        '<p>Olá, <strong>' + body.nome + '</strong>!</p>' +
        '<p>Você foi adicionado(a) ao sistema clínico.</p>' +
        '<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0">' +
        '<p>📧 E-mail: <strong>' + body.email + '</strong></p>' +
        '<p>🔑 Senha inicial: <strong>' + senhaInicial + '</strong></p>' +
        '</div>' +
        '<p>Acesse: <a href="' + URL_SISTEMA + '">Sistema Casa Oliveira</a></p>' +
        '<p style="color:#666;font-size:13px">Troque esta senha no primeiro acesso, ' +
        'pelo menu do seu perfil → Alterar senha.</p>' +
        '</div>'
    });
  } catch(e) { /* e-mail falhou, usuário ainda criado */ }

  return {ok:true, id, mensagem:'Profissional cadastrado e e-mail enviado.'};
}

// ─── HELPERS ──────────────────────────────────────────────────
function getOuCria(ss, nome) {
  return ss.getSheetByName(nome) || ss.insertSheet(nome);
}

function resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── SETUP (rode uma vez, só numa planilha nova) ──────────────
// ATENÇÃO: este repositório é público. Defina a senha abaixo na hora de
// rodar e apague o valor antes de salvar o arquivo de volta no Git.
const SENHA_INICIAL_ADMIN = 'TROQUE_AQUI';

function setupAdmin() {
  const ss = getSpreadsheet();
  if(!ss) { Logger.log('ERRO: Planilha não encontrada.'); return; }
  if (SENHA_INICIAL_ADMIN === 'TROQUE_AQUI') {
    Logger.log('ERRO: defina SENHA_INICIAL_ADMIN antes de rodar o setup.');
    return;
  }

  // Profissionais
  const sp = getOuCria(ss,'Profissionais');
  sp.clear();
  sp.getRange(1,1,1,8).setValues([['id','nome','email','funcao','nivel_acesso','senha_hash','linhas','status']]);
  const emailAdmin = 'clinicaoliveira20@gmail.com';
  sp.appendRow(['prof_admin','Dra. Ana Paula',emailAdmin,'Gestora / Sócia','admin',
                hashSenha(emailAdmin,SENHA_INICIAL_ADMIN),'Todos','Ativo']);

  // Tokens
  const st = getOuCria(ss,'Tokens');
  st.clear();
  st.getRange(1,1,1,4).setValues([['token','email','role','expira']]);

  // Pedidos de redefinição de senha
  const sr = getOuCria(ss,'Resets');
  sr.clear();
  sr.getRange(1,1,1,5).setValues([['token','email','expira','usado','criado_em']]);

  // Abas de dados
  const abas = ['Pacientes','PTS','Avaliacoes','Reunioes','Alertas','Monitoramentos','Checklists','Evolucoes','ListaEspera'];
  abas.forEach(nome => {
    const s = getOuCria(ss,nome);
    if (s.getLastRow()===0) s.appendRow(['id','criado_em']);
  });

  Logger.log('✅ Setup concluído! Login: ' + emailAdmin);
  SpreadsheetApp.flush();
}

// ─── MIGRAÇÃO (opcional) ──────────────────────────────────────
// O login já converte cada senha sozinho. Rode isto só se quiser
// converter todas de uma vez — depois disso, ninguém consegue ler as
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
  Logger.log('✅ ' + n + ' senha(s) convertida(s) para hash.');
  SpreadsheetApp.flush();
}
