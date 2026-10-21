import jsPDF from "jspdf";

export interface ReservationDetailForTicket {
  id: number;
  productName: string;
  specifications?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  status?: string;
}

export interface ReservationPaymentForTicket {
  paymentMethod: string;
  amount: number;
}

export interface ReservationForTicket {
  id: number;
  customerName?: string | null;
  customerNitCi?: string | null;
  customerPhone?: string | null;
  userName?: string | null;
  status: string;
  total: number;
  deposit: number;
  balance: number;
  depositMethod?: string | null;
  reservationDate: string;
  expectedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  payments?: ReservationPaymentForTicket[];
  details: ReservationDetailForTicket[];
}

export interface BusinessSettingsForTicket {
  companyName: string;
  rucNit?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  currency: string;
  currencySymbol: string;
}

const TICKET_WIDTH_MM = 80;
const TICKET_MARGIN = 4;
const CONTENT_WIDTH = TICKET_WIDTH_MM - TICKET_MARGIN * 2;
const LINE_H = 4.8;

function fmtMoney(amount: number, sym: string): string {
  return `${sym} ${amount.toFixed(2)}`;
}

function fmtDate(isoOrDate: string): string {
  if (!isoOrDate) return "-";
  try {
    const d = new Date(isoOrDate.includes("T") ? isoOrDate : `${isoOrDate}T12:00:00`);
    if (isNaN(d.getTime())) return isoOrDate;
    return d.toLocaleDateString("es-BO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return isoOrDate;
  }
}

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getStageLabel(stage: string): string {
  switch (stage) {
    case "reserva": return "Reserva";
    case "produccion": return "En producción";
    case "listo_entrega": return "Listo para entrega";
    case "entregada": return "Entregada";
    default: return stage;
  }
}

function separator(doc: jsPDF, y: number, style: "dash" | "solid" = "dash"): number {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  if (style === "dash") {
    const segW = 2.0;
    const gap = 1.2;
    let x = TICKET_MARGIN;
    while (x < TICKET_WIDTH_MM - TICKET_MARGIN) {
      doc.line(x, y, Math.min(x + segW, TICKET_WIDTH_MM - TICKET_MARGIN), y);
      x += segW + gap;
    }
  } else {
    doc.line(TICKET_MARGIN, y, TICKET_WIDTH_MM - TICKET_MARGIN, y);
  }
  return y + 2.0;
}

function addLine(
  doc: jsPDF,
  y: number,
  left: string,
  right: string,
  bold = true,
  fontSize = 7.5,
  rightBold = true
): number {
  doc.setFontSize(fontSize);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setTextColor(0, 0, 0);
  doc.text(left, TICKET_MARGIN, y);
  doc.setFont("helvetica", rightBold ? "bold" : "normal");
  doc.text(right, TICKET_WIDTH_MM - TICKET_MARGIN, y, { align: "right" });
  return y + LINE_H;
}

function addCentered(
  doc: jsPDF,
  y: number,
  text: string,
  fontSize = 8,
  bold = true,
  color: [number, number, number] = [0, 0, 0]
): number {
  doc.setFontSize(fontSize);
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setTextColor(...color);
  doc.text(text, TICKET_WIDTH_MM / 2, y, { align: "center" });
  return y + LINE_H;
}

export async function generateReservationTicket(
  reservation: ReservationForTicket,
  settings: BusinessSettingsForTicket
): Promise<jsPDF> {
  const sym = settings.currencySymbol || "Bs";
  const numStr = `#${String(reservation.id).padStart(6, "0")}`;

  // Estimate required page height
  let estH = 75; // header + metadata
  for (const item of reservation.details) {
    estH += 12;
    if (item.specifications) {
      estH += Math.ceil(item.specifications.length / 38) * 4.5 + 2;
    }
  }
  estH += 50; // totals, deposit, balance
  if (reservation.payments && reservation.payments.length > 1) {
    estH += reservation.payments.length * 4.5;
  }
  if (reservation.notes) {
    estH += Math.ceil(reservation.notes.length / 38) * 4.5 + 8;
  }
  estH += 35; // footer

  const doc = new jsPDF({
    unit: "mm",
    format: [TICKET_WIDTH_MM, Math.max(estH, 150)],
  });

  let y = 5;

  // Header
  y = addCentered(doc, y, settings.companyName || "MIMITOS ARTES GRÁFICAS", 10.5, true);
  if (settings.rucNit) {
    y = addCentered(doc, y, `NIT/RUC: ${settings.rucNit}`, 7.5, true);
  }
  if (settings.address) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    const addrLines = doc.splitTextToSize(settings.address, CONTENT_WIDTH) as string[];
    addrLines.forEach((line: string) => {
      doc.text(line, TICKET_WIDTH_MM / 2, y, { align: "center" });
      y += 4;
    });
  }
  if (settings.phone) {
    y = addCentered(doc, y, `Tel: ${settings.phone}`, 7.5, true);
  }

  y += 0.5;
  y = separator(doc, y, "solid");

  // Title
  y = addCentered(doc, y, "RECIBO DE RESERVA / PEDIDO", 9.5, true);
  y = addCentered(doc, y, numStr, 9, true);

  // Delivery highlight box
  if (reservation.expectedAt) {
    y += 1;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(TICKET_MARGIN, y - 3, CONTENT_WIDTH, 8);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(`ENTREGA ESTIMADA: ${fmtDate(reservation.expectedAt)}`, TICKET_WIDTH_MM / 2, y + 1.5, { align: "center" });
    y += 8;
  }

  y += 0.5;
  y = separator(doc, y, "solid");

  // Customer & Meta Info
  y = addLine(doc, y, "Fecha:", fmtDate(reservation.reservationDate));
  y = addLine(doc, y, "Estado:", getStageLabel(reservation.status));
  y = addLine(doc, y, "Cliente:", reservation.customerName || "Sin cliente");
  if (reservation.customerNitCi) {
    y = addLine(doc, y, "CI/NIT:", reservation.customerNitCi);
  }
  if (reservation.customerPhone) {
    y = addLine(doc, y, "Teléfono:", reservation.customerPhone);
  }
  if (reservation.userName) {
    y = addLine(doc, y, "Atendido por:", reservation.userName);
  }

  y += 0.5;
  y = separator(doc, y, "dash");

  // Items table header
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("DESCRIPCIÓN", TICKET_MARGIN, y);
  doc.text("CANT", TICKET_MARGIN + 36, y, { align: "right" });
  doc.text("P.U.", TICKET_MARGIN + 51, y, { align: "right" });
  doc.text("TOTAL", TICKET_WIDTH_MM - TICKET_MARGIN, y, { align: "right" });
  y += LINE_H - 0.5;
  y = separator(doc, y, "dash");

  // Items list
  reservation.details.forEach((item) => {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);

    const nameLines = doc.splitTextToSize(item.productName, 34) as string[];
    nameLines.forEach((line: string, i: number) => {
      doc.text(line, TICKET_MARGIN, y + i * 4.2);
    });

    const qtyStr = Number(item.quantity) % 1 === 0 ? String(Number(item.quantity)) : Number(item.quantity).toFixed(2);
    doc.text(qtyStr, TICKET_MARGIN + 36, y, { align: "right" });
    doc.text(Number(item.unitPrice).toFixed(2), TICKET_MARGIN + 51, y, { align: "right" });
    doc.text(Number(item.subtotal).toFixed(2), TICKET_WIDTH_MM - TICKET_MARGIN, y, { align: "right" });

    y += Math.max(nameLines.length * 4.2, 5);

    // Specifications
    if (item.specifications && item.specifications.trim()) {
      doc.setFontSize(6.8);
      doc.setFont("helvetica", "italic");
      const specLines = doc.splitTextToSize(`» ${item.specifications.trim()}`, CONTENT_WIDTH - 2) as string[];
      specLines.forEach((sLine: string) => {
        doc.text(sLine, TICKET_MARGIN + 2, y);
        y += 3.8;
      });
      y += 1;
    }
  });

  y += 0.5;
  y = separator(doc, y, "dash");

  // Totals
  y = addLine(doc, y, "TOTAL PEDIDO:", fmtMoney(reservation.total, sym), true, 8.5);
  y = addLine(doc, y, "ADELANTO PAGADO:", fmtMoney(reservation.deposit, sym), true, 8.5);

  // Breakdown of deposit payments
  if (reservation.payments && reservation.payments.length > 1) {
    reservation.payments.forEach((p) => {
      y = addLine(doc, y, `  · ${p.paymentMethod}:`, fmtMoney(p.amount, sym), false, 7, false);
    });
  } else if (reservation.depositMethod && reservation.deposit > 0) {
    y = addLine(doc, y, `  · Método:`, reservation.depositMethod, false, 7, false);
  }

  y += 1;
  // Prominent Balance box
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(TICKET_MARGIN, y - 3, CONTENT_WIDTH, 9);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.text("SALDO A PAGAR:", TICKET_MARGIN + 2, y + 2.5);
  doc.text(fmtMoney(reservation.balance, sym), TICKET_WIDTH_MM - TICKET_MARGIN - 2, y + 2.5, { align: "right" });
  y += 10;

  // Notes
  if (reservation.notes && reservation.notes.trim()) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    const noteLines = doc.splitTextToSize(`Nota: ${reservation.notes.trim()}`, CONTENT_WIDTH) as string[];
    noteLines.forEach((nLine: string) => {
      doc.text(nLine, TICKET_MARGIN, y);
      y += 4;
    });
    y += 1;
  }

  y = separator(doc, y, "solid");

  // Footer
  y = addCentered(doc, y, "¡Gracias por su preferencia!", 8.5, true);
  y = addCentered(doc, y, "Presente este comprobante para recoger su pedido", 7, false);
  y = addCentered(doc, y, `${settings.companyName || "MIMITOS ARTES GRÁFICAS"} • ${numStr}`, 6.5, false);

  return doc;
}

