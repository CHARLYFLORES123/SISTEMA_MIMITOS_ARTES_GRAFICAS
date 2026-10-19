import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Download,
  Printer,
  X,
  ShoppingCart,
  Receipt,
  Star,
  Clock,
  User,
  CreditCard,
  Store,
  UserCheck,
  FileText,
} from "lucide-react";
import { downloadBoleta, printBoleta } from "@/lib/generate-boleta";
import { downloadTicket, printTicket } from "@/lib/generate-ticket";
import { useGetBusinessSettings } from "@workspace/api-client-react";
import { formatCurrency, useCurrency } from "@/contexts/currency-context";

interface SaleDetail {
  id: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

interface CompletedSale {
  id: number;
  customerName?: string | null;
  customerNitCi?: string | null;
  customerPhone?: string | null;
  userName?: string | null;
  subtotal: number;
  iva: number;
  total: number;
  paymentMethod: string;
  amountPaid?: number | null;
  changeDue?: number | null;
  status: string;
  notes?: string | null;
  createdAt: string;
  details: SaleDetail[];
  pointsEarned?: number | null;
}

interface BoletaModalProps {
  sale: CompletedSale | null;
  onClose: () => void;
}

function SpinIcon() {
  return <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />;
}

export function BoletaModal({ sale, onClose }: BoletaModalProps) {
  const { data: settings } = useGetBusinessSettings();
  const { currencySymbol } = useCurrency();
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [dlTicket, setDlTicket] = useState(false);
  const [printTicketLoading, setPrintTicketLoading] = useState(false);

  if (!sale || !settings) return null;

  const withLoading = (setter: (v: boolean) => void, fn: () => void) => {
    setter(true);
    fn();
    setTimeout(() => setter(false), 1200);
  };

  const formattedDate = (() => {
    if (!sale.createdAt) return null;
    try {
      const d = new Date(sale.createdAt);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString("es-BO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return sale.createdAt;
    }
  })();

  return (
    <Dialog open={!!sale} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-xl w-[95vw] sm:w-[32rem] p-0 overflow-hidden rounded-2xl border-0 shadow-2xl max-h-[92vh] flex flex-col [&>button]:hidden">
        {/* Cabecera de éxito con botón de cerrar */}
        <div className="bg-primary px-6 py-5 text-white text-center relative shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors flex items-center justify-center cursor-pointer shadow-xs"
            title="Cerrar ventana"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-2 shadow-inner">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">¡Venta Registrada con Éxito!</h2>
          <div className="flex flex-wrap items-center justify-center gap-2 text-white/90 text-xs mt-1.5">
            <span className="bg-white/20 px-2.5 py-0.5 rounded-full font-mono font-bold tracking-wider">
              Boleta #{String(sale.id).padStart(6, "0")}
            </span>
            {formattedDate && (
              <span className="flex items-center gap-1 opacity-90">
                <Clock className="w-3.5 h-3.5" />
                {formattedDate}
              </span>
            )}
          </div>
        </div>

        {/* Cuerpo con scroll propio para que nada se corte */}
        <div className="px-6 py-4 bg-background space-y-3.5 overflow-y-auto flex-1">
          {/* Fila Empresa y Vendedor */}
          <div className="flex items-center justify-between text-xs py-1 px-0.5 text-muted-foreground border-b border-border/60">
            <div className="flex items-center gap-1.5 font-medium text-foreground truncate max-w-[55%]">
              <Store className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate">{settings.companyName || "Mimitos Artes Gráficas"}</span>
              {settings.rucNit && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">({settings.rucNit})</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] shrink-0">
              <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Cajero: <strong className="text-foreground">{sale.userName || "Caja Principal"}</strong></span>
            </div>
          </div>

          {/* Tarjeta de Datos Cliente y Método de Pago */}
          <div className="rounded-xl border border-border bg-muted/20 divide-y divide-border/60 text-xs">
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" /> Cliente
              </span>
              <div className="text-right">
                <span className="font-semibold text-foreground text-sm block">
                  {sale.customerName || "Consumidor Final"}
                </span>
                {(sale.customerNitCi || sale.customerPhone) && (
                  <span className="text-[11px] text-muted-foreground block mt-0.5">
                    {[
                      sale.customerNitCi ? `CI/NIT: ${sale.customerNitCi}` : "",
                      sale.customerPhone ? `Tel: ${sale.customerPhone}` : "",
                    ].filter(Boolean).join(" • ")}
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-muted-foreground" /> Método de Pago
              </span>
              <span className="font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                {sale.paymentMethod}
              </span>
            </div>
          </div>

          {/* Detalle completo de Productos (sin texto cortado) */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 flex items-center justify-between border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Productos ({sale.details.length})</span>
              <span>Subtotal</span>
            </div>
            <div className="divide-y divide-border/50 max-h-52 overflow-y-auto px-4 py-1">
              {sale.details.map((d) => (
                <div key={d.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground text-sm leading-snug break-words">
                      {d.productName}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                      <span>Cantidad: <strong>{d.quantity}</strong></span>
                      <span>•</span>
                      <span>P. Unit: <strong>{formatCurrency(d.unitPrice, currencySymbol)}</strong></span>
                    </p>
                  </div>
                  <span className="font-bold text-foreground text-sm shrink-0 whitespace-nowrap pl-2">
                    {formatCurrency(d.subtotal, currencySymbol)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Resumen Financiero: Subtotal, IVA, TOTAL, Efectivo y Vuelto */}
          <div className="rounded-xl border border-border bg-muted/20 divide-y divide-border/60 text-xs overflow-hidden">
            <div className="flex justify-between items-center px-4 py-2 text-muted-foreground">
              <span>Subtotal</span>
              <span className="font-medium text-foreground">{formatCurrency(sale.subtotal, currencySymbol)}</span>
            </div>

            {sale.iva > 0 && (
              <div className="flex justify-between items-center px-4 py-2 text-muted-foreground">
                <span>IVA / Impuestos</span>
                <span className="font-medium text-foreground">{formatCurrency(sale.iva, currencySymbol)}</span>
              </div>
            )}

            <div className="flex justify-between items-center px-4 py-3 bg-primary/10">
              <span className="font-bold text-sm text-foreground uppercase tracking-wide">TOTAL A PAGAR</span>
              <span className="font-black text-xl text-primary font-mono">
                {formatCurrency(sale.total, currencySymbol)}
              </span>
            </div>

            {(() => {
              const isCash = (sale.paymentMethod || "").toLowerCase().includes("efectivo") || sale.amountPaid != null;
              if (!isCash) return null;
              const rec = sale.amountPaid !== undefined && sale.amountPaid !== null ? Number(sale.amountPaid) : Number(sale.total);
              const chg = sale.changeDue !== undefined && sale.changeDue !== null ? Number(sale.changeDue) : 0;
              return (
                <div className="px-4 py-2.5 bg-emerald-500/10 border-t border-emerald-500/20 space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-emerald-900 dark:text-emerald-200 font-medium">Efectivo Recibido:</span>
                    <span className="font-bold text-emerald-950 dark:text-emerald-100 font-mono text-sm">
                      {formatCurrency(rec, currencySymbol)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-emerald-900 dark:text-emerald-200 font-bold">Cambio / Vuelto:</span>
                    <span className="font-black text-lg text-emerald-700 dark:text-emerald-300 font-mono">
                      {formatCurrency(chg, currencySymbol)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Notas u Observaciones */}
          {sale.notes && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wide text-amber-800 dark:text-amber-300">
                <FileText className="w-3.5 h-3.5" />
                <span>Detalles / Descuento / Observaciones:</span>
              </div>
              <p className="mt-1 leading-relaxed">{sale.notes}</p>
            </div>
          )}

          {/* Puntos Ganados */}
          {sale.pointsEarned && sale.pointsEarned > 0 ? (
            <div className="p-3 bg-gradient-to-r from-amber-500/15 to-yellow-500/10 border border-amber-400/40 rounded-xl text-xs flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600 shrink-0 font-bold shadow-xs">
                <Star className="w-5 h-5 fill-amber-400 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-amber-950 dark:text-amber-200 text-xs">
                  ¡Ganaste +{sale.pointsEarned.toLocaleString("es")} puntos en esta compra!
                </p>
                <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                  El cliente puede acumularlos para descuentos en sus próximas compras.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Botones de acción fijados en el pie */}
        <div className="px-6 py-3.5 bg-muted/40 border-t border-border shrink-0 space-y-2">
          {/* Fila 1 — Boleta A4 */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl gap-1.5 h-10 text-xs sm:text-sm font-semibold shadow-xs"
              onClick={() => withLoading(setDownloading, () => downloadBoleta(sale, settings))}
              disabled={downloading}
            >
              {downloading ? <SpinIcon /> : <Download className="w-4 h-4 text-primary" />}
              Boleta PDF (A4)
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-xl gap-1.5 h-10 text-xs sm:text-sm font-semibold shadow-xs"
              onClick={() => withLoading(setPrinting, () => printBoleta(sale, settings))}
              disabled={printing}
            >
              {printing ? <SpinIcon /> : <Printer className="w-4 h-4 text-primary" />}
              Imprimir A4
            </Button>
          </div>

          {/* Fila 2 — Ticket térmico 80mm */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl gap-1.5 h-10 text-xs sm:text-sm font-semibold border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10 shadow-xs"
              onClick={() => withLoading(setDlTicket, () => downloadTicket(sale, settings))}
              disabled={dlTicket}
            >
              {dlTicket ? <SpinIcon /> : <Receipt className="w-4 h-4 text-amber-600" />}
              Ticket PDF (80mm)
            </Button>
            <Button
              variant="outline"
              className="flex-1 rounded-xl gap-1.5 h-10 text-xs sm:text-sm font-semibold border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10 shadow-xs"
              onClick={() => withLoading(setPrintTicketLoading, () => printTicket(sale, settings))}
              disabled={printTicketLoading}
            >
              {printTicketLoading ? <SpinIcon /> : <Printer className="w-4 h-4 text-amber-600" />}
              Imprimir Ticket
            </Button>
          </div>

          {/* Fila 3 — Continuar a Nueva venta */}
          <Button
            className="w-full rounded-xl h-11 gap-2 font-bold text-sm shadow-md transition-all hover:brightness-105"
            onClick={onClose}
          >
            <ShoppingCart className="w-4 h-4" />
            Continuar / Nueva Venta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
