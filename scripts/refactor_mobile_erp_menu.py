from pathlib import Path

APP_PATH = Path('src/App.tsx')
MAIN_PATH = Path('src/main.tsx')
OLD_MENU_PATH = Path('src/components/MobileErpMenuEnhancer.tsx')
WORKFLOW_PATH = Path('.github/workflows/apply_mobile_erp_menu_refactor.yml')
SCRIPT_PATH = Path(__file__)

app = APP_PATH.read_text(encoding='utf-8')

import_line = "import { MobileErpMenu } from './components/MobileErpMenu';\n"
import_anchor = "import { StaffViewport } from './components/StaffViewport';\n"
if import_line not in app:
    if import_anchor not in app:
        raise RuntimeError('Mobile ERP menu import anchor not found in App.tsx')
    app = app.replace(import_anchor, import_anchor + import_line, 1)

header_start = "          {/* Header Gestão */}\n"
content_start = "          {/* ERP Core Panel Container */}"
start_index = app.find(header_start)
end_index = app.find(content_start, start_index)
if start_index < 0 or end_index < 0:
    raise RuntimeError('ERP header boundaries not found in App.tsx')

new_header = """          {/* Header Gestão */}
          <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between gap-4 font-sans shrink-0" id="erp-main-header">

            {/* LADO ESQUERDO: Botão de fechar */}
            {!isAdminSubdomain && (
              <button
                onClick={() => setIsGestaoOpen(false)}
                className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 border border-slate-850 w-8 h-8 rounded-full flex items-center justify-center text-sm cursor-pointer shadow-sm shrink-0"
                aria-label="Fechar painel de gestão"
              >
                ✕
              </button>
            )}

            {/* CENTRO LIVRE / DIREITA: navegação mobile e desktop */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {gestaoRole === 'retailer' ? (
                <>
                  <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none flex-1 px-2" id="erp-tab-navigation-header">
                    <button
                      onClick={() => setIsConfigModalOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                      title="Configurar Perfil e Ambientes"
                      id="orange-house-config-btn"
                    >
                      <StoreIcon className="w-3.5 h-3.5" />
                      <span>Loja</span>
                    </button>

                    {[
                      { id: 'clientes', label: 'Clientes', icon: Users },
                      { id: 'caixa', label: 'Caixa', icon: DollarSign },
                      { id: 'pedidos', label: 'KDS/Vendas', icon: ClipboardList },
                      { id: 'reservas', label: 'Reservas', icon: Calendar },
                      { id: 'ponto', label: 'Ponto', icon: Fingerprint },
                      { id: 'gerencial', label: 'Gerencial', icon: LayoutGrid }
                    ].map(tab => {
                      const Icon = tab.icon;
                      const isSelected = activeSubTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveSubTab(tab.id as typeof activeSubTab)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shrink-0 ${
                            isSelected
                              ? 'bg-orange-500 text-slate-950 shadow-md shadow-orange-500/10'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <MobileErpMenu
                    activeSubTab={activeSubTab}
                    onSelectSubTab={setActiveSubTab}
                    onOpenStore={() => setIsConfigModalOpen(true)}
                  />
                </>
              ) : (
                <div className="flex items-center gap-2 px-2 shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center text-slate-950 shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-wider text-teal-400">Admin</span>
                </div>
              )}
            </div>

          </div>
"""

app = app[:start_index] + new_header + app[end_index:]
APP_PATH.write_text(app, encoding='utf-8')

main = MAIN_PATH.read_text(encoding='utf-8')
old_import = "import {MobileErpMenuEnhancer} from './components/MobileErpMenuEnhancer';\n"
old_mount = "    <MobileErpMenuEnhancer />\n"
if old_import not in main or old_mount not in main:
    raise RuntimeError('Expected MobileErpMenuEnhancer mount not found in main.tsx')
main = main.replace(old_import, '', 1).replace(old_mount, '', 1)
MAIN_PATH.write_text(main, encoding='utf-8')

if not OLD_MENU_PATH.exists():
    raise RuntimeError('Legacy MobileErpMenuEnhancer.tsx not found')
OLD_MENU_PATH.unlink()

WORKFLOW_PATH.unlink(missing_ok=True)
SCRIPT_PATH.unlink(missing_ok=True)
