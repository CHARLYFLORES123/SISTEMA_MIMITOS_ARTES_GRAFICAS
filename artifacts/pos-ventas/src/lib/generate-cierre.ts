export interface CierreSale {
  id: number;
  customerName?: string | null;
  userName?: string | null;
  total: number;
  subtotal: number;
  iva: number;
  paymentMethod: string;
  payments?: Array<{ paymentMethod: string; amount: number }>;
  status: string;
  createdAt: string;
}

export interface CierreDeposit {
  id: number;
  customerName: string;
  total: number;
  deposit: number;
  depositMethod: string | null;
  createdAt: string;
  payments: Array<{ paymentMethod: string; amount: number }>;
}

export interface PaymentGroup {
  method: string;
  count: number;
  total: number;
}

export interface CierreData {
  date: string;
  sales: CierreSale[];
  groups: PaymentGroup[];
  totalCompleted: number;
  totalIva: number;
  totalSubtotal: number;
  countCompleted: number;
  countCancelled: number;
  deposits?: CierreDeposit[];
  totalDeposits?: number;
  grandTotal?: number;
}

interface BusinessSettings {
  companyName: string;
  rucNit?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  currency: string;
  currencySymbol: string;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(amount: number, sym: string): string {
  return `${sym} ${amount.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-BO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDateLong(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-BO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function computeCierreData(sales: CierreSale[], date: string, deposits?: CierreDeposit[]): CierreData {
  const completed = sales.filter((s) => s.status === "completada");
  const cancelled = sales.filter((s) => s.status !== "completada");

  const groupMap = new Map<string, PaymentGroup>();
  for (const s of completed) {
    const payments = s.payments?.length
      ? s.payments
      : [{ paymentMethod: s.paymentMethod, amount: s.total }];
    for (const payment of payments) {
      const existing = groupMap.get(payment.paymentMethod);
      if (existing) {
        existing.count++;
        existing.total += payment.amount;
      } else {
        groupMap.set(payment.paymentMethod, { method: payment.paymentMethod, count: 1, total: payment.amount });
      }
    }
  }

  // Include reservation deposits in method groups
  if (deposits && deposits.length > 0) {
    for (const dep of deposits) {
      const payments = dep.payments?.length
        ? dep.payments
        : [{ paymentMethod: dep.depositMethod || "Efectivo", amount: dep.deposit }];
      for (const payment of payments) {
        const existing = groupMap.get(payment.paymentMethod);
        if (existing) {
          existing.count++;
          existing.total += payment.amount;
        } else {
          groupMap.set(payment.paymentMethod, { method: payment.paymentMethod, count: 1, total: payment.amount });
        }
      }
    }
  }

  const totalCompleted = completed.reduce((sum, s) => sum + s.total, 0);
  const totalSubtotal = completed.reduce((sum, s) => sum + s.subtotal, 0);
  const totalIva = completed.reduce((sum, s) => sum + s.iva, 0);
  const totalDeposits = (deposits || []).reduce((sum, d) => sum + d.deposit, 0);
  const grandTotal = totalCompleted + totalDeposits;

  return {
    date,
    sales,
    groups: Array.from(groupMap.values()).sort((a, b) => b.total - a.total),
    totalCompleted,
    totalSubtotal,
    totalIva,
    countCompleted: completed.length,
    countCancelled: cancelled.length,
    deposits: deposits ?? [],
    totalDeposits,
    grandTotal,
  };
}

export function buildCierreHTML(
  data: CierreData,
  settings: BusinessSettings
): string {
  const sym = escHtml(settings.currencySymbol || "Bs");
  const generatedAt = fmtDate(new Date().toISOString());
  const dateLabel = escHtml(fmtDateLong(data.date));

  const groupRows = data.groups
    .map(
      (g) => `
    <tr>
      <td>${escHtml(g.method)}</td>
      <td class="num">${g.count}</td>
      <td class="num bold">${sym} ${g.total.toFixed(2)}</td>
      <td class="num">${data.totalCompleted > 0 ? ((g.total / data.totalCompleted) * 100).toFixed(1) : "0.0"}%</td>
    </tr>`
    )
    .join("");

  const saleRows = data.sales
    .map((s) => {
      const completed = s.status === "completada";
      return `
    <tr class="${completed ? "" : "cancelled-row"}">
      <td class="mono">#${String(s.id).padStart(6, "0")}</td>
      <td>${escHtml(fmtDate(s.createdAt))}</td>
      <td>${escHtml(s.customerName || "Consumidor Final")}</td>
      <td>${escHtml(s.paymentMethod)}</td>
      <td class="num ${completed ? "bold" : "cancelled-text"}">${completed ? `${sym} ${s.total.toFixed(2)}` : "ANULADA"}</td>
    </tr>`;
    })
    .join("");

  const depositRows = (data.deposits || [])
    .map((d) => {
      const breakdown = d.payments?.length > 1
        ? d.payments.map((p) => `${p.paymentMethod}: ${sym} ${p.amount.toFixed(2)}`).join(" / ")
        : (d.payments?.[0]?.paymentMethod ? `${d.payments[0].paymentMethod}: ${sym} ${d.payments[0].amount.toFixed(2)}` : (d.depositMethod || "Efectivo"));
      return `
    <tr>
      <td class="mono">#${String(d.id).padStart(6, "0")}</td>
      <td>${escHtml(fmtDate(d.createdAt))}</td>
      <td>${escHtml(d.customerName)}</td>
      <td><span style="font-weight:600;color:#92400e;">${escHtml(breakdown)}</span></td>
      <td class="num">${sym} ${d.total.toFixed(2)}</td>
      <td class="num bold" style="color:#047857;">+${sym} ${d.deposit.toFixed(2)}</td>
    </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Cierre de Caja — ${data.date}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm 18mm;
    }
    @media print {
      .no-print { display: none !important; }
      html, body { background: #fff; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      color: #111;
      background: #f0f2f7;
    }
    .page {
      background: #fff;
      max-width: 780px;
      margin: 0 auto;
      padding: 10mm;
    }
    /* HEADER */
    .header {
      background: #4F46E5;
      color: #fff;
      padding: 8mm 10mm;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6mm;
    }
    .header .company { font-size: 20px; font-weight: bold; }
    .header .sub { font-size: 10px; color: #c7d2fe; margin-top: 1.5mm; }
    .header .badge {
      background: #fff;
      color: #4F46E5;
      font-weight: bold;
      font-size: 13px;
      padding: 3mm 6mm;
      border-radius: 4px;
      text-align: center;
      min-width: 90px;
    }
    .header .badge .label { font-size: 9px; color: #6366f1; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 1mm; }
    /* DATE BAR */
    .date-bar {
      background: #eef0f5;
      border-left: 4px solid #4F46E5;
      padding: 3mm 5mm;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
      font-weight: bold;
      color: #333;
      margin-bottom: 6mm;
      text-transform: capitalize;
    }
    /* SUMMARY CARDS */
    .cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4mm;
      margin-bottom: 6mm;
    }
    .card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 4mm 5mm;
      text-align: center;
    }
    .card.green { border-top: 3px solid #10b981; }
    .card.indigo { border-top: 3px solid #4F46E5; }
    .card.amber { border-top: 3px solid #f59e0b; }
    .card.red { border-top: 3px solid #ef4444; }
    .card .c-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 1.5mm; }
    .card .c-value { font-size: 17px; font-weight: bold; color: #0f172a; }
    .card .c-sub { font-size: 9px; color: #64748b; margin-top: 0.5mm; }
    /* SECTION TITLE */
    .section-title {
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #4F46E5;
      margin-bottom: 3mm;
      padding-bottom: 1.5mm;
      border-bottom: 2px solid #e0e7ff;
    }
    /* TABLES */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 6mm;
      font-size: 10.5px;
    }
    thead th {
      background: #4F46E5;
      color: #fff;
      padding: 2.5mm 3mm;
      text-align: left;
      font-size: 10px;
      font-weight: bold;
    }
    thead th.num { text-align: right; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody td { padding: 2mm 3mm; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
    td.num { text-align: right; }
    td.bold { font-weight: bold; }
    td.mono { font-family: 'Courier New', monospace; font-size: 10px; color: #4F46E5; }
    .cancelled-row td { color: #9ca3af; }
    .cancelled-text { color: #ef4444 !important; font-weight: bold; }
    tfoot td {
      padding: 2.5mm 3mm;
      font-weight: bold;
      background: #eef0f5;
      border-top: 2px solid #4F46E5;
    }
    /* TOTALS BLOCK */
    .totals-block {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 8mm;
    }
    .totals-inner {
      width: 200px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }
    .tot-row {
      display: flex;
      justify-content: space-between;
      padding: 2mm 4mm;
      font-size: 10.5px;
      border-bottom: 1px solid #e2e8f0;
    }
    .tot-row .lbl { color: #64748b; }
    .tot-row.grand {
      background: #4F46E5;
      color: #fff;
      font-size: 13px;
      font-weight: bold;
      border-bottom: none;
    }
    /* SIGNATURES */
    .signatures {
      display: flex;
      gap: 10mm;
      margin-top: 12mm;
    }
    .sig {
      flex: 1;
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #94a3b8;
      margin-bottom: 1.5mm;
    }
    .sig-label { font-size: 9.5px; color: #64748b; }
    /* FOOTER */
    .footer {
      margin-top: 8mm;
      text-align: center;
      font-size: 9px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 3mm;
    }
    /* Print button */
    .print-btn {
      display: block;
      margin: 6mm auto;
      padding: 3mm 12mm;
      background: #4F46E5;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }
  </style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div>
      <div class="company">${escHtml(settings.companyName)}</div>
      <div class="sub">
        ${settings.rucNit ? `NIT/RUC: ${escHtml(settings.rucNit)}` : ""}
        ${settings.phone ? ` &bull; Tel: ${escHtml(settings.phone)}` : ""}
        ${settings.address ? ` &bull; ${escHtml(settings.address)}` : ""}
      </div>
    </div>
    <div class="badge">
      <div class="label">Documento</div>
      CIERRE DE CAJA
    </div>
  </div>

  <!-- DATE BAR -->
  <div class="date-bar">📅 ${dateLabel}</div>

  <!-- SUMMARY CARDS -->
  <div class="cards">
    <div class="card green">
      <div class="c-label">Total Recaudado</div>
      <div class="c-value">${sym} ${(data.grandTotal ?? data.totalCompleted).toFixed(2)}</div>
      <div class="c-sub">${data.totalDeposits && data.totalDeposits > 0 ? `ventas (${sym} ${data.totalCompleted.toFixed(2)}) + adelantos (${sym} ${data.totalDeposits.toFixed(2)})` : "ventas completadas"}</div>
    </div>
    <div class="card indigo">
      <div class="c-label">Transacciones</div>
      <div class="c-value">${data.countCompleted + (data.deposits?.length || 0)}</div>
      <div class="c-sub">${data.deposits && data.deposits.length > 0 ? `${data.countCompleted} ventas · ${data.deposits.length} adelanto(s)` : "completadas"}</div>
    </div>
    <div class="card amber">
      <div class="c-label">Promedio / Venta</div>
      <div class="c-value">${sym} ${data.countCompleted > 0 ? (data.totalCompleted / data.countCompleted).toFixed(2) : "0.00"}</div>
      <div class="c-sub">por transacción</div>
    </div>
    <div class="card red">
      <div class="c-label">Anuladas</div>
      <div class="c-value">${data.countCancelled}</div>
      <div class="c-sub">canceladas</div>
    </div>
  </div>

  <!-- PAYMENT METHODS -->
  <div class="section-title">Resumen por Método de Pago</div>
  <table>
    <thead>
      <tr>
        <th>Método de Pago</th>
        <th class="num">N° Transacciones</th>
        <th class="num">Total</th>
        <th class="num">% del Total</th>
      </tr>
    </thead>
    <tbody>
      ${groupRows || '<tr><td colspan="4" style="text-align:center;color:#9ca3af;">Sin transacciones</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td style="font-weight:bold">TOTAL RECAUDADO</td>
        <td class="num">${data.countCompleted + (data.deposits?.length || 0)}</td>
        <td class="num">${sym} ${(data.grandTotal ?? data.totalCompleted).toFixed(2)}</td>
        <td class="num">100%</td>
      </tr>
    </tfoot>
  </table>

  <!-- TOTALS -->
  <div class="totals-block">
    <div class="totals-inner">
      <div class="tot-row">
        <span class="lbl">Ventas completadas:</span>
        <span>${sym} ${data.totalCompleted.toFixed(2)}</span>
      </div>
      ${data.totalDeposits && data.totalDeposits > 0 ? `
      <div class="tot-row">
        <span class="lbl">Adelantos reservas:</span>
        <span style="color:#047857;font-weight:bold;">+${sym} ${data.totalDeposits.toFixed(2)}</span>
      </div>` : ""}
      <div class="tot-row grand">
        <span>TOTAL RECAUDADO:</span>
        <span>${sym} ${(data.grandTotal ?? data.totalCompleted).toFixed(2)}</span>
      </div>
    </div>
  </div>

  ${(data.deposits && data.deposits.length > 0) ? `
  <!-- RESERVATION DEPOSITS -->
  <div class="section-title">Adelantos de Reservas Recibidos</div>
  <table>
    <thead>
      <tr>
        <th>N° Reserva</th>
        <th>Hora</th>
        <th>Cliente</th>
        <th>Método / Desglose</th>
        <th class="num">Total Reserva</th>
        <th class="num">Adelanto</th>
      </tr>
    </thead>
    <tbody>
      ${depositRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="font-weight:bold">TOTAL ADELANTOS RECIBIDOS</td>
        <td class="num">${sym} ${data.totalDeposits?.toFixed(2) ?? "0.00"}</td>
      </tr>
    </tfoot>
  </table>
  ` : ""}

  <!-- TRANSACTION LIST -->
  <div class="section-title">Detalle de Transacciones</div>
  <table>
    <thead>
      <tr>
        <th>N° Boleta</th>
        <th>Hora</th>
        <th>Cliente</th>
        <th>Método de Pago</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${saleRows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">Sin transacciones</td></tr>'}
    </tbody>
  </table>

  <!-- SIGNATURES -->
  <div class="signatures">
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-label">Cajero / Responsable</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-label">Supervisor / Jefe</div>
    </div>
    <div class="sig">
      <div class="sig-line"></div>
      <div class="sig-label">Contador</div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    ${escHtml(settings.companyName)} &bull; Cierre de Caja: ${escHtml(data.date)} &bull; Generado el ${escHtml(generatedAt)}
  </div>

  <button class="print-btn no-print" onclick="window.print()">🖨&nbsp; Imprimir / Guardar PDF</button>
</div>

<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 500);
  });
</script>
</body>
</html>`;
}

export function printCierre(data: CierreData, settings: BusinessSettings): void {
  const html = buildCierreHTML(data, settings);
  const win = window.open("", "_blank", "width=900,height=700,scrollbars=yes");
  if (!win) {
    alert("Permite ventanas emergentes para imprimir el cierre de caja.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
