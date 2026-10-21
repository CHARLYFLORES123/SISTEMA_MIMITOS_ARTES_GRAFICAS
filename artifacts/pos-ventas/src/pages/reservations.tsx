import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetCustomers, useGetProducts, useGetPaymentMethods, useGetBusinessSettings } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/lib/swal";
import { formatCurrency, useCurrency } from "@/contexts/currency-context";
import { CalendarDays, Check, ChevronsUpDown, ClipboardCheck, Download, LoaderCircle, Plus, Printer, Receipt, RefreshCw, Search, ShoppingBag, User, UserPlus, X, Split, Trash2 } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { downloadReservationTicket, printReservationTicket, ReservationForTicket } from "@/lib/generate-reservation-ticket";

type ReservationStage = "reserva" | "produccion" | "listo_entrega";
type ReservationPaymentItem = {
  paymentMethod: string;
  amount: number;
};
type ReservationDetail = {
  id: number;
  productId: number | null;
  productName: string;
  specifications: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  status: ReservationStage | "entregada";
};
type Reservation = {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  userName: string | null;
  status: ReservationStage | "entregada";
  total: number;
  deposit: number;
  balance: number;
  depositMethod: string | null;
  cashRegisterSessionId: number | null;
  reservationDate: string;
  expectedAt: string | null;
  notes: string | null;
  saleId: number | null;
  createdAt: string;
  payments?: ReservationPaymentItem[];
  details: ReservationDetail[];
};
type DraftDetail = {
  productId: string;
  quantity: string;
  unitPrice: string;
  specifications: string;
};

const STAGES: { value: ReservationStage; label: string; className: string }[] = [
  { value: "reserva", label: "Reserva", className: "border-slate-300 bg-slate-100 text-slate-800" },
  { value: "produccion", label: "En producción", className: "border-blue-300 bg-blue-50 text-blue-800" },
  { value: "listo_entrega", label: "Listo para entrega", className: "border-emerald-300 bg-emerald-50 text-emerald-800" },
];

const emptyDetail = (): DraftDetail => ({ productId: "", quantity: "1", unitPrice: "", specifications: "" });
const localDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return customFetch(path, init) as Promise<T>;
}