export function buildThermalReservationHTML(
  reservation: ReservationForTicket,
  settings: BusinessSettingsForTicket
): string {
  const sym = escHtml(settings.currencySymbol || "Bs");
  const numStr = `#${String(reservation.id).padStart(6, "0")}`;

  const itemRows = reservation.details
    .map((d) => {
      const qtyStr = Number(d.quantity) % 1 === 0 ? String(Number(d.quantity)) : Number(d.quantity).toFixed(2);
      const specsHtml = d.specifications && d.specifications.trim()
        ? `<div class="specs">&raquo; <em>${escHtml(d.specifications.trim())}</em></div>`
        : "";
      return `
      <tr>
        <td class="name">
          ${escHtml(d.productName)}
          ${specsHtml}
        </td>
        <td class="num">${qtyStr}</td>
        <td class="num">${Number(d.unitPrice).toFixed(2)}</td>
        <td class="num bold">${Number(d.subtotal).toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  const paymentBreakdownHtml = reservation.payments && reservation.payments.length > 1
    ? reservation.payments.map((p) => `
        <div class="row subrow">
          <span class="lbl">&nbsp;&nbsp;&bull; ${escHtml(p.paymentMethod)}:</span>
          <span class="amt">${sym} ${Number(p.amount).toFixed(2)}</span>
        </div>
      `).join("")
    : reservation.depositMethod && reservation.deposit > 0
    ? `
        <div class="row subrow">
          <span class="lbl">&nbsp;&nbsp;&bull; M&eacute;todo:</span>
          <span class="amt">${escHtml(reservation.depositMethod)}</span>
        </div>
      `
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo Reserva ${numStr}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    @media print {
      .no-print { display: none !important; }
      html, body {
        background: #fff;
        margin: 0 !important;
        padding: 2mm 3.5mm 2mm !important;
        page-break-after: avoid !important;
        page-break-inside: avoid !important;
      }
      * { page-break-inside: avoid !important; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      font-weight: bold;
      width: 80mm;
      max-width: 80mm;
      padding: 2.5mm 3.5mm 3.5mm;
      color: #000;
      background: #fff;
      line-height: 1.25;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .company {
      font-size: 14px;
      font-weight: bold;
      text-align: center;
      letter-spacing: 0.3px;
      margin-bottom: 1mm;
    }
    .sub { font-size: 9.5px; font-weight: bold; text-align: center; color: #000; line-height: 1.3; }
    hr.solid { border: none; border-top: 1.5px solid #000; margin: 1.5mm 0; }
    hr.dash { border: none; border-top: 1.5px dashed #000; margin: 1.2mm 0; }
    .ticket-label {
      font-size: 11px;
      font-weight: bold;
      text-align: center;
      letter-spacing: 1px;
      margin: 0.5mm 0;
    }
    .ticket-num {
      font-size: 12.5px;
      font-weight: bold;
      text-align: center;
      color: #000;
      margin-bottom: 0.5mm;
    }
    .highlight-box {
      border: 1.5px solid #000;
      padding: 1.5mm 2mm;
      margin: 1.5mm 0;
      text-align: center;
      font-size: 11px;
      font-weight: bold;
      background: #fdfdfd;
    }
    .info {
      font-size: 10px;
      font-weight: bold;
      margin: 0.5mm 0;
      display: flex;
      justify-content: space-between;
      gap: 1.5mm;
      line-height: 1.2;
    }
    .info .lbl { color: #000; font-weight: bold; white-space: nowrap; }
    .info .val { text-align: right; font-weight: bold; word-break: break-word; color: #000; }
    table.items {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      font-weight: bold;
      margin: 0.8mm 0;
    }
    table.items thead th {
      font-weight: bold;
      padding-bottom: 1mm;
      border-bottom: 1.5px solid #000;
      white-space: nowrap;
      color: #000;
    }
    table.items thead th.name { text-align: left; }
    table.items thead th.num { text-align: right; }
    table.items td { padding: 0.8mm 0; vertical-align: top; font-weight: bold; color: #000; }
    table.items td.name { text-align: left; padding-right: 1.5mm; }
    table.items td.num { text-align: right; white-space: nowrap; }
    .specs {
      font-size: 9px;
      font-weight: normal;
      color: #333;
      margin-top: 0.5mm;
      padding-left: 1mm;
      white-space: pre-wrap;
    }
    .totals { font-size: 10.5px; font-weight: bold; margin-top: 0.5mm; }
    .totals .row { display: flex; justify-content: space-between; padding: 0.5mm 0; font-weight: bold; color: #000; }
    .totals .subrow { font-size: 9.5px; font-weight: normal; color: #222; }
    .balance-box {
      border: 1.8px solid #000;
      margin-top: 1.5mm;
      padding: 1.5mm 2mm;
      display: flex;
      justify-content: space-between;
      font-size: 12.5px;
      font-weight: bold;
      background: #fafafa;
    }
    .note { font-size: 9.5px; font-weight: bold; color: #000; text-align: left; margin: 1.5mm 0; white-space: pre-wrap; }
    .footer { text-align: center; margin-top: 1.5mm; font-weight: bold; }
    .footer .main { font-size: 11px; font-weight: bold; color: #000; }
    .footer .small { font-size: 9px; font-weight: normal; color: #333; margin-top: 0.5mm; }
    .print-btn {
      display: block;
      width: 100%;
      margin-top: 4mm;
      padding: 2.5mm 0;
      background: #111827;
      color: #fff;
      font-family: inherit;
      font-size: 11px;
      font-weight: bold;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="company">${escHtml(settings.companyName || "MIMITOS ARTES GRÁFICAS")}</div>
  ${settings.rucNit ? `<div class="sub">NIT/RUC: ${escHtml(settings.rucNit)}</div>` : ""}
  ${settings.address ? `<div class="sub">${escHtml(settings.address)}</div>` : ""}
  ${settings.phone ? `<div class="sub">Tel: ${escHtml(settings.phone)}</div>` : ""}

  <hr class="solid">

  <div class="ticket-label">RECIBO DE RESERVA / PEDIDO</div>
  <div class="ticket-num">${numStr}</div>

  ${reservation.expectedAt ? `
  <div class="highlight-box">
    &bull; ENTREGA ESTIMADA &bull;<br>
    <span style="font-size: 12px;">${fmtDate(reservation.expectedAt)}</span>
  </div>` : ""}

  <hr class="solid">

  <div class="info"><span class="lbl">Fecha reserva:</span><span class="val">${fmtDate(reservation.reservationDate)}</span></div>
  <div class="info"><span class="lbl">Estado:</span><span class="val">${escHtml(getStageLabel(reservation.status))}</span></div>
  <div class="info"><span class="lbl">Cliente:</span><span class="val">${escHtml(reservation.customerName || "Sin cliente")}</span></div>
  ${reservation.customerNitCi ? `<div class="info"><span class="lbl">CI/NIT:</span><span class="val">${escHtml(reservation.customerNitCi)}</span></div>` : ""}
  ${reservation.customerPhone ? `<div class="info"><span class="lbl">Tel&eacute;fono:</span><span class="val">${escHtml(reservation.customerPhone)}</span></div>` : ""}
  ${reservation.userName ? `<div class="info"><span class="lbl">Atendido por:</span><span class="val">${escHtml(reservation.userName)}</span></div>` : ""}

  <hr class="dash">

  <table class="items">
    <thead>
      <tr>
        <th class="name">DESCRIPCIÓN</th>
        <th class="num">CANT</th>
        <th class="num">P.U.</th>
        <th class="num">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <hr class="dash">

  <div class="totals">
    <div class="row">
      <span class="lbl">TOTAL PEDIDO:</span>
      <span class="amt">${sym} ${Number(reservation.total).toFixed(2)}</span>
    </div>
    <div class="row">
      <span class="lbl">ADELANTO PAGADO:</span>
      <span class="amt">${sym} ${Number(reservation.deposit).toFixed(2)}</span>
    </div>
    ${paymentBreakdownHtml}
    <div class="balance-box">
      <span>SALDO PENDIENTE:</span>
      <span>${sym} ${Number(reservation.balance).toFixed(2)}</span>
    </div>
  </div>

  ${reservation.notes && reservation.notes.trim() ? `
  <hr class="dash">
  <div class="note"><strong>Nota:</strong> ${escHtml(reservation.notes.trim())}</div>
  ` : ""}

  <hr class="solid">

  <div class="footer">
    <div class="main">&iexcl;Gracias por su preferencia!</div>
    <div class="small">Presente este comprobante para recoger su pedido</div>
    <div class="small">${escHtml(settings.companyName || "MIMITOS ARTES GRÁFICAS")} &bull; ${numStr}</div>
  </div>

  <button class="print-btn no-print" onclick="window.print()">🖨&nbsp; Imprimir Recibo</button>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 400);
    });
  </script>
</body>
</html>`;
}

export function downloadReservationTicket(
  reservation: ReservationForTicket,
  settings: BusinessSettingsForTicket
): void {
  generateReservationTicket(reservation, settings).then((doc) => {
    doc.save(`Recibo_Reserva_${String(reservation.id).padStart(6, "0")}.pdf`);
  });
}

export function printReservationTicket(
  reservation: ReservationForTicket,
  settings: BusinessSettingsForTicket
): void {
  const html = buildThermalReservationHTML(reservation, settings);
  const win = window.open("", "_blank", "width=380,height=720,scrollbars=yes");
  if (!win) {
    alert("Permite ventanas emergentes para imprimir el ticket de reserva.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
