from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# Wrapper: the operator already chose Pix and confirmed payment. Open a compact QR flow.
path = Path('src/components/customer/TableServiceWorkspace.tsx')
text = path.read_text()
text = replace_once(
    text,
    """    <ServiceLocationFinancialContextPanel
      storeId={props.storeId}
      orders={activeOrders}
      couponCode={appliedCouponCode}
      requestedAmount={paymentDraft.amount}
      targetOrderIds={paymentDraft.orderIds}
    />""",
    """    <ServiceLocationFinancialContextPanel
      storeId={props.storeId}
      orders={activeOrders}
      couponCode={appliedCouponCode}
      requestedAmount={paymentDraft.amount}
      targetOrderIds={paymentDraft.orderIds}
      autoStart
      compact
    />""",
    'compact financial panel props',
)
text = replace_once(
    text,
    """                  <span className=\"font-mono text-[9px] font-black uppercase tracking-[0.18em] text-indigo-300\">
                    Cobrança Pix canônica · Mesa {props.tableCode}
                  </span>
                  <h2 id=\"staff-table-canonical-pix-title\" className=\"mt-1 text-xl font-black text-white\">
                    Gerar QR Code sem baixar a conta antes do pagamento
                  </h2>
                  <p className=\"mt-2 text-[10px] leading-relaxed text-slate-400\">
                    O Pix desta tela usa a cobrança canônica do Kyrub. O valor é relido no servidor por pedido; a seleção de itens da tela anterior não define o valor bancário e nenhum item é marcado como pago apenas por gerar o QR Code.
                  </p>""",
    """                  <span className=\"font-mono text-[9px] font-black uppercase tracking-[0.18em] text-indigo-300\">
                    Pagamento via Pix · Mesa {props.tableCode}
                  </span>
                  <h2 id=\"staff-table-canonical-pix-title\" className=\"mt-1 text-xl font-black text-white\">
                    Apresente o QR Code ao cliente
                  </h2>
                  <p className=\"mt-2 text-[10px] leading-relaxed text-slate-400\">
                    A cobrança só será concluída depois da confirmação do pagamento.
                  </p>""",
    'simple Pix modal header',
)
text = replace_once(
    text,
    """
            <div className=\"mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5 text-[9px] leading-relaxed text-emerald-100/75\">
              A cobrança permanece pendente até a autoridade correspondente ao modo escolhido: webhook verificado no Mercado Pago ou confirmação manual auditada no Pix próprio. Se houver mais de um pedido ativo na mesa, cada pedido aparece separadamente para não somar valores no navegador nem criar uma segunda autoridade financeira.
            </div>

            <div className=\"mt-5\">{canonicalCheckout}</div>""",
    """
            <div className=\"mt-4\">{canonicalCheckout}</div>""",
    'remove technical Pix explanation',
)
path.write_text(text)

# Financial panel: auto-start only when exactly one Pix provider is available.
path = Path('src/components/store/ServiceLocationFinancialContextPanel.tsx')
text = path.read_text()
text = replace_once(
    text,
    """  targetOrderIds = [],
}: {
  storeId: string;
  orders: CustomerOrder[];
  couponCode?: string;
  requestedAmount?: number;
  targetOrderIds?: string[];
}) {""",
    """  targetOrderIds = [],
  autoStart = false,
  compact = false,
}: {
  storeId: string;
  orders: CustomerOrder[];
  couponCode?: string;
  requestedAmount?: number;
  targetOrderIds?: string[];
  autoStart?: boolean;
  compact?: boolean;
}) {""",
    'panel props',
)
text = replace_once(
    text,
    """  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');""",
    """  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoStartKey, setAutoStartKey] = useState('');""",
    'auto start state',
)
marker = """  const confirmStorePix = useCallback(async (
"""
auto_effect = """  useEffect(() => {
    if (!autoStart || !options || requestedAmount <= 0 || targetOrderIds.length !== 1) return;
    const providers: LocalPixProvider[] = [
      ...(options.mercadoPagoConnected ? ['mercado-pago' as const] : []),
      ...(options.storePixEnabled ? ['store-pix' as const] : []),
    ];
    if (providers.length !== 1) return;
    const order = orders.find(candidate => candidate.id === targetOrderIds[0]);
    if (!order) return;
    const context = contexts[order.id];
    if (!context || !canOperatePix(context)) return;
    const pix = pixByOrder[order.id] ?? emptyPixState();
    if (pix.loading || pix.checkout) return;
    const key = `${order.id}:${providers[0]}:${requestedAmount.toFixed(2)}:${appliedCouponCode.trim()}`;
    if (autoStartKey === key) return;
    setAutoStartKey(key);
    void preparePix(order, context, providers[0]);
  }, [
    appliedCouponCode,
    autoStart,
    autoStartKey,
    contexts,
    options,
    orders,
    pixByOrder,
    preparePix,
    requestedAmount,
    targetOrderIds,
  ]);

"""
if marker not in text:
    raise SystemExit('confirmStorePix marker not found')
