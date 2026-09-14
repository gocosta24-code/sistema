# Sistema Clínico Casa Oliveira

Sistema de gestão clínica: pacientes, prontuário por linha de cuidado, equipe,
alertas e financeiro.

**No ar em:** https://gocosta24-code.github.io/sistema/

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | **O sistema.** É o único arquivo que roda em produção — toda alteração é aqui. |
| `apps-script/Code.gs` | Cópia do backend (Google Apps Script). Serve de referência e histórico; o que roda de verdade é o código colado na planilha. |
| `sistema.html` | Redirecionamento para a raiz, só para não quebrar links antigos. |

As versões antigas (`casa-oliveira-v2`, `v3`, `geral`, `corrirlogin`, a tentativa
com Supabase) foram removidas da raiz por serem cópias quase idênticas em que era
fácil editar o arquivo errado. Continuam no histórico do Git:

```bash
git log --diff-filter=D --name-only    # ver o que saiu e em qual commit
git show <commit>^:'<arquivo>'         # ler o conteúdo de uma delas
```

## Como funciona

O front-end é um HTML único, sem build nem dependências. O backend é um Google
Apps Script publicado como app da web, gravando numa planilha do Google Sheets:

- Planilha: `12HfN3lxg-JVC-vT7_4FXC334xAakItc5jjYQt8lyCWk`
- Abas: `Profissionais`, `Tokens`, `Resets`, `Pacientes`, `Checklists` (fichas do prontuário), `Mensagens`, `Catalogo`, `Leads`, `LeadHistorico`

O prontuário grava uma linha por aba do paciente em `Checklists`, com os campos
serializados em JSON na coluna `dados`.

### Mensagens

A aba `Mensagens` guarda a conversa de cada paciente com a clínica e alimenta a
tela 💬 **Mensagens** do menu, que junta num lugar só tudo que ainda espera
retorno — mais antigo no topo, com badge de contagem no menu. A coluna `status`
vale `aberta`, `respondida` ou `fechada`; linhas antigas, sem status, contam como
abertas se vieram do paciente. O que o paciente escreve entra aberto; responder
pelo prontuário fecha, e a caixa *"ainda espera retorno"* serve para registrar
conversa que aconteceu por fora (WhatsApp, telefone) e ficou de ter resposta.

Quem vê o quê é decidido no backend pelo e-mail do token, não pelo navegador:
gestão vê tudo, profissional vê os pacientes em que é `terapeuta_nome`, e
coordenação vê as linhas listadas na coluna `linhas` da aba `Profissionais` —
**com a coluna vazia (ou `Todos`), a coordenação vê tudo**, como no resto do
sistema.

### Serviços

A tela 🗂️ **Serviços** lista o que a clínica oferece, agrupado por linha de
cuidado, para consulta rápida da equipe. Fica na aba `Catalogo` — cuidado com
os nomes parecidos, são três coisas diferentes:

| Aba | O que é |
| --- | --- |
| `Catalogo` | O que a clínica oferece e por quanto. É a tela Serviços. |
| `Servicos` | O serviço agendado de **um paciente** (aba 📆 Serviços do prontuário). |
| `Programas` | Etapas do fluxo que viram opção na **lista de espera** (tela 🧩 Etapas e Programas). |

Colunas do `Catalogo`: `nome`, `linha`, `descricao`, `valor`, `ativo`
(`Sim`/`Não`, seguindo o mesmo padrão de `Programas`). O valor aceita número
(`180,00`) ou texto (`Sob consulta`).

Todos consultam a lista; **só a gestão cria, edita ou inativa**, e quem barra é
o backend, não o botão escondido — o CRUD genérico não confere papel, então
`Catalogo` entra em `ABAS_SO_GESTAO`. O **valor só é enviado** para gestão e
coordenação: para o profissional o campo sai vazio da resposta, em vez de ser
escondido na tela.

### Vínculo paciente ↔ serviço

