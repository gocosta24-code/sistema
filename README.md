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
- Abas: `Profissionais`, `Tokens`, `Pacientes`, `Checklists` (fichas do prontuário)

O prontuário grava uma linha por aba do paciente em `Checklists`, com os campos
serializados em JSON na coluna `dados`.

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

## Limitação conhecida

A implantação atual do Apps Script responde HTML a requisições POST, então tudo
trafega por GET — e o Google recusa URLs acima de ~6 KB. Anotações muito longas
numa mesma aba do prontuário são barradas com aviso antes do envio. A correção é
reimplantar o Apps Script aceitando POST.
