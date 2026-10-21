import { useState, useMemo } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useGetSales, useGetBusinessSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, Receipt, Printer, Download, CalendarDays,
  Banknote, ShoppingBag, XCircle, ArrowRight, LockKeyhole, UnlockKeyhole,
} from "lucide-react";
import { useCurrency, formatCurrency } from "@/contexts/currency-context";
import { computeCierreData, printCierre } from "@/lib/generate-cierre";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { usePermissions } from "@/hooks/use-permissions";
import { Toast } from "@/lib/swal";
import { exportTablePDF } from "@/lib/export-table-pdf";

const CHART_COLORS = [
  "#4F46E5", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

type ReservationDepositItem = {
  id: number;
  customerName: string;
  userName?: string;
  total: number;
  deposit: number;
  depositMethod: string | null;
  createdAt: string;
  payments: Array<{ paymentMethod: string; amount: number }>;
};

type CashRegisterSession = {
  id: number;
  businessDate: string;
  status: "open" | "closed";
  openingAmount: number;
  cashSales: number;
  cashDeposits?: number;
  totalDeposits?: number;
  deposits?: ReservationDepositItem[];
  totalsByMethod: Record<string, number>;
  expenses: Array<{ id: number; description: string; amount: number; authorizedByName: string; createdAt: string }>;
  totalExpenses: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
} | null;

export default function CierreCaja() {
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [printing, setPrinting] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [cashActionLoading, setCashActionLoading] = useState(false);

  const { currencySymbol } = useCurrency();
  const { data: settings } = useGetBusinessSettings();
  const { role, user } = usePermissions();
  const canAuthorizeExpenses = ["admin", "inventario", "vendedor"].includes(role.toLowerCase());
  const isSeller = role.toLowerCase() === "vendedor";
  const queryClient = useQueryClient();
  const { data: registerSession, isLoading: registerLoading, error: registerError } = useQuery<CashRegisterSession>({
    queryKey: ["/api/cash-register", date],
    queryFn: () => customFetch(`/api/cash-register?date=${date}`),
    enabled: !!date,
    refetchInterval: 15000,
  });

  const refreshRegister = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/cash-register", date] });
    await queryClient.invalidateQueries({ queryKey: ["/api/sales"] });
  };

  const handleOpenRegister = async () => {
    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) return;
    setCashActionLoading(true);
    try {
      await customFetch("/api/cash-register/open", {
        method: "POST",
        body: JSON.stringify({ businessDate: date, openingAmount: amount }),
      });
      setOpeningAmount("");
      await refreshRegister();
    } catch (error) {
      Toast.fire({ icon: "error", title: error instanceof Error ? error.message : "No se pudo abrir la caja" });
    } finally {
      setCashActionLoading(false);
    }
  };

  const handleAuthorizeExpense = async () => {
    if (!registerSession || !expenseDescription.trim()) return;
    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setCashActionLoading(true);
    try {
      await customFetch(`/api/cash-register/${registerSession.id}/expenses`, {
        method: "POST",
        body: JSON.stringify({ description: expenseDescription.trim(), amount }),
      });
      setExpenseDescription("");
      setExpenseAmount("");
      await refreshRegister();
    } catch (error) {
      Toast.fire({ icon: "error", title: error instanceof Error ? error.message : "No se pudo registrar el gasto" });
    } finally {
      setCashActionLoading(false);
    }
  };

  const handleCloseRegister = async () => {
    if (!registerSession) return;
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) return;
    setCashActionLoading(true);
    try {
      await customFetch(`/api/cash-register/${registerSession.id}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCash: amount }),
      });
      setCountedCash("");
      await refreshRegister();
    } catch (error) {
      Toast.fire({ icon: "error", title: error instanceof Error ? error.message : "No se pudo cerrar la caja" });
    } finally {
      setCashActionLoading(false);
    }
  };

  const [transactionTab, setTransactionTab] = useState<"all" | "sales" | "deposits">("all");

  const { data: rawSales = [], isLoading } = useGetSales(
    {
      dateFrom: date,
      dateTo: date,
      ...(isSeller && user?.id ? { userId: user.id } : {}),
    },
    { query: { enabled: !!date } as any }
  );

  const cierreData = useMemo(
    () => computeCierreData(rawSales as any[], date, registerSession?.deposits),
    [rawSales, date, registerSession?.deposits]
  );

  const hasMovements = cierreData.sales.length > 0 || Boolean(registerSession?.deposits && registerSession.deposits.length > 0);

  type Movement = {
    id: string;
    rawId: number;
    type: "sale" | "deposit";
    docNumber: string;
    createdAt: string;
    customerName: string;
    userName: string;
    paymentMethod: string;
    amount: number;
    secondaryAmount?: number;
    status: string;
    link: string;
  };

  const combinedMovements = useMemo<Movement[]>(() => {
    const movements: Movement[] = [];

    for (const s of cierreData.sales) {
      const paymentStr = s.payments?.length
        ? s.payments.map((p) => `${p.paymentMethod}: ${formatCurrency(p.amount, currencySymbol)}`).join(" / ")
        : s.paymentMethod;
      movements.push({
        id: `sale-${s.id}`,
        rawId: s.id,
        type: "sale",
        docNumber: `#${String(s.id).padStart(6, "0")}`,
        createdAt: s.createdAt,
        customerName: s.customerName || "Consumidor Final",
        userName: (s as any).userName || "—",
        paymentMethod: paymentStr,
        amount: s.total,
        status: s.status,
        link: `/sales/${s.id}`,
      });
    }

    if (registerSession?.deposits) {
      for (const d of registerSession.deposits) {
        const paymentStr = d.payments?.length > 1
          ? d.payments.map((p) => `${p.paymentMethod}: ${formatCurrency(p.amount, currencySymbol)}`).join(" / ")
          : (d.payments?.[0]?.paymentMethod ? `${d.payments[0].paymentMethod}: ${formatCurrency(d.payments[0].amount, currencySymbol)}` : (d.depositMethod || "Efectivo"));
        movements.push({
          id: `deposit-${d.id}`,
          rawId: d.id,
          type: "deposit",
          docNumber: `#R-${String(d.id).padStart(6, "0")}`,
          createdAt: d.createdAt,
          customerName: d.customerName || "Sin cliente",
          userName: d.userName || "—",
          paymentMethod: paymentStr,
          amount: d.deposit,
          secondaryAmount: d.total,
          status: "adelanto",
          link: `/reservations`,
        });
      }
    }

    movements.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return movements;
  }, [cierreData.sales, registerSession?.deposits, currencySymbol]);

  const filteredMovements = useMemo(() => {
    if (transactionTab === "sales") return combinedMovements.filter((m) => m.type === "sale");
    if (transactionTab === "deposits") return combinedMovements.filter((m) => m.type === "deposit");
    return combinedMovements;
  }, [combinedMovements, transactionTab]);

  const handlePrint = () => {
    if (!settings) return;
    setPrinting(true);
    printCierre(cierreData, settings);
    setTimeout(() => setPrinting(false), 1500);
  };

  const handleExport = () => {
    const rows = combinedMovements.map((m) => ({
      "Tipo": m.type === "sale" ? "Venta Directa" : "Adelanto de Reserva",
      "N° Documento": m.docNumber,
      "Fecha/Hora": new Date(m.createdAt).toLocaleString("es-BO"),
      "Cliente": m.customerName,
      "Usuario": m.userName,
      "Método de Pago": m.paymentMethod,
      "Monto Recaudado": m.amount,
      "Total Operación": m.secondaryAmount ?? m.amount,
      "Estado": m.status === "adelanto" ? "Adelanto Recibido" : m.status,
    }));
    const summary = [
      ...cierreData.groups.map((g) => ({
        "Concepto": `Método: ${g.method}`,
        "Transacciones": g.count,
        "Total": g.total,
      })),
      {
        "Concepto": "--- TOTALES GENERALES ---",
        "Transacciones": cierreData.countCompleted + (registerSession?.deposits?.length || 0),
        "Total": cierreData.grandTotal ?? (cierreData.totalCompleted + (registerSession?.totalDeposits || 0)),
      },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Resumen");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Transacciones");
    if (registerSession?.deposits && registerSession.deposits.length > 0) {
      const depositRows = registerSession.deposits.map((dep) => ({
        "N° Reserva": `#${String(dep.id).padStart(6, "0")}`,
        "Fecha/Hora": new Date(dep.createdAt).toLocaleString("es-BO"),
        "Cliente": dep.customerName,
        "Total Reserva": dep.total,
        "Adelanto Recibido": dep.deposit,
        "Método / Desglose de Montos": dep.payments?.map((p) => `${p.paymentMethod}: ${p.amount.toFixed(2)}`).join(" / ") || dep.depositMethod || "Efectivo",
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(depositRows), "Adelantos de Reserva");
    }
    XLSX.writeFile(wb, `Cierre_Caja_${date}.xlsx`);
  };

  const handleExportPDF = () => {
    const paymentTotals = registerSession
      ? Object.entries(registerSession.totalsByMethod)
        .map(([method, total]) => `${method}: ${formatCurrency(total, currencySymbol)}`)
        .join(" · ")
      : "";
    const depositDetails = registerSession?.deposits?.length
      ? ` · Adelantos de reservas: ${formatCurrency(registerSession.totalDeposits ?? 0, currencySymbol)} (${registerSession.deposits.map(d => `#${d.id}: ${d.deposit.toFixed(2)} [${d.payments.map(p => `${p.paymentMethod}: ${p.amount.toFixed(2)}`).join(" / ")}]`).join(", ")})`
      : "";
    const expenseDetails = registerSession?.expenses.length
      ? ` · Gastos: ${registerSession.expenses.map((expense) => `${expense.description} (${formatCurrency(expense.amount, currencySymbol)})`).join(", ")}`
      : "";
    const cashSummary = registerSession
      ? `Apertura: ${formatCurrency(registerSession.openingAmount, currencySymbol)} · Ventas/Cobros: ${paymentTotals || "sin movimientos"}${depositDetails} · Gastos autorizados: ${formatCurrency(registerSession.totalExpenses, currencySymbol)} · Efectivo esperado: ${formatCurrency(registerSession.expectedCash, currencySymbol)}${registerSession.countedCash !== null ? ` · Efectivo contado: ${formatCurrency(registerSession.countedCash, currencySymbol)} · Diferencia: ${formatCurrency(registerSession.difference ?? 0, currencySymbol)}` : ""}${expenseDetails}`
      : "No hay una caja abierta o cerrada para esta fecha";
    exportTablePDF({
      title: `Cierre de Caja · ${date}`,
      fileName: `Cierre_Caja_${date}.pdf`,
      subtitle: cashSummary,
      headers: ["Tipo", "N° Doc", "Fecha/Hora", "Cliente", "Usuario", "Métodos de pago", "Monto", "Estado"],
      rows: combinedMovements.map((m) => [
        m.type === "sale" ? "Venta" : "Adelanto Res.",
        m.docNumber,
        new Date(m.createdAt).toLocaleString("es-BO"),
        m.customerName,
        m.userName,
        m.paymentMethod,
        formatCurrency(m.amount, currencySymbol),
        m.status === "adelanto" ? "Adelanto Recibido" : m.status,
      ]),
    });
  };

  const avg = cierreData.countCompleted > 0
    ? cierreData.totalCompleted / cierreData.countCompleted
    : 0;

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Cierre de Caja</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resumen diario de ventas y totales por método de pago
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 border border-input rounded-xl px-3 py-1.5 bg-card shadow-sm">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-0 p-0 h-auto text-sm focus-visible:ring-0 w-36 bg-transparent"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={handleExport}
            disabled={!hasMovements}
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={handleExportPDF}
            disabled={!hasMovements && !registerSession}
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>

          <Button
            size="sm"
            className="rounded-xl gap-1.5"
            onClick={handlePrint}
            disabled={printing || !settings || !hasMovements}
          >
            {printing ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Printer className="w-3.5 h-3.5" />
            )}
            Imprimir Cierre
          </Button>
        </div>
      </div>

      <Card className="border-primary/15 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {registerSession?.status === "open" ? <UnlockKeyhole className="h-4 w-4 text-emerald-600" /> : <LockKeyhole className="h-4 w-4 text-primary" />}
            Apertura y cierre de caja
          </CardTitle>
          <p className="text-xs text-muted-foreground">Caja individual del usuario · {date}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {registerLoading ? <p className="text-sm text-muted-foreground">Consultando caja...</p>
            : registerError ? <p role="alert" className="text-sm text-destructive">{registerError instanceof Error ? registerError.message : "No se pudo consultar la caja"}</p>
              : !registerSession ? date !== format(new Date(), "yyyy-MM-dd") ? (
                <p className="text-sm text-muted-foreground">No existe una caja registrada para esta fecha. La apertura solo se puede realizar para el día actual.</p>
              ) : (
                <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void handleOpenRegister(); }}>
                  <label className="space-y-1.5 text-sm font-medium">
                    Efectivo inicial
                    <Input type="number" min="0" step="0.01" required value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} placeholder="300.00" />
                  </label>
                  <Button type="submit" disabled={cashActionLoading || openingAmount === ""}>
                    <UnlockKeyhole className="mr-2 h-4 w-4" /> Abrir caja
                  </Button>
                </form>
              ) : <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Efectivo inicial</p>
                    <p className="text-lg font-bold">{formatCurrency(registerSession.openingAmount, currencySymbol)}</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <p className="text-xs text-muted-foreground">Ventas en efectivo</p>
                    <p className="text-lg font-bold text-emerald-700">+{formatCurrency(registerSession.cashSales, currencySymbol)}</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="text-xs text-muted-foreground">Adelantos en efectivo</p>
                    <p className="text-lg font-bold text-amber-700">+{formatCurrency(registerSession.cashDeposits ?? 0, currencySymbol)}</p>
                    {Boolean(registerSession.totalDeposits && registerSession.totalDeposits > 0) && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Total adelantos: {formatCurrency(registerSession.totalDeposits ?? 0, currencySymbol)}</p>
                    )}
                  </div>
                  <div className="rounded-lg bg-red-50 p-3">
                    <p className="text-xs text-muted-foreground">Gastos autorizados</p>
                    <p className="text-lg font-bold text-red-700">-{formatCurrency(registerSession.totalExpenses, currencySymbol)}</p>
                  </div>
                  <div className="rounded-lg bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground">Efectivo esperado</p>
                    <p className="text-lg font-bold text-primary">{formatCurrency(registerSession.expectedCash, currencySymbol)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  {Object.entries(registerSession.totalsByMethod).map(([method, total]) => (
                    <span key={method}>{method}: {formatCurrency(total, currencySymbol)}</span>
                  ))}
                </div>

                {registerSession.deposits && registerSession.deposits.length > 0 && (
                  <div className="space-y-2 pt-2 border-t">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4 text-amber-600" />
                        Adelantos de Reservas Recibidos en Caja ({registerSession.deposits.length})
                      </p>
                      <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200 text-xs font-bold">
                        Total adelantos: {formatCurrency(registerSession.totalDeposits ?? 0, currencySymbol)}
                      </Badge>
                    </div>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 text-xs">
                            <TableHead className="py-2">N° Reserva</TableHead>
                            <TableHead className="py-2">Hora</TableHead>
                            <TableHead className="py-2">Cliente</TableHead>
                            <TableHead className="py-2 text-right">Total Reserva</TableHead>
                            <TableHead className="py-2 text-right">Adelanto Recibido</TableHead>
                            <TableHead className="py-2">Método de Pago / Desglose de Montos</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {registerSession.deposits.map((dep) => (
                            <TableRow key={dep.id} className="text-xs hover:bg-muted/20">
                              <TableCell className="font-mono font-bold text-primary">
                                #{String(dep.id).padStart(6, "0")}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {new Date(dep.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}
                              </TableCell>
                              <TableCell className="font-medium">
                                {dep.customerName}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(dep.total, currencySymbol)}
                              </TableCell>
                              <TableCell className="text-right font-bold text-emerald-700">
                                +{formatCurrency(dep.deposit, currencySymbol)}
                              </TableCell>
                              <TableCell>
                                {dep.payments && dep.payments.length > 1 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {dep.payments.map((p, i) => (
                                      <Badge key={i} variant="secondary" className="text-[10px] bg-amber-50 text-amber-900 border border-amber-200 py-0 font-medium">
                                        {p.paymentMethod}: {formatCurrency(p.amount, currencySymbol)}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : dep.payments && dep.payments.length === 1 ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    {dep.payments[0].paymentMethod}: {formatCurrency(dep.payments[0].amount, currencySymbol)}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">
                                    {dep.depositMethod || "Efectivo"}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {registerSession.expenses.length > 0 && <div className="space-y-1">
                  <p className="text-sm font-semibold">Gastos descontados del efectivo</p>
                  {registerSession.expenses.map((expense) => (
                    <div key={expense.id} className="flex justify-between gap-3 text-xs text-muted-foreground">
                      <span>{expense.description} · autorizado por {expense.authorizedByName}</span>
                      <span>-{formatCurrency(expense.amount, currencySymbol)}</span>
                    </div>
                  ))}
                </div>}

                {registerSession.status === "open" ? <>
                  {canAuthorizeExpenses && <form className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_160px_auto]" onSubmit={(event) => { event.preventDefault(); void handleAuthorizeExpense(); }}>
                    <label className="space-y-1 text-xs font-medium">
                      Gasto autorizado
                      <Input maxLength={300} required value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} placeholder="Descripción" />
                    </label>
                    <label className="space-y-1 text-xs font-medium">
                      Monto
                      <Input type="number" min="0.01" step="0.01" required value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} placeholder="0.00" />
                    </label>
                    <Button type="submit" variant="outline" disabled={cashActionLoading || !expenseDescription.trim() || !expenseAmount}>
                      Registrar gasto
                    </Button>
                  </form>}
                  <form className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void handleCloseRegister(); }}>
                    <label className="space-y-1.5 text-sm font-medium">
                      Efectivo contado al cierre
                      <Input type="number" min="0" step="0.01" required value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="1050.00" />
                    </label>
                    <Button type="submit" variant="destructive" disabled={cashActionLoading || countedCash === ""}>
                      <LockKeyhole className="mr-2 h-4 w-4" /> Cerrar caja y guardar diferencia
                    </Button>
                  </form>
                </> : <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
                  <div><p className="text-xs text-muted-foreground">Efectivo esperado</p><p className="font-semibold">{formatCurrency(registerSession.expectedCash, currencySymbol)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Efectivo contado</p><p className="font-semibold">{formatCurrency(registerSession.countedCash ?? 0, currencySymbol)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Diferencia registrada</p><p className={`text-lg font-bold ${(registerSession.difference ?? 0) < 0 ? "text-destructive" : (registerSession.difference ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}`}>{formatCurrency(registerSession.difference ?? 0, currencySymbol)}</p></div>
                </div>}
              </>}
        </CardContent>
      </Card>

      {/* ── Summary Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-1 bg-emerald-500 rounded-t-xl" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Total Recaudado
                </p>
                <p className="text-2xl font-bold text-emerald-600">
                  {formatCurrency(cierreData.grandTotal ?? (cierreData.totalCompleted + (registerSession?.totalDeposits || 0)), currencySymbol)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {(registerSession?.totalDeposits && registerSession.totalDeposits > 0)
                    ? `ventas (${formatCurrency(cierreData.totalCompleted, currencySymbol)}) + adelantos (${formatCurrency(registerSession.totalDeposits, currencySymbol)})`
                    : "ventas completadas"}
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="w-4.5 h-4.5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-1 bg-primary rounded-t-xl" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Transacciones
                </p>
                <p className="text-2xl font-bold text-primary">
                  {cierreData.countCompleted + (registerSession?.deposits?.length || 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {(registerSession?.deposits && registerSession.deposits.length > 0)
                    ? `${cierreData.countCompleted} ventas · ${registerSession.deposits.length} adelanto(s)`
                    : "completadas"}
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShoppingBag className="w-4.5 h-4.5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-1 bg-amber-500 rounded-t-xl" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Promedio / Venta
                </p>
                <p className="text-2xl font-bold text-amber-600">
                  {formatCurrency(avg, currencySymbol)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">por transacción</p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                <Banknote className="w-4.5 h-4.5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="h-1 bg-red-400 rounded-t-xl" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Anuladas
                </p>
                <p className="text-2xl font-bold text-red-500">
                  {cierreData.countCancelled}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">canceladas</p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center">
                <XCircle className="w-4.5 h-4.5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mr-2" />
          Cargando datos del día...
        </div>
      )}

      {!isLoading && !hasMovements && (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Receipt className="w-10 h-10 mb-3 opacity-20" />
            <p className="font-medium">Sin ventas ni adelantos registrados</p>
            <p className="text-xs mt-1">No hay transacciones ni adelantos de reservas para la fecha seleccionada.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && hasMovements && (
        <>
          {/* ── Payment Method Breakdown ───────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Por Método de Pago</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Método</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-right">Transacciones</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-right">Total</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cierreData.groups.map((g, i) => (
                      <TableRow key={g.method} className="hover:bg-muted/20">
                        <TableCell className="text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                            {g.method}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">{g.count}</TableCell>
                        <TableCell className="text-right text-sm font-bold">
                          {formatCurrency(g.total, currencySymbol)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {(cierreData.grandTotal ?? cierreData.totalCompleted) > 0
                            ? `${((g.total / (cierreData.grandTotal ?? cierreData.totalCompleted)) * 100).toFixed(1)}%`
                            : "0%"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Totals row */}
                <div className="p-4 border-t bg-muted/10 flex justify-between items-center">
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div className="flex items-center gap-3">
                      <span>Ventas directas:</span>
                      <span className="font-medium">{formatCurrency(cierreData.totalCompleted, currencySymbol)}</span>
                    </div>
                    {Boolean(registerSession?.totalDeposits && registerSession.totalDeposits > 0) && (
                      <div className="flex items-center gap-3">
                        <span>Adelantos de reservas:</span>
                        <span className="font-semibold text-emerald-700">+{formatCurrency(registerSession?.totalDeposits ?? 0, currencySymbol)}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Recaudado</p>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrency(cierreData.grandTotal ?? (cierreData.totalCompleted + (registerSession?.totalDeposits || 0)), currencySymbol)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Chart */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Distribución Visual</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px] px-2 pb-4">
                {cierreData.groups.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cierreData.groups} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="method"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${currencySymbol}${v}`}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10 }}
                        width={60}
                      />
                      <Tooltip
                        formatter={(val: number) => [formatCurrency(val, currencySymbol), "Total"]}
                        contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0" }}
                      />
                      <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                        {cierreData.groups.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Sin datos
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Transaction List ───────────────────────────────────── */}
          <Card className="border-0 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b px-4 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-semibold">
                    Detalle de Transacciones
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({filteredMovements.length} {transactionTab === "all" ? "totales" : transactionTab === "sales" ? "ventas" : "adelantos"})
                    </span>
                  </CardTitle>
                </div>
                <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border text-xs">
                  <button
                    type="button"
                    onClick={() => setTransactionTab("all")}
                    className={`px-2.5 py-1 rounded-lg transition-all font-medium ${transactionTab === "all" ? "bg-white shadow-2xs text-primary font-bold" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Todos ({combinedMovements.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransactionTab("sales")}
                    className={`px-2.5 py-1 rounded-lg transition-all font-medium ${transactionTab === "sales" ? "bg-white shadow-2xs text-primary font-bold" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Ventas ({cierreData.sales.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransactionTab("deposits")}
                    className={`px-2.5 py-1 rounded-lg transition-all font-medium ${transactionTab === "deposits" ? "bg-white shadow-2xs text-amber-700 font-bold" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Adelantos Reservas ({registerSession?.deposits?.length || 0})
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Documento</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Hora</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Cliente</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Usuario</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide">Método de Pago</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-right">Monto Recaudado</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-center">Estado</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMovements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">
                          No hay transacciones registradas para este filtro.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMovements.map((m) => {
                        const isSale = m.type === "sale";
                        const completed = isSale ? m.status === "completada" : true;
                        return (
                          <TableRow key={m.id} className={`hover:bg-muted/20 ${!completed ? "opacity-60" : ""}`}>
                            <TableCell className="font-mono text-sm font-medium">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={isSale ? "text-primary" : "text-amber-800 font-bold"}>
                                  {m.docNumber}
                                </span>
                                {isSale ? (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1 bg-blue-50/60 text-blue-700 border-blue-200">
                                    Venta
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1 bg-amber-50 text-amber-900 border-amber-200 font-medium">
                                    Adelanto Reserva
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {new Date(m.createdAt).toLocaleTimeString("es-BO", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </TableCell>
                            <TableCell className="text-sm">
                              {m.customerName || (
                                <span className="text-muted-foreground italic">Consumidor Final</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {m.userName}
                            </TableCell>
                            <TableCell className="text-sm">
                              {m.paymentMethod}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {isSale ? (
                                <span className={`font-bold ${completed ? "text-foreground" : "text-muted-foreground line-through"}`}>
                                  {formatCurrency(m.amount, currencySymbol)}
                                </span>
                              ) : (
                                <div>
                                  <span className="font-bold text-emerald-700">
                                    +{formatCurrency(m.amount, currencySymbol)}
                                  </span>
                                  {Boolean(m.secondaryAmount && m.secondaryAmount > m.amount) && (
                                    <p className="text-[10px] text-muted-foreground">
                                      Total: {formatCurrency(m.secondaryAmount ?? 0, currencySymbol)}
                                    </p>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {isSale ? (
                                <Badge
                                  variant={completed ? "outline" : "destructive"}
                                  className={`text-[10px] ${completed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}`}
                                >
                                  {completed ? "Completada" : "Anulada"}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-amber-300 bg-amber-50 text-amber-800 font-semibold"
                                >
                                  Adelanto Recibido
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <a href={m.link} title={isSale ? "Ver detalle de venta" : "Ver módulo de reservas"}>
                                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground hover:text-primary transition-colors" />
                              </a>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