text = text.replace(marker, auto_effect + marker, 1)
text = replace_once(
    text,
    """    <section id=\"service-location-financial-context\" className=\"mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3\">
      <div className=\"flex items-start gap-2\">
        <ShieldCheck className=\"mt-0.5 h-4 w-4 shrink-0 text-indigo-300\" />
        <div>
          <h3 className=\"text-[9px] font-black uppercase text-indigo-100\">Evidência financeira canônica</h3>
          <p className=\"mt-1 text-[8px] leading-relaxed text-indigo-100/55\">
            Dinheiro confirmado e liquidação por itens são estados separados. Mercado Pago usa webhook verificado; Pix próprio usa declaração manual auditada do operador. `paidQuantity` continua reservado à alocação explícita das linhas.
          </p>
        </div>
      </div>

      {loading && <div className=\"mt-3 flex items-center gap-2 text-[8px] text-slate-500\"><LoaderCircle className=\"h-3.5 w-3.5 animate-spin\" />Conferindo evidência financeira…</div>}""",
    """    <section id=\"service-location-financial-context\" className={compact ? \"\" : \"mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3\"}>
      {!compact && (
        <div className=\"flex items-start gap-2\">
          <ShieldCheck className=\"mt-0.5 h-4 w-4 shrink-0 text-indigo-300\" />
          <div>
            <h3 className=\"text-[9px] font-black uppercase text-indigo-100\">Evidência financeira canônica</h3>
            <p className=\"mt-1 text-[8px] leading-relaxed text-indigo-100/55\">
              Dinheiro confirmado e liquidação por itens são estados separados. Mercado Pago usa webhook verificado; Pix próprio usa declaração manual auditada do operador. `paidQuantity` continua reservado à alocação explícita das linhas.
            </p>
          </div>
        </div>
      )}

      {loading && <div className=\"mt-3 flex items-center gap-2 text-[8px] text-slate-500\"><LoaderCircle className=\"h-3.5 w-3.5 animate-spin\" />{compact ? 'Preparando cobrança Pix…' : 'Conferindo evidência financeira…'}</div>}""",
    'compact technical header',
)
text = replace_once(
    text,
    """              <div className=\"flex items-start justify-between gap-3\">
                <div className=\"min-w-0\">
                  <span className=\"flex items-center gap-1.5 text-[8px] text-slate-500\"><CreditCard className=\"h-3.5 w-3.5\" />Pedido {order.id.slice(-8)}</span>
                  <strong className=\"mt-1 block text-[9px] text-white\">{context ? stateLabel(context) : 'Aguardando leitura financeira'}</strong>
                </div>
                {context && <span className=\"shrink-0 font-mono text-[9px] text-indigo-100\">{money(context.canonicalProjection.authoritativelyPaidAmount)} / {money(context.canonicalProjection.expectedAmount)}</span>}
              </div>

              {context && (
                <div className=\"mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[7px] text-slate-600\">""",
    """              {!compact && (
                <div className=\"flex items-start justify-between gap-3\">
                  <div className=\"min-w-0\">
                    <span className=\"flex items-center gap-1.5 text-[8px] text-slate-500\"><CreditCard className=\"h-3.5 w-3.5\" />Pedido {order.id.slice(-8)}</span>
                    <strong className=\"mt-1 block text-[9px] text-white\">{context ? stateLabel(context) : 'Aguardando leitura financeira'}</strong>
                  </div>
                  {context && <span className=\"shrink-0 font-mono text-[9px] text-indigo-100\">{money(context.canonicalProjection.authoritativelyPaidAmount)} / {money(context.canonicalProjection.expectedAmount)}</span>}
                </div>
              )}

              {context && !compact && (
                <div className=\"mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[7px] text-slate-600\">""",
    'hide canonical order details in compact mode',
)
old_actions = """                  {selectedForPix && requestedAmount > 0 && <p className=\"mb-2 text-[8px] text-emerald-200/75\">Valor solicitado nesta cobrança: {money(requestedAmount)}.</p>}
                  <div className=\"flex flex-wrap gap-2\">
                    {mercadoPagoAvailable && <button type=\"button\" disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'mercado-pago')} onClick={() => void preparePix(order, context, 'mercado-pago')} className=\"inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-1.5 text-[8px] font-bold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50\">{pix.loading && pix.boundProvider === 'mercado-pago' ? <LoaderCircle className=\"h-3.5 w-3.5 animate-spin\" /> : <QrCode className=\"h-3.5 w-3.5\" />}Mercado Pago</button>}
                    {storePixAvailable && <button type=\"button\" disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'store-pix')} onClick={() => void preparePix(order, context, 'store-pix')} className=\"inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[8px] font-bold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50\">{pix.loading && pix.boundProvider === 'store-pix' ? <LoaderCircle className=\"h-3.5 w-3.5 animate-spin\" /> : <QrCode className=\"h-3.5 w-3.5\" />}Pix próprio</button>}
                  </div>"""
