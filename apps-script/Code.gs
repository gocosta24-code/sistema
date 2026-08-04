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

    if (action !== 'login' && !validarToken(token)) {
      return resp({ok:false, erro:'Token inválido ou expirado'});
    }

    switch(action) {
      case 'login':         return resp(login(body));
      case 'logout':        return resp(logout(token));
      case 'listar':        return resp(listar(body));
      case 'salvar':        return resp(salvar(body));
      case 'atualizar':     return resp(atualizar(body));
      case 'deletar':       return resp(deletar(body));
      case 'listar_profs':  return resp(listarProfs(token));
      case 'convidar_prof': return resp(convidarProf(body, token));
      case 'alterar_senha': return resp(alterarSenha(body, token));
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

function salvarToken(token, email, role) {
  const ss = getSpreadsheet();
  const sheet = getOuCria(ss,'Tokens');
  const dados = sheet.getDataRange().getValues();
  // Remover tokens antigos deste email
  for (let i=dados.length-1;i>=1;i--) {
    if ((dados[i][1]||'').toLowerCase()===email.toLowerCase()) sheet.deleteRow(i+1);
  }
  const expira = new Date(); expira.setDate(expira.getDate()+7);
  sheet.appendRow([token,email,role,expira.toISOString()]);
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
      if (dados[i][0]===token) return {email:dados[i][1], role:dados[i][2]};
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

  // Abas de dados
  const abas = ['Pacientes','PTS','Avaliacoes','Reunioes','Alertas','Monitoramentos','Checklists'];
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