O paciente já tinha a coluna `servicos` (nomes separados por vírgula, seleção
múltipla). O que mudou é a origem das opções: antes era a lista fixa
`LINHAS[x].servicos` no código, agora é a aba `Catalogo`, só os ativos da linha
do paciente. Sem catálogo cadastrado para aquela linha, a lista fixa continua
valendo como padrão, para o formulário nunca aparecer vazio.

Serviço já vinculado **continua na lista mesmo depois de inativado**, marcado
com `⋯`. Isso não é enfeite: o formulário regrava `servicos` a partir do que
está marcado, então esconder o inativo apagaria o vínculo ao salvar a ficha.
Na ficha do paciente os serviços aparecem como chips, antes de "Dados do
cadastro" — por isso `servicos` está em `CAD_OCULTOS`, para não sair duas vezes.

### Leads

Funil de captação em duas abas: `Leads` (estado atual de cada pessoa) e
`LeadHistorico` (cada passo do caminho). **Estágio nunca muda em silêncio** —
toda mudança passa por `moverLead()` e grava uma linha de histórico com data,
estágio anterior, estágio novo, observação e autor. Sem isso não dá para saber
por que alguém parou no meio.

Para **mudar o funil**, edite `ESTAGIOS_LEAD` no `Code.gs` — é a única lista de
estágios do sistema, e a tela monta as colunas com o que o servidor mandar.
(O `DEMO_ESTAGIOS` no `index.html` é a cópia do modo demonstração; se mexer num,
mexa no outro.) Renomear um estágio não apaga nada, mas os leads ficam no nome
antigo até serem movidos.

Perder um lead exige motivo (`MOTIVOS_PERDA`), senão o funil não ensina nada.
Converter aponta o lead para um cadastro de paciente **que já existe** — não
cria paciente, que é justamente o que se quer evitar.

Acesso: gestão vê e edita tudo; **recepção também**, e é reconhecida pela coluna
`funcao` da aba `Profissionais` conter "Recepção" ou "Comercial" — não foi criado
um quarto nível de acesso, porque quem atende o telefone entra como
profissional. Coordenação vê (só lê) os leads das linhas em `linhas`. Demais
profissionais não têm acesso.

### Senhas

Ficam como SHA-256 com o e-mail como salt — nunca em texto legível, nem para
quem abre a planilha. Senhas antigas em texto puro são convertidas sozinhas no
primeiro login de cada pessoa; `migrarSenhasParaHash()` converte todas de uma vez.

**Esqueci minha senha** manda um link de uso único (`?reset=<token>`), válido por
1 hora, registrado na aba `Resets`. Ao redefinir, as sessões abertas daquela conta
são derrubadas. O pedido responde a mesma coisa para e-mail cadastrado ou não, de
propósito: a resposta não deve revelar quem tem conta.

### Rodar localmente

```bash
python3 -m http.server 8765
```

E abrir http://localhost:8765. O botão **Modo demonstração** entra sem backend,
com dados fictícios em memória — útil para testar sem tocar na planilha real.

### Atualizar o backend

Editar `apps-script/Code.gs`, colar na planilha (Extensões → Apps Script) e então
**Implantar → Gerenciar implantações → editar → Nova versão**. Criar uma
implantação nova mudaria o URL e derrubaria o sistema.

## Como o front fala com o backend

Por `POST`, com `Content-Type: text/plain`. Os dois detalhes importam:

- **`text/plain` evita o preflight de CORS.** O Apps Script não responde a
  `OPTIONS`, então `application/json` faria o navegador barrar a requisição
  antes de sair.
- **O `/exec` responde `302`** para `script.googleusercontent.com`. O navegador
  segue esse redirecionamento convertendo o método para GET, que é o que aquele
  endereço aceita — por isso funciona no navegador e falha no `curl -X POST -L`,
  que insiste em manter o POST e leva 405. Não é sinal de backend quebrado.

Se o POST falhar (rede instável, ou uma implantação futura sem `doPost`), a
requisição cai automaticamente para GET, que ainda resolve payloads de até ~6 KB
— o sistema fica lento, não morto.

Antes tudo ia por GET e evoluções longas eram barradas. Hoje o POST foi testado
até 200 KB numa requisição.