export default function Reservations() {
  const { role } = usePermissions();
  const isDesigner = role === "diseñador";
  const queryClient = useQueryClient();
  const { currencySymbol } = useCurrency();
  const { data: settings } = useGetBusinessSettings();
  const { data: customers } = useGetCustomers();
  const { data: products } = useGetProducts();
  const { data: rawPaymentMethods } = useGetPaymentMethods();
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const businessSettingsForTicket = useMemo(() => ({
    companyName: settings?.companyName || "MIMITOS ARTES GRÁFICAS",
    rucNit: settings?.rucNit || null,
    phone: settings?.phone || null,
    email: settings?.email || null,
    address: settings?.address || null,
    currency: settings?.currency || "BOB",
    currencySymbol: settings?.currencySymbol || currencySymbol || "Bs",
  }), [settings, currencySymbol]);

  const getReservationTicketData = (resv: Reservation): ReservationForTicket => {
    const cust = customers?.find((c) => c.id === resv.customerId);
    return {
      id: resv.id,
      customerName: resv.customerName,
      customerNitCi: cust?.nitCi || null,
      customerPhone: resv.customerPhone,
      userName: resv.userName,
      status: resv.status,
      total: Number(resv.total),
      deposit: Number(resv.deposit),
      balance: Number(resv.balance),
      depositMethod: resv.depositMethod,
      reservationDate: resv.reservationDate,
      expectedAt: resv.expectedAt,
      notes: resv.notes,
      createdAt: resv.createdAt,
      payments: resv.payments,
      details: resv.details.map((d) => ({
        id: d.id,
        productName: d.productName,
        specifications: d.specifications,
        quantity: Number(d.quantity),
        unitPrice: Number(d.unitPrice),
        subtotal: Number(d.subtotal),
        status: d.status,
      })),
    };
  };

  const handlePrintTicket = (resv: Reservation) => {
    try {
      const data = getReservationTicketData(resv);
      printReservationTicket(data, businessSettingsForTicket);
    } catch (err) {
      Toast.fire({ icon: "error", title: "No se pudo abrir la impresión", text: err instanceof Error ? err.message : "" });
    }
  };

  const handleDownloadTicket = async (resv: Reservation) => {
    setActionLoadingId(resv.id);
    try {
      const data = getReservationTicketData(resv);
      downloadReservationTicket(data, businessSettingsForTicket);
      Toast.fire({ icon: "success", title: `Ticket #${String(resv.id).padStart(6, "0")} descargado` });
    } catch (err) {
      Toast.fire({ icon: "error", title: "No se pudo descargar el ticket", text: err instanceof Error ? err.message : "" });
    } finally {
      setActionLoadingId(null);
    }
  };
  const availablePaymentMethods = useMemo(() => {
    const list = (rawPaymentMethods || [])
      .filter((m) => m.isActive)
      .map((m) => m.name);
    if (list.length === 0) return ["Efectivo", "Transferencia", "QR", "Tarjeta"];
    return list;
  }, [rawPaymentMethods]);

  const { data: reservations, isLoading, isError, refetch } = useQuery<Reservation[]>({
    queryKey: ["/api/reservations"],
    queryFn: () => request<Reservation[]>("/api/reservations"),
  });
  const { data: activeCashRegister } = useQuery<{ id: number; status: string } | null>({
    queryKey: ["/api/cash-register", localDate()],
    queryFn: () => request<{ id: number; status: string } | null>(`/api/cash-register?date=${localDate()}`),
  });
  const [customerId, setCustomerId] = useState("none");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const selectedCustomer = useMemo(() => {
    if (customerId === "none") return null;
    return customers?.find((c) => String(c.id) === customerId);
  }, [customerId, customers]);

  const filteredCustomerList = useMemo(() => {
    if (!customerSearch.trim()) return customers || [];
    const q = customerSearch.toLowerCase().trim();
    return (customers || []).filter((c) =>
      c.name?.toLowerCase().includes(q) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      (c.nitCi && c.nitCi.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [depositMethod, setDepositMethod] = useState("Efectivo");
  const [isMixedDeposit, setIsMixedDeposit] = useState(false);
  const [mixedPayments, setMixedPayments] = useState<Array<{ method: string; amount: string }>>([
    { method: "Efectivo", amount: "" },
    { method: "Transferencia", amount: "" },
  ]);
  const [reservationDate, setReservationDate] = useState(localDate);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [details, setDetails] = useState<DraftDetail[]>([emptyDetail()]);
  const [saving, setSaving] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [updatingDetailId, setUpdatingDetailId] = useState<number | null>(null);
  const [filterName, setFilterName] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterExpectedDate, setFilterExpectedDate] = useState("");

  const mixedTotal = useMemo(() => {
    return mixedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [mixedPayments]);

  const effectiveDeposit = isMixedDeposit ? mixedTotal : (Number(deposit) || 0);

  const draftTotal = useMemo(() => details.reduce((sum, detail) => {
    const quantity = Number(detail.quantity) || 0;
    const unitPrice = Number(detail.unitPrice) || 0;
    return sum + quantity * unitPrice;
  }, 0), [details]);

  const updateDraft = (index: number, changes: Partial<DraftDetail>) => {
    setDetails((current) => current.map((detail, detailIndex) =>
      detailIndex === index ? { ...detail, ...changes } : detail));
  };

  const addCustomer = async () => {
    const name = newCustomerName.trim();
    const phone = newCustomerPhone.trim();
    if (!name || !phone) {
      Toast.fire({ icon: "warning", title: "Ingresa el nombre y el teléfono del cliente" });
      return;
    }
    if (phone.length > 30) {
      Toast.fire({ icon: "warning", title: "El teléfono no debe superar los 30 caracteres" });
      return;
    }

    setSavingCustomer(true);
    try {
      const customer = await request<{ id: number }>("/api/customers", {
        method: "POST",
        body: JSON.stringify({ name, phone }),
      });
      setCustomerId(String(customer.id));
      setNewCustomerName("");
      setNewCustomerPhone("");
      setShowNewCustomer(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      Toast.fire({ icon: "success", title: "Cliente registrado y seleccionado" });
    } catch (error) {
      Toast.fire({ icon: "error", title: "No se pudo registrar el cliente", text: error instanceof Error ? error.message : "Error inesperado" });
    } finally {
      setSavingCustomer(false);
    }
  };

  const createReservation = async (event: React.FormEvent) => {
    event.preventDefault();
    const items = details.map((detail) => ({
      productId: Number(detail.productId),
      quantity: Number(detail.quantity),
      unitPrice: Number(detail.unitPrice),
      specifications: detail.specifications.trim(),
    }));
    if (items.some((detail) => !detail.productId || !Number.isFinite(detail.quantity) || detail.quantity <= 0 || !detail.specifications || !Number.isFinite(detail.unitPrice) || detail.unitPrice < 0)) {
      Toast.fire({ icon: "error", title: "Completa los productos y sus detalles (la cantidad debe ser mayor a 0)" });
      return;
    }
    const depositAmount = effectiveDeposit;
    if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > draftTotal) {
      Toast.fire({ icon: "error", title: "El adelanto debe estar entre 0 y el total de la reserva" });
      return;
    }

    let finalDepositMethod: string | null = null;
    let finalPayments: Array<{ paymentMethod: string; amount: number }> | undefined = undefined;

    if (depositAmount > 0) {
      if (isMixedDeposit) {
        const activeMixed = mixedPayments
          .filter((p) => (Number(p.amount) || 0) > 0)
          .map((p) => ({ paymentMethod: p.method, amount: Number(Number(p.amount).toFixed(2)) }));
        if (activeMixed.length === 0) {
          Toast.fire({ icon: "warning", title: "Ingresa los montos para el pago mixto del adelanto" });
          return;
        }
        const activeSum = Number(activeMixed.reduce((s, p) => s + p.amount, 0).toFixed(2));
        if (Math.abs(activeSum - depositAmount) > 0.05) {
          Toast.fire({ icon: "warning", title: "La suma de los montos no coincide con el total del adelanto" });
          return;
        }
        finalPayments = activeMixed;
        finalDepositMethod = activeMixed.map((p) => `${p.paymentMethod}: ${p.amount.toFixed(2)}`).join(" / ");
      } else {
        finalDepositMethod = depositMethod || "Efectivo";
        finalPayments = [{ paymentMethod: finalDepositMethod, amount: depositAmount }];
      }
    }

    setSaving(true);
    try {
      await request<Reservation>("/api/reservations", {
        method: "POST",
        body: JSON.stringify({
          customerId: customerId === "none" ? null : Number(customerId),
          deposit: depositAmount,
          depositMethod: finalDepositMethod,
          payments: finalPayments,
          cashRegisterSessionId: activeCashRegister?.status === "open" ? activeCashRegister.id : undefined,
          reservationDate,
          expectedAt: expectedAt || null,
          notes: notes.trim() || null,
          details: items,
        }),
      });
      Toast.fire({ icon: "success", title: "Reserva registrada con éxito" });
      setCustomerId("none");
      setCustomerSearch("");
      setCustomerOpen(false);
      setDeposit("0");
      setDepositMethod("Efectivo");
      setIsMixedDeposit(false);
      setMixedPayments([
        { method: "Efectivo", amount: "" },
        { method: "Transferencia", amount: "" },
      ]);
      setReservationDate(localDate());
      setExpectedAt("");
      setNotes("");
      setDetails([emptyDetail()]);
      await queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cash-register"] });
    } catch (error) {
      Toast.fire({ icon: "error", title: "No se pudo guardar la reserva", text: error instanceof Error ? error.message : "Error inesperado" });
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (reservationId: number, detailId: number, status: ReservationStage) => {
    setUpdatingDetailId(detailId);
    try {
      await request<Reservation>(`/api/reservations/${reservationId}/details/${detailId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      Toast.fire({ icon: "success", title: "Etapa de producción actualizada" });
    } catch (error) {
      Toast.fire({ icon: "error", title: "No se pudo actualizar la etapa", text: error instanceof Error ? error.message : "Error inesperado" });
    } finally {
      setUpdatingDetailId(null);
    }
  };

  const availableReservations = (reservations ?? []).filter((reservation) => reservation.status !== "entregada");

  const filteredReservations = useMemo(() => {
    const name = filterName.trim().toLowerCase();
    const phone = filterPhone.trim().toLowerCase();
    return availableReservations.filter((reservation) => {
      if (name && !(reservation.customerName || "").toLowerCase().includes(name)) return false;
      if (phone && !(reservation.customerPhone || "").toLowerCase().includes(phone)) return false;
      if (filterDate && reservation.reservationDate !== filterDate) return false;
      if (filterExpectedDate) {
        if (!reservation.expectedAt) return false;
        const expectedDateStr = reservation.expectedAt.slice(0, 10);
        if (expectedDateStr !== filterExpectedDate) return false;
      }
      return true;
    });
  }, [availableReservations, filterName, filterPhone, filterDate, filterExpectedDate]);

  const hasFilters = Boolean(filterName.trim() || filterPhone.trim() || filterDate || filterExpectedDate);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isDesigner ? "Pedidos activos" : "Reservas y producción"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isDesigner
              ? "Seguimiento y cambio de estado de pedidos para producción y entrega."
              : "Registra pedidos personalizados y sigue cada producto hasta su entrega."}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {!isDesigner && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg"><Plus className="h-5 w-5 text-primary" /> Registrar reserva</CardTitle>
          </CardHeader>
        <CardContent>
          <form onSubmit={createReservation} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5 text-sm">
                <span className="font-medium">Cliente</span>
                <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={customerOpen}
                      className="w-full justify-between font-normal h-9 px-3 text-left"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <User className="h-4 w-4 text-muted-foreground shrink-0" />
                        {selectedCustomer ? (
                          <span className="truncate">
                            <span className="font-medium text-foreground">{selectedCustomer.name}</span>
                            {selectedCustomer.phone && <span className="text-muted-foreground text-xs ml-1.5">· {selectedCustomer.phone}</span>}
                          </span>
                        ) : customerId === "none" ? (
                          <span className="text-muted-foreground">Sin cliente registrado</span>
                        ) : (
                          <span className="text-muted-foreground">Seleccionar cliente</span>
                        )}
                      </div>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-2" align="start">
                    <div className="relative mb-2">
                      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Buscar por nombre o teléfono..."
                        className="pl-8 pr-7 h-8 text-xs"
                        autoFocus
                      />
                      {customerSearch && (
                        <button
                          type="button"
                          onClick={() => setCustomerSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerId("none");
                          setCustomerOpen(false);
                          setCustomerSearch("");
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between hover:bg-accent transition-colors ${
                          customerId === "none" ? "bg-accent font-semibold" : ""
                        }`}
                      >
                        <span className="text-muted-foreground">Sin cliente registrado</span>
                        {customerId === "none" && <Check className="w-3.5 h-3.5 text-primary" />}
                      </button>

                      {filteredCustomerList.length === 0 ? (
                        <div className="p-3 text-center text-xs text-muted-foreground">
                          No se encontraron clientes coincidentes
                        </div>
                      ) : (
                        filteredCustomerList.map((customer) => {
                          const isSelected = String(customer.id) === customerId;
                          return (
                            <button
                              key={customer.id}
                              type="button"
                              onClick={() => {
                                setCustomerId(String(customer.id));
                                setCustomerOpen(false);
                                setCustomerSearch("");
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between hover:bg-accent transition-colors ${
                                isSelected ? "bg-accent font-semibold" : ""
                              }`}
                            >
                              <div className="min-w-0 pr-2">
                                <p className="truncate font-medium text-foreground">{customer.name}</p>
                                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                  {customer.phone && <span>📞 {customer.phone}</span>}
                                  {customer.nitCi && <span>· CI/NIT: {customer.nitCi}</span>}
                                </div>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5 text-sm">
                <span className="font-medium">Nuevo cliente</span>
                <Button type="button" variant="outline" className="w-full" onClick={() => setShowNewCustomer((current) => !current)}>
                  {showNewCustomer ? <X className="mr-2 h-4 w-4" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  {showNewCustomer ? "Cancelar" : "Agregar cliente"}
                </Button>
              </div>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Fecha de reserva</span>
                <Input type="date" required value={reservationDate} onChange={(event) => setReservationDate(event.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Fecha estimada de entrega</span>
                <Input type="date" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} />
              </label>
            </div>

            {/* SECCIÓN ADELANTO (PAGO SIMPLE O MIXTO) */}
            <div className="rounded-xl border bg-muted/15 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Adelanto / Anticipo</span>
                  {effectiveDeposit > 0 && (
                    <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs font-bold">
                      Total: {formatCurrency(effectiveDeposit, currencySymbol)}
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant={isMixedDeposit ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs gap-1.5 rounded-lg"
                  onClick={() => {
                    const next = !isMixedDeposit;
                    setIsMixedDeposit(next);
                    if (next) {
                      // initialize mixed amounts
                      const cur = Number(deposit) || 0;
                      if (cur > 0) {
                        setMixedPayments([
                          { method: "Efectivo", amount: (cur / 2).toFixed(2) },
                          { method: "Transferencia", amount: (cur / 2).toFixed(2) },
                        ]);
                      }
                    } else {
                      // sync back
                      setDeposit(String(mixedTotal > 0 ? mixedTotal : "0"));
                    }
                  }}
                >
                  <Split className="h-3.5 w-3.5" />
                  {isMixedDeposit ? "Cambiar a Pago Simple" : "Dividir Pago del Adelanto (Mixto)"}
                </Button>
              </div>

              {!isMixedDeposit ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Monto de adelanto</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={deposit}
                      onChange={(event) => setDeposit(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Método de pago</span>
                    <Select value={depositMethod} onValueChange={setDepositMethod}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccionar método" />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePaymentMethods.map((method) => (
                          <SelectItem key={method} value={method}>
                            {method}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ) : (
                <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                  <p className="text-xs text-amber-900 font-medium">
                    Pago Mixto del Adelanto: Registra los montos recibidos en cada método (por ejemplo, parte en efectivo y parte en transferencia).
                  </p>
                  <div className="space-y-2">
                    {mixedPayments.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-[1.5fr_1fr_auto] gap-2 items-center">
                        <Select
                          value={p.method}
                          onValueChange={(val) => {
                            setMixedPayments((curr) => curr.map((item, i) => i === idx ? { ...item, method: val } : item));
                          }}
                        >
                          <SelectTrigger className="h-9 text-xs bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availablePaymentMethods.map((method) => (
                              <SelectItem key={method} value={method}>
                                {method}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Monto"
                          className="h-9 text-xs bg-white"
                          value={p.amount}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMixedPayments((curr) => curr.map((item, i) => i === idx ? { ...item, amount: val } : item));
                          }}
                        />
                        {mixedPayments.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setMixedPayments((curr) => curr.filter((_, i) => i !== idx));
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/60">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs bg-white"
                      onClick={() => {
                        const unusedMethod = availablePaymentMethods.find(
                          (m) => !mixedPayments.some((p) => p.method === m)
                        ) || availablePaymentMethods[0] || "Transferencia";
                        setMixedPayments((curr) => [...curr, { method: unusedMethod, amount: "" }]);
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Agregar otro método
                    </Button>
                    <div className="text-xs font-semibold text-amber-950">
                      Total Adelanto Mixto:{" "}
                      <span className="text-primary font-bold text-sm">
                        {formatCurrency(mixedTotal, currencySymbol)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {showNewCustomer && (
              <div className="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Nombre del cliente</span>
                  <Input required maxLength={300} value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Nombre completo" />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Número de teléfono</span>
                  <Input required type="tel" maxLength={30} value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} placeholder="Ej. 70000000" />
                </label>
                <Button type="button" onClick={() => void addCustomer()} disabled={savingCustomer}>
                  {savingCustomer ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  Guardar cliente
                </Button>
              </div>
            )}

            <div className="space-y-3">
              {details.map((detail, index) => (
                <div key={index} className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_0.7fr_1fr_auto]">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Producto del catálogo</span>
                    <Select value={detail.productId} onValueChange={(value) => {
                      const product = products?.find((item) => String(item.id) === value);
                      updateDraft(index, { productId: value, unitPrice: product ? String(product.salePrice) : "" });
                    }}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar producto" /></SelectTrigger>
                      <SelectContent>
                        {products?.map((product) => (
                          <SelectItem key={product.id} value={String(product.id)}>
                            {product.name}{product.size ? ` · ${product.size}` : ""}{product.color ? ` · ${product.color}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Detalles del diseño / producto</span>
                    <Input value={detail.specifications} onChange={(event) => updateDraft(index, { specifications: event.target.value })} placeholder="Color, nombre, talla, imagen..." />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Cantidad</span>
                    <Input type="number" min="0.01" step="any" value={detail.quantity} onChange={(event) => updateDraft(index, { quantity: event.target.value })} placeholder="1" />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Precio unitario</span>
                    <Input type="number" min="0" step="0.01" value={detail.unitPrice} onChange={(event) => updateDraft(index, { unitPrice: event.target.value })} />
                  </label>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" onClick={() => setDetails((current) => current.filter((_, detailIndex) => detailIndex !== index))} disabled={details.length === 1}>
                      Quitar
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setDetails((current) => [...current, emptyDetail()])}>
                <Plus className="mr-1.5 h-4 w-4" /> Agregar producto
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Notas de la reserva</span>
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Indicaciones adicionales..." />
              </label>
              <div className="rounded-lg bg-muted/40 px-4 py-2 text-sm">
                <p>Total: <strong>{formatCurrency(draftTotal, currencySymbol)}</strong></p>
                <p>Saldo pendiente: <strong>{formatCurrency(Math.max(0, draftTotal - (Number(deposit) || 0)), currencySymbol)}</strong></p>
              </div>
              <Button type="submit" disabled={saving || !products?.length}>
                {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Guardar reserva
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isDesigner ? "Listado de pedidos" : "Pedidos activos"}</h2>
          <span className="text-sm text-muted-foreground">
            {hasFilters ? `${filteredReservations.length} de ${availableReservations.length} pedidos` : `${availableReservations.length} pedidos`}
          </span>
        </div>
        <Card>
          <CardContent className="p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Nombre del cliente</span>
                <Input value={filterName} onChange={(event) => setFilterName(event.target.value)} placeholder="Buscar por nombre..." />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Nro. de teléfono</span>
                <Input type="tel" value={filterPhone} onChange={(event) => setFilterPhone(event.target.value)} placeholder="Buscar por teléfono..." />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Fecha de reserva</span>
                <Input type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Fecha estimada de entrega</span>
                <Input type="date" value={filterExpectedDate} onChange={(event) => setFilterExpectedDate(event.target.value)} />
              </label>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => { setFilterName(""); setFilterPhone(""); setFilterDate(""); setFilterExpectedDate(""); }}
                  disabled={!hasFilters}
                >
                  <X className="mr-2 h-4 w-4" /> Limpiar filtros
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {isLoading ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Cargando reservas...</CardContent></Card>
        ) : isError ? (
          <Card><CardContent className="py-8 text-center text-sm text-destructive">No se pudieron cargar las reservas. Actualiza para volver a intentar.</CardContent></Card>
        ) : availableReservations.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center py-10 text-center text-muted-foreground">
            <ClipboardCheck className="mb-2 h-9 w-9 opacity-30" />
            <p className="font-medium">No hay reservas activas</p>
            <p className="text-sm">Las reservas nuevas aparecerán aquí.</p>
          </CardContent></Card>
        ) : filteredReservations.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center py-10 text-center text-muted-foreground">
            <ClipboardCheck className="mb-2 h-9 w-9 opacity-30" />
            <p className="font-medium">No se encontraron pedidos con esos filtros</p>
            <p className="text-sm">Prueba con otro nombre, teléfono o fecha, o limpia los filtros.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {filteredReservations.map((reservation) => (
              <Card key={reservation.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">Reserva #{reservation.id}</h3>
                        <Badge variant="outline" className={STAGES.find((stage) => stage.value === reservation.status)?.className}>
                          {STAGES.find((stage) => stage.value === reservation.status)?.label ?? reservation.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {reservation.customerName || "Sin cliente"}{reservation.customerPhone ? ` · ${reservation.customerPhone}` : ""} · Registró: {reservation.userName || "—"}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Fecha de reserva: {reservation.reservationDate}</p>
                      {reservation.expectedAt && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Entrega estimada: {reservation.expectedAt}</p>}
                    </div>
                    <div className="text-right text-sm">
                      <p>Total: <strong>{formatCurrency(reservation.total, currencySymbol)}</strong></p>
                      <p>Adelanto: <strong>{formatCurrency(reservation.deposit, currencySymbol)}</strong></p>
                      {reservation.deposit > 0 && (
                        <div className="mt-1 flex flex-col items-end gap-1">
                          {reservation.payments && reservation.payments.length > 1 ? (
                            <div className="flex flex-wrap justify-end gap-1 max-w-[280px]">
                              {reservation.payments.map((p, idx) => (
                                <Badge key={idx} variant="secondary" className="text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-200 py-0.5">
                                  {p.paymentMethod}: {formatCurrency(p.amount, currencySymbol)}
                                </Badge>
                              ))}
                            </div>
                          ) : reservation.payments && reservation.payments.length === 1 ? (
                            <span className="text-[11px] text-muted-foreground">
                              Método: <strong>{reservation.payments[0].paymentMethod}</strong>
                            </span>
                          ) : reservation.depositMethod ? (
                            <span className="text-[11px] text-muted-foreground">
                              Método: <strong>{reservation.depositMethod}</strong>
                            </span>
                          ) : null}
                        </div>
                      )}
                      <p className="mt-1.5">Saldo: <strong>{formatCurrency(reservation.balance, currencySymbol)}</strong></p>
                    </div>
                  </div>

                  <div className="divide-y rounded-lg border">
                    {reservation.details.map((detail) => (
                      <div key={detail.id} className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center">
                        <div>
                          <p className="flex items-center gap-2 font-medium"><ShoppingBag className="h-4 w-4 text-primary" />{detail.quantity} × {detail.productName}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{detail.specifications}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Importe: {formatCurrency(detail.subtotal, currencySymbol)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {detail.status !== "entregada" ? (
                            <Select
                              value={detail.status}
                              onValueChange={(value) => void changeStage(reservation.id, detail.id, value as ReservationStage)}
                              disabled={updatingDetailId === detail.id}
                            >
                              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(isDesigner
                                  ? STAGES.filter((stage) => stage.value === "produccion" || stage.value === "listo_entrega" || stage.value === detail.status)
                                  : STAGES
                                ).map((stage) => (
                                  <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : <Badge>Entregado</Badge>}
                          {updatingDetailId === detail.id && <LoaderCircle className="h-4 w-4 animate-spin" />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {reservation.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">Notas: {reservation.notes}</p>}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 border-slate-300 text-slate-800 hover:bg-slate-100"
                        onClick={() => handlePrintTicket(reservation)}
                        title="Imprimir ticket térmico (80mm)"
                      >
                        <Printer className="h-3.5 w-3.5 text-primary" />
                        Imprimir ticket
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-100"
                        onClick={() => void handleDownloadTicket(reservation)}
                        disabled={actionLoadingId === reservation.id}
                        title="Descargar ticket en PDF (80mm)"
                      >
                        {actionLoadingId === reservation.id ? (
                          <div className="h-3.5 w-3.5 border-2 border-slate-400 border-t-primary rounded-full animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        Descargar ticket
                      </Button>
                    </div>

                    {reservation.status === "listo_entrega" && !isDesigner && (
                      <Button asChild size="sm" className="h-8">
                        <Link href={`/pos?reserva=${reservation.id}`}><ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Ir a Nueva Venta / entregar</Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