new_actions = """                  {selectedForPix && requestedAmount > 0 && <p className={compact ? \"mb-3 text-center text-sm font-black text-emerald-100\" : \"mb-2 text-[8px] text-emerald-200/75\"}>Valor do Pix: {money(requestedAmount)}</p>}
                  {compact && autoStart && selectedForPix && !visibleCheckout && !pix.error && Number(mercadoPagoAvailable) + Number(storePixAvailable) === 1 ? (
                    <div className=\"flex min-h-20 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] text-sm font-bold text-emerald-100\"><LoaderCircle className=\"h-5 w-5 animate-spin\" />Gerando QR Code…</div>
                  ) : (
                    <>
                      {compact && mercadoPagoAvailable && storePixAvailable && !visibleCheckout && <p className=\"mb-2 text-center text-xs font-bold text-slate-300\">Como deseja receber este Pix?</p>}
                      <div className=\"flex flex-wrap justify-center gap-2\">
                        {mercadoPagoAvailable && <button type=\"button\" disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'mercado-pago')} onClick={() => void preparePix(order, context, 'mercado-pago')} className=\"inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-[9px] font-bold text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50\">{pix.loading && pix.boundProvider === 'mercado-pago' ? <LoaderCircle className=\"h-3.5 w-3.5 animate-spin\" /> : <QrCode className=\"h-3.5 w-3.5\" />}Mercado Pago</button>}
                        {storePixAvailable && <button type=\"button\" disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'store-pix')} onClick={() => void preparePix(order, context, 'store-pix')} className=\"inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[9px] font-bold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50\">{pix.loading && pix.boundProvider === 'store-pix' ? <LoaderCircle className=\"h-3.5 w-3.5 animate-spin\" /> : <QrCode className=\"h-3.5 w-3.5\" />}Pix próprio</button>}
                      </div>
                    </>
                  )}"""
text = replace_once(text, old_actions, new_actions, 'compact provider actions')
text = replace_once(
    text,
    """      <p className=\"mt-3 text-[8px] leading-relaxed text-slate-600\">O valor da cobrança é calculado no servidor pela base cobrável das linhas. A interface envia apenas IDs opacos e, opcionalmente, o código do cupom; nunca informa valor, e-mail do pagador, `paymentStatus` ou `paidQuantity`.</p>""",
    """      {!compact && <p className=\"mt-3 text-[8px] leading-relaxed text-slate-600\">O valor da cobrança é calculado no servidor pela base cobrável das linhas. A interface envia apenas IDs opacos e, opcionalmente, o código do cupom; nunca informa valor, e-mail do pagador, `paymentStatus` ou `paidQuantity`.</p>}""",
    'hide technical footer in compact mode',
)
path.write_text(text)

# Regression: the explicit staff payment action may auto-start exactly one configured provider.
path = Path('tests/local-pix-checkout-ui.test.ts')
text = path.read_text()
text = replace_once(
    text,
    """const panel = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);""",
    """const panel = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);
const tableWorkspace = readFileSync(
  'src/components/customer/TableServiceWorkspace.tsx',
  'utf8'
);""",
    'table wrapper fixture',
)
start = text.index("test('Pix UI exposes provider-specific QR only after explicit user action'")
if start < 0:
    raise SystemExit('old explicit Pix test not found')
text = text[:start] + """test('staff Pix confirmation auto-starts exactly one configured provider and keeps a compact fallback chooser', () => {
  assert.match(tableWorkspace, /onPixRequested=\{\(\) => setPixCheckoutOpen\(true\)\}/);
  assert.match(tableWorkspace, /autoStart/);
  assert.match(tableWorkspace, /compact/);
  assert.doesNotMatch(tableWorkspace, /A cobrança permanece pendente até a autoridade correspondente/);
  assert.match(panel, /if \(!autoStart \|\| !options \|\| requestedAmount <= 0 \|\| targetOrderIds\.length !== 1\) return/);
  assert.match(panel, /if \(providers\.length !== 1\) return/);
  assert.match(panel, /void preparePix\(order, context, providers\[0\]\)/);
  assert.match(panel, /Como deseja receber este Pix\?/);
  assert.match(panel, /Gerando QR Code…/);
  assert.match(panel, /onClick=\{\(\) => void preparePix\(order, context, 'mercado-pago'\)\}/);
  assert.match(panel, /onClick=\{\(\) => void preparePix\(order, context, 'store-pix'\)\}/);
  assert.match(panel, /qrCodeBase64/);
  assert.match(panel, /qrCode/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /safeTicketUrl/);
  assert.match(panel, /startsWith\('https:\/\/'\)/);
});
"""
path.write_text(text)
