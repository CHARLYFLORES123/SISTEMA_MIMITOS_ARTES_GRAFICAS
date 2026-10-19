import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetCustomers, useGetProducts } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/lib/swal";
import { formatCurrency, useCurrency } from "@/contexts/currency-context";
import { CalendarDays, ClipboardCheck, LoaderCircle, Plus, RefreshCw, ShoppingBag, UserPlus, X } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";

type ReservationStage = "reserva" | "produccion" | "listo_entrega";
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
  reservationDate: string;
  expectedAt: string | null;
  notes: string | null;
  saleId: number | null;
  createdAt: string;
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
  const { data: customers } = useGetCustomers();
  const { data: products } = useGetProducts();
  const { data: reservations, isLoading, isError, refetch } = useQuery<Reservation[]>({
    queryKey: ["/api/reservations"],
    queryFn: () => request<Reservation[]>("/api/reservations"),
  });
  const [customerId, setCustomerId] = useState("none");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [depositMethod, setDepositMethod] = useState("");
  const [reservationDate, setReservationDate] = useState(localDate);
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [details, setDetails] = useState<DraftDetail[]>([emptyDetail()]);
  const [saving, setSaving] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [updatingDetailId, setUpdatingDetailId] = useState<number | null>(null);

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
    if (items.some((detail) => !detail.productId || detail.quantity < 1 || !detail.specifications || detail.unitPrice < 0)) {
      Toast.fire({ icon: "error", title: "Completa los productos y sus detalles" });
      return;
    }
    const depositAmount = Number(deposit);
    if (!Number.isFinite(depositAmount) || depositAmount < 0 || depositAmount > draftTotal) {
      Toast.fire({ icon: "error", title: "El adelanto debe estar entre 0 y el total de la reserva" });
      return;
    }

    setSaving(true);
    try {
      await request<Reservation>("/api/reservations", {
        method: "POST",
        body: JSON.stringify({
          customerId: customerId === "none" ? null : Number(customerId),
          deposit: depositAmount,
          depositMethod: depositMethod || null,
          reservationDate,
          expectedAt: expectedAt || null,
          notes: notes.trim() || null,
          details: items,
        }),
      });
      Toast.fire({ icon: "success", title: "Reserva registrada" });
      setCustomerId("none");
      setDeposit("0");
      setDepositMethod("");
      setReservationDate(localDate());
      setExpectedAt("");
      setNotes("");
      setDetails([emptyDetail()]);
      await queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
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
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Cliente</span>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cliente registrado</SelectItem>
                    {customers?.map((customer) => <SelectItem key={customer.id} value={String(customer.id)}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
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
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Adelanto</span>
                <Input type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(event.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Método del adelanto (opcional)</span>
                <Input value={depositMethod} onChange={(event) => setDepositMethod(event.target.value)} placeholder="Efectivo, transferencia..." />
              </label>
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
                    <Input type="number" min="1" step="1" value={detail.quantity} onChange={(event) => updateDraft(index, { quantity: event.target.value })} />
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
          <span className="text-sm text-muted-foreground">{availableReservations.length} pedidos</span>
        </div>
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
        ) : (
          <div className="space-y-3">
            {availableReservations.map((reservation) => (
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
                      <p>Adelanto: {formatCurrency(reservation.deposit, currencySymbol)}</p>
                      <p>Saldo: <strong>{formatCurrency(reservation.balance, currencySymbol)}</strong></p>
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
                  {reservation.status === "listo_entrega" && !isDesigner && (
                    <div className="flex justify-end">
                      <Button asChild>
                        <Link href={`/pos?reserva=${reservation.id}`}><ShoppingBag className="mr-2 h-4 w-4" /> Ir a Nueva Venta / entregar</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
