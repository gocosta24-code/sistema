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
- Abas: `Profissionais`, `Tokens`, `Resets`, `Pacientes`, `Checklists` (fichas do prontuário)

O prontuário grava uma linha por aba do paciente em `Checklists`, com os campos
serializados em JSON na coluna `dados`.

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
