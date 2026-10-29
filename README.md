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

### Evoluções: parte reservada

Cada evolução pode ter uma **parte reservada** (coluna `texto_restrito` da aba
`Evolucoes`), para informação sensível. Ela só sai do servidor para a gestão,
a coordenação da linha do paciente, a terapeuta de referência (`terapeuta_nome`
da ficha) e quem escreveu aquela evolução — a regra é a de `podeVerPaciente()`
mais a autora, aplicada em `ocultarReservado()` dentro do `listar`. Para os
demais, a coluna é removida da resposta e vem `tem_restrito:true`, e a tela só
avisa que existe uma parte reservada. Atenção: quem abre a **planilha** do
Google vê tudo; a reserva vale para o sistema.

Alterar ou excluir uma evolução também é checado no servidor: só a autora ou a
gestão. Os registros internos da Avaliação infantil (origem `infantil…`) ficam
fora dessa regra, porque são compartilhados entre quem avalia.

### Prontuário: acesso, retificação e exportação

- **Quem vê qual paciente é decidido no servidor** (`listar` e a checagem de
  escrita no `handle`), pelo e-mail do token — o `role`/`nome_usuario` que a
  tela manda é ignorado. Regra única, `podeVerPaciente()`: gestão vê tudo,
  coordenação vê as linhas da coluna `linhas` (vazia = tudo), profissional vê
  os pacientes de que é `terapeuta_nome`. Vale para a aba `Pacientes` e para as
  abas em `TABELAS_CLINICAS` (ligadas por `paciente_id`), na leitura e na escrita.
- **Evolução não se apaga, se retifica.** A tela troca o "excluir" por
  *Retificar* (só autora ou gestão), com motivo obrigatório. A versão anterior
  vai para `historico` (JSON) e a da parte reservada para `historico_restrito`,
  que o servidor esconde junto com `texto_restrito`.
- **Autoria carimbada pelo servidor** ao salvar evolução: `autor_email`,
  `autor_nome` e `autor_registro` (coluna `registro` da aba `Profissionais`)
  vêm do login, não do navegador.
- **Abas:** Evoluções aparece primeiro, mas a numeração interna (`tb0`, `tb1`…)
  não muda — as fichas são gravadas pela posição (`aba` em `Checklists`).
- **Pendência de evolução:** paciente ativo (fora do Pilates) sem evolução há
  mais de `DIAS_SEM_EVOLUCAO` (14) dias aparece em Alertas.
- **🖨 Exportar:** cópia do cadastro e das evoluções para imprimir ou salvar em
  PDF; a parte reservada só entra se quem exporta escolher.
- **Modelo SOAP:** botão no formulário da evolução.

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

### Painel de resultados do paciente

O paciente vê os testes da Avaliação física num painel de celular, um cartão
por teste: nota, faixa em cores, variação desde a avaliação escolhida e, ao
tocar, a explicação e a evolução. O relatório em papel continua sendo o
documento para o médico.

- **Onde mora:** dentro de `avaliacao/index.html`, para usar as mesmas normas
  por idade e sexo do relatório. `avaliacao/?painel=paciente` abre só o painel,
  com a sessão do paciente (`co_pac_token`); `avaliacao/?painel=demo` mostra um
  exemplo com dados fictícios.
- **Publicar:** na aba Relatório, *Painel do paciente (celular)* abre a prévia.
  *Publicar para o paciente* grava nas `Evolucoes` um registro `type:'publicado'`
  (avaliadora, registro, recado). O paciente vê **só as medidas até a data da
  última publicação**: teste novo fica de fora até publicar de novo, para a
  profissional conferir antes. *Retirar da área* grava um `publicado` com
  `retirado:true`.
- **Backend:** a ação `meus_resultados` (só paciente) devolve essas medidas, sem
  `autor_email` nem `obs`. Na área do paciente, o cartão 📊 *Meus resultados* só
  aparece quando há publicação.
- **Índice físico-funcional:** média dos percentis dos testes com referência
  publicada para idade e sexo (força de preensão, TUG, velocidade de marcha,
  sentar e levantar em 30 s). 50 é exatamente o esperado para a idade.

### Financeiro

Só gestão e administrativo acessam (`ABAS_SO_ADMIN_TUDO`). Três abas de uso
diário, cada lançamento com campo `mes` (AAAA-MM):

| Aba | Planilha | O que é |
| --- | --- | --- |
| 🧘 Pilates | `FinanceiroPilates` | Uma linha por aluno por mês. Valor digitado à mão (são vários preços). *Gerar mês com os alunos ativos* traz o mês anterior sem os inativos. Passou do vencimento sem pagar → **Atrasado**, com botão de cobrança no WhatsApp. |
| 💼 Serviços | `FinanceiroServicos` | Uma linha por venda: paciente, serviço, profissional, sessões, valor. O mês é o da data do atendimento. |
| 👥 Repasses | `FinanceiroJornadas` (turnos) | Calculado, não digitado — exceto os turnos de 4 h das instrutoras. |

As regras de repasse ficam na constante `REPASSE` do `index.html` (é o único
lugar para mudar): Fisioterapia R$ 40/h (cada sessão = 1 hora), Fisioterapia
pélvica R$ 65, TO infantil R$ 80 e TO mão R$ 117 por sessão; instrutora de
Pilates R$ 140 por turno de 4 h; coordenação do Pilates 10% das mensalidades
**previstas**; coordenação da Fisioterapia (o que **entrou no caixa** da
Fisioterapia no mês − R$ 5.000) ÷ 2, nunca negativo; coordenação da TO R$ 40
por sessão de TO infantil. "Entrou no caixa" usa o mês da data de pagamento.

As abas antigas *Terapias* e *Parceiros* continuam visíveis, marcadas como
"(antigo)", só para consultar os meses já lançados.

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

**Cadastro rápido:** só nome e telefone são obrigatórios; o resto (e-mail,
origem, campanha, linha…) fica recolhido em *Mais dados (opcional)*. Com
e-mail, o lead já nasce com acesso ao portal e cadastro em `Pacientes` com
status `Lead`; sem e-mail, fica só no funil e a conversão aponta depois para um
paciente existente.

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
