from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

path = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = path.read_text()

text = replace_once(
    text,
    "  onExclude,\n  excludingLineKey,\n}: {",
    "  onExclude,\n  onTransfer,\n  excludingLineKey,\n}: {",
    'selection list transfer prop binding',
)

text = replace_once(
    text,
    "  onExclude?: (line: TableOpenLine) => void;\n  excludingLineKey?: string;",
    "  onExclude?: (line: TableOpenLine) => void;\n  onTransfer?: (line: TableOpenLine) => void;\n  excludingLineKey?: string;",
    'selection list transfer prop type',
)

exclude_block = """                {onExclude && (\n                  <button\n                    type=\"button\"\n                    onClick={() => onExclude(line)}\n                    disabled={excludingLineKey === line.key}\n                    className=\"flex min-h-7 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 text-[9px] font-black uppercase text-red-300 disabled:opacity-50\"\n                    aria-label={`Excluir ${line.name} da conta`}\n                  >\n                    <Trash2 className=\"h-3.5 w-3.5\" />\n                    {excludingLineKey === line.key ? 'Excluindo...' : 'Excluir'}\n                  </button>\n                )}\n"""
transfer_block = exclude_block + """                {onTransfer && (\n                  <button\n                    type=\"button\"\n                    onClick={() => onTransfer(line)}\n                    className=\"flex min-h-7 items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 text-[9px] font-black uppercase text-blue-300\"\n                    aria-label={`Transferir ${line.name} para outra mesa`}\n                  >\n                    <ArrowRightLeft className=\"h-3.5 w-3.5\" />\n                    Transferir\n                  </button>\n                )}\n"""
text = replace_once(text, exclude_block, transfer_block, 'row transfer action')

old_top_button = """              <div className=\"mb-4 flex items-center justify-end\">\n                <button\n                  type=\"button\"\n                  onClick={() => setView('transfer')}\n                  className=\"flex min-h-10 items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 text-[10px] font-black uppercase text-blue-300\"\n                >\n                  <ArrowRightLeft className=\"h-4 w-4\" /> Transferir\n                </button>\n              </div>\n\n"""
text = replace_once(text, old_top_button, '', 'remove isolated transfer button')

old_account_list = """                  <SelectionList\n                    lines={openLines}\n                    selections={paymentSelections}\n                    setSelections={setPaymentSelections}\n                    emptyMessage=\"Não há itens pendentes de pagamento nesta mesa.\"\n                    onExclude={line => void handleExcludeItem(line)}\n                    excludingLineKey={excludingLineKey}\n                  />"""
new_account_list = """                  <SelectionList\n                    lines={openLines}\n                    selections={paymentSelections}\n                    setSelections={setPaymentSelections}\n                    emptyMessage=\"Não há itens pendentes de pagamento nesta mesa.\"\n                    onExclude={line => void handleExcludeItem(line)}\n                    onTransfer={line => {\n                      setTransferSelections({ [line.key]: line.availableQuantity });\n                      setView('transfer');\n                    }}\n                    excludingLineKey={excludingLineKey}\n                  />"""
text = replace_once(text, old_account_list, new_account_list, 'account row transfer wiring')

path.write_text(text)

Path('tests/table-transfer-row-action.test.ts').write_text("""import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\ntest('table account keeps transfer next to item actions instead of an isolated top button', () => {\n  const workspace = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');\n\n  assert.match(workspace, /onTransfer\\?: \\(line: TableOpenLine\\) => void/);\n  assert.match(workspace, /aria-label=\\{`Transferir \\${line\\.name} para outra mesa`\\}/);\n  assert.match(workspace, /setTransferSelections\\(\\{ \\[line\\.key\\]: line\\.availableQuantity \\}\\)/);\n  assert.match(workspace, /setView\\('transfer'\\)/);\n  assert.doesNotMatch(workspace, /mb-4 flex items-center justify-end[\\s\\S]{0,500}ArrowRightLeft[\\s\\S]{0,100}Transferir/);\n});\n""")
