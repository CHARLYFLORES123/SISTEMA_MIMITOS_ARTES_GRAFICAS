import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { customFetch, useGetProducts, useGetCustomers, useCreateSale, useGetCategories, useGetPaymentMethods, useGetBusinessSettings, useCreateCustomer } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Search, Plus, Minus, Trash2, ShoppingCart, Package, User, UserPlus, CreditCard, CheckCircle2, ScanLine, PauseCircle, PlayCircle, Clock, Percent, Tag, Banknote, Star, Gift, Zap, Ticket, X, ArrowRight, CalendarDays } from "lucide-react";
import { TierBadge } from "@/pages/loyalty";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrency, formatCurrency } from "@/contexts/currency-context";
import { BoletaModal } from "@/components/boleta-modal";
import { emailBoleta } from "@/lib/generate-boleta";
import { Toast, Swal } from "@/lib/swal";
import { getToken } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";

const API_URL = (import.meta.env.VITE_API_URL || `${window.location.origin}/api`).replace(/\/$/, "");
async function apiFetch(path: string, opts: RequestInit = {}) {
  const normalizedPath = path.startsWith("/api/") ? path.slice(4) : path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${API_URL}${normalizedPath}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(opts.headers ?? {}) },
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as any).message ?? "Error"); }
  return res.json();
}

function localBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isCash(m?: string | null) {
  const lower = (m || "").toLowerCase();
  return lower === "efectivo" || lower.includes("efectivo");
}

function productLabel(product: { name: string; size?: string | null; color?: string | null }) {
  return [product.name, product.size && `Talla ${product.size}`, product.color && `Color ${product.color}`]
    .filter(Boolean)
    .join(" · ");
}

function ProductThumbnail({ src, alt, className = "w-full h-full object-cover" }: { src?: string | null; alt: string; className?: string }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return <Package className="w-8 h-8 text-muted-foreground/30" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}

interface CartItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  stock: number;
  imageUrl?: string | null;
  specifications?: string;
}

interface SuspendedSale {
  id: string;
  label: string;
  cart: CartItem[];
  customerId: string;
  customerSearch: string;
  paymentMethod: string;
  notes: string;
  suspendedAt: Date;
}

interface CompletedSaleForModal {
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
  details: { id: number; productName: string; quantity: number; unitPrice: number; subtotal: number }[];
  pointsEarned?: number | null;
}

interface PosReservation {
  id: number;
  customerId: number | null;
  customerName: string | null;
  customerPhone?: string | null;
  status: string;
  total: number;
  deposit: number;
  balance: number;
  notes: string | null;
  details: { id: number; productName: string; specifications: string; quantity: number; unitPrice: number; subtotal: number; status: string }[];
}

export default function POS() {
  const [, setLocation] = useLocation();
  const { user } = usePermissions();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartMode, setCartMode] = useState<"sale" | "reserva">("sale");
  const [reservationDate, setReservationDate] = useState<string>(localBusinessDate);
  const [expectedAt, setExpectedAt] = useState<string>("");
  const [deposit, setDeposit] = useState<string>("0");
  const [depositMethod, setDepositMethod] = useState<string>("Efectivo");
  const [isMixedDeposit, setIsMixedDeposit] = useState(false);
  const [mixedDepositCash, setMixedDepositCash] = useState<string>("");
  const [mixedDepositTransfer, setMixedDepositTransfer] = useState<string>("");
  const [isSavingReservation, setIsSavingReservation] = useState<boolean>(false);
  const [customerId, setCustomerId] = useState<string>("none");
  const [customerSearch, setCustomerSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("Efectivo");
  const [isCombinedPayment, setIsCombinedPayment] = useState(false);
  const [combinedPayments, setCombinedPayments] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [completedSale, setCompletedSale] = useState<CompletedSaleForModal | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [cashReceived, setCashReceived] = useState<string>("");
  const [reservationCashReceived, setReservationCashReceived] = useState("");
  const [reservationDiscount, setReservationDiscount] = useState<number>(0);
  const [generalDiscount, setGeneralDiscount] = useState<{ type: "pct" | "fixed"; value: number } | null>(null);
  const [showReadyReservationsModal, setShowReadyReservationsModal] = useState(false);
  const [reservationSearchQuery, setReservationSearchQuery] = useState("");
  const [pendingQty, setPendingQty] = useState(1);
  const [suspendedSales, setSuspendedSales] = useState<SuspendedSale[]>([]);
  const [showSuspended, setShowSuspended] = useState(false);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [redeemingPoints, setRedeemingPoints] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [validatedCoupon, setValidatedCoupon] = useState<{
    id: number; code: string; customerId: number; customerName: string;
    discountPercent: number; tier: string; expiresAt: string;
  } | null>(null);
  const [couponValidating, setCouponValidating] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { currencySymbol } = useCurrency();

  const [activeReservationId, setActiveReservationId] = useState<number | null>(() => {
    const param = Number(new URLSearchParams(window.location.search).get("reserva"));
    return Number.isSafeInteger(param) && param > 0 ? param : null;
  });

  const { data: readyReservations, refetch: refetchReadyReservations } = useQuery<PosReservation[]>({
    queryKey: ["/api/reservations", "ready"],
    queryFn: () => apiFetch("/api/reservations?status=listo_entrega"),
    refetchInterval: 15000,
  });

  const { data: linkedReservation, isLoading: reservationLoading, error: reservationError } = useQuery<PosReservation>({
    queryKey: ["/api/reservations", activeReservationId],
    queryFn: () => apiFetch(`/api/reservations/${activeReservationId}`),
    enabled: Number.isSafeInteger(activeReservationId) && (activeReservationId ?? 0) > 0,
  });

  useEffect(() => {
    if (linkedReservation?.customerId) {
      setCustomerId(String(linkedReservation.customerId));
    }
    setReservationDiscount(0);
    setReservationCashReceived("");
  }, [linkedReservation]);

  const { data: products, isLoading: productsLoading } = useGetProducts({
    search: search || undefined,
    categoryId: categoryId ?? undefined,
  });
  const { data: customers } = useGetCustomers();
  const { data: categories } = useGetCategories();
  const { data: paymentMethods } = useGetPaymentMethods();
  const businessDate = localBusinessDate();
  const { data: cashRegister, isLoading: cashRegisterLoading } = useQuery<{
    id: number;
    status: "open" | "closed";
    businessDate: string;
  } | null>({
    queryKey: ["/api/cash-register", businessDate],
    queryFn: () => customFetch(`/api/cash-register?date=${businessDate}`),
    refetchInterval: 15000,
  });
  const { data: settings } = useGetBusinessSettings();
  const createSale = useCreateSale();
  const createCustomer = useCreateCustomer();

  const [registerCustomerOpen, setRegisterCustomerOpen] = useState(false);
  const [newClientCiNit, setNewClientCiNit] = useState("");
  const [newClientApellidos, setNewClientApellidos] = useState("");
  const [newClientNombres, setNewClientNombres] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [isRegisteringCustomer, setIsRegisteringCustomer] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const openRegisterCustomerModal = (initialSearch = "") => {
    const term = (initialSearch || customerSearch).trim();
    const isOnlyDigits = /^\d+$/.test(term);
    if (isOnlyDigits) {
      if (term.length >= 7 && (term.startsWith("6") || term.startsWith("7") || term.startsWith("4") || term.startsWith("2") || term.startsWith("3"))) {
        setNewClientPhone(term);
        setNewClientCiNit("");
      } else {
        setNewClientCiNit(term);
        setNewClientPhone("");
      }
      setNewClientNombres("");
    } else {
      setNewClientNombres(term);
      setNewClientCiNit("");
      setNewClientPhone("");
    }
    setNewClientApellidos("");
    setShowCustomerDropdown(false);
    setRegisterCustomerOpen(true);
  };

  const handleRegisterCustomer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const apellidos = newClientApellidos.trim();
    const nombres = newClientNombres.trim();
    const fullName = [nombres, apellidos].filter(Boolean).join(" ");

    if (!fullName) {
      Toast.fire({ icon: "error", title: "Datos incompletos", text: "Ingresa el nombre o apellido del cliente" });
      return;
    }

    setIsRegisteringCustomer(true);
    createCustomer.mutate({
      data: {
        name: fullName,
        nitCi: newClientCiNit.trim() || null,
        phone: newClientPhone.trim() || null,
      }
    }, {
      onSuccess: (newCust) => {
        setIsRegisteringCustomer(false);
        setRegisterCustomerOpen(false);
        queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
        setCustomerId(String(newCust.id));
        setCustomerSearch("");
        Toast.fire({
          icon: "success",
          title: "Cliente registrado",
          text: `${newCust.name} ha sido registrado y seleccionado para esta venta.`
        });
      },
      onError: (err: any) => {
        setIsRegisteringCustomer(false);
        Toast.fire({
          icon: "error",
          title: "Error al registrar",
          text: err?.message || "No se pudo registrar al cliente"
        });
      }
    });
  };

  // Loyalty balance for selected customer
  const customerIdNum = customerId !== "none" ? parseInt(customerId) : null;
  const { data: loyaltyBalance, refetch: refetchBalance, isLoading: loyaltyLoading } = useQuery<{
    points: number; discountValue: number; redemptionRate: number; pointsPerUnit: number; loyaltyEnabled: boolean;
    tier: string; tierLabel: string; tierMultiplier: number; tierColor: string;
    nextTier: { name: string; label: string; min: number } | null;
    progressToNext: number; pointsToNext: number;
  }>({
    queryKey: ["/api/loyalty/balance", customerIdNum],
    queryFn: () => apiFetch(`/api/loyalty/balance/${customerIdNum}`),
    enabled: customerIdNum !== null,
  });

  // Reset points and coupon when customer changes
  useEffect(() => {
    setPointsToRedeem(0);
    setValidatedCoupon(null);
    setCouponInput("");
  }, [customerId]);

  const activePaymentMethods = useMemo(() => {
    if (!paymentMethods || paymentMethods.length === 0) return ["Efectivo", "Tarjeta", "Transferencia"];
    return paymentMethods.filter(m => m.isActive).map(m => m.name);
  }, [paymentMethods]);

  useEffect(() => {
    if (activePaymentMethods.length > 0 && !activePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(activePaymentMethods[0]);
    }
  }, [activePaymentMethods, paymentMethod]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers || [];
    const q = customerSearch.toLowerCase().trim();
    return (customers || []).filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.nitCi && c.nitCi.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q)) ||
      ((c as any).email && (c as any).email.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(() => {
    if (customerId === "none") return null;
    return customers?.find(c => c.id === parseInt(customerId));
  }, [customerId, customers]);

  const customerReadyReservations = useMemo(() => {
    if (!selectedCustomer || !readyReservations) return [];
    return readyReservations.filter((r) => r.customerId === selectedCustomer.id && r.status === "listo_entrega");
  }, [selectedCustomer, readyReservations]);

  // Reservas listas coincidentes con la búsqueda rápida de cliente
  const matchingReadyReservations = useMemo(() => {
    if (!readyReservations || readyReservations.length === 0) return [];
    const q = customerSearch.toLowerCase().trim();
    if (!q) return [];
    return readyReservations.filter((r) =>
      (r.customerName && r.customerName.toLowerCase().includes(q)) ||
      (r.customerPhone && r.customerPhone.toLowerCase().includes(q)) ||
      String(r.id) === q ||
      `#${r.id}`.includes(q) ||
      (r.notes && r.notes.toLowerCase().includes(q)) ||
      r.details?.some(d => d.productName && d.productName.toLowerCase().includes(q))
    );
  }, [readyReservations, customerSearch]);

  // Reservas listas filtradas para el modal
  const filteredReadyReservations = useMemo(() => {
    if (!readyReservations || readyReservations.length === 0) return [];
    const q = reservationSearchQuery.toLowerCase().trim();
    if (!q) return readyReservations;
    return readyReservations.filter((r) =>
      (r.customerName && r.customerName.toLowerCase().includes(q)) ||
      (r.customerPhone && r.customerPhone.toLowerCase().includes(q)) ||
      String(r.id).includes(q) ||
      `#${r.id}`.includes(q) ||
      (r.notes && r.notes.toLowerCase().includes(q)) ||
      r.details?.some(
        (d) =>
          (d.productName && d.productName.toLowerCase().includes(q)) ||
          (d.specifications && d.specifications.toLowerCase().includes(q))
      )
    );
  }, [readyReservations, reservationSearchQuery]);

  // Por solicitud del usuario: ocultar y no aplicar el programa de puntos al momento de cobrar/vender
  const isLoyaltyActive = false;

  const subtotal = useMemo(() => cart.reduce((acc, i) =>
    acc + i.quantity * i.unitPrice * (1 - i.discount / 100), 0), [cart]);
  const totalDiscount = useMemo(() => cart.reduce((acc, i) =>
    acc + i.quantity * i.unitPrice * (i.discount / 100), 0), [cart]);

  const generalDiscountAmount = useMemo(() => {
    if (!generalDiscount || generalDiscount.value <= 0) return 0;
    if (generalDiscount.type === "pct") {
      return +(subtotal * (generalDiscount.value / 100)).toFixed(2);
    }
    return +Math.min(generalDiscount.value, subtotal).toFixed(2);
  }, [generalDiscount, subtotal]);

  const loyaltyDiscount = 0;

  const availableLoyaltyPoints = useMemo(() => {
    if (!isLoyaltyActive || !loyaltyBalance) return 0;
    return Math.max(0, loyaltyBalance.points - pointsToRedeem);
  }, [isLoyaltyActive, loyaltyBalance, pointsToRedeem]);

  const availableLoyaltyDiscount = useMemo(() => {
    if (!isLoyaltyActive || !loyaltyBalance) return 0;
    return Math.max(0, +(availableLoyaltyPoints * loyaltyBalance.redemptionRate).toFixed(2));
  }, [isLoyaltyActive, loyaltyBalance, availableLoyaltyPoints]);

  const couponDiscount = useMemo(() => {
    if (!validatedCoupon) return 0;
    const base = Math.max(0, subtotal - generalDiscountAmount - loyaltyDiscount);
    return +(base * validatedCoupon.discountPercent / 100).toFixed(2);
  }, [validatedCoupon, subtotal, generalDiscountAmount, loyaltyDiscount]);

  const netSubtotal = Math.max(0, subtotal - generalDiscountAmount - loyaltyDiscount - couponDiscount);
  const iva = 0;
  const total = Math.max(0, +netSubtotal.toFixed(2));

  const targetPayableAmount = useMemo(() => {
    if (linkedReservation) {
      return Math.max(0, +(linkedReservation.balance - reservationDiscount).toFixed(2));
    }
    return total;
  }, [linkedReservation, reservationDiscount, total]);

  const allocatedPayments = useMemo(() => {
    return activePaymentMethods
      .map((method) => ({ paymentMethod: method, amount: Number(combinedPayments[method]) || 0 }))
      .filter((payment) => payment.amount > 0)
      .map((payment) => ({ ...payment, amount: +payment.amount.toFixed(2) }));
  }, [activePaymentMethods, combinedPayments]);

  const allocatedPaymentTotal = useMemo(() => {
    return +allocatedPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2);
  }, [allocatedPayments]);

  const isSplitPaymentValid = useMemo(() => {
    if (!isCombinedPayment) return true;
    if (targetPayableAmount === 0) return true;
    return allocatedPayments.length >= 2 && Math.abs(allocatedPaymentTotal - targetPayableAmount) <= 0.05;
  }, [isCombinedPayment, targetPayableAmount, allocatedPayments, allocatedPaymentTotal]);

  const updateItemSpecifications = (productId: number, specifications: string) => {
    setCart(prev => prev.map(item => item.productId === productId ? { ...item, specifications } : item));
  };

  const handleRedeemCustomerDiscount = () => {
    if (!loyaltyBalance || loyaltyBalance.points <= 0) {
      Toast.fire({ icon: "info", title: "Sin puntos", text: "El cliente no tiene puntos acumulados para canjear." });
      return;
    }
    if (cart.length === 0) {
      Toast.fire({ icon: "warning", title: "Carrito vacío", text: "Agrega productos a la venta para aplicar el descuento del cliente." });
      return;
    }

    const rate = loyaltyBalance.redemptionRate || 0.01;
    const maxPointsNeeded = Math.ceil(subtotal / rate);
    const pointsToApply = Math.min(loyaltyBalance.points, maxPointsNeeded);
    const discountAmount = Math.min(+(pointsToApply * rate).toFixed(2), subtotal);

    setPointsToRedeem(pointsToApply);
    Toast.fire({
      icon: "success",
      title: "Descuento aplicado",
      text: `Se ha descontado ${formatCurrency(discountAmount, currencySymbol)} (${pointsToApply} puntos) del total a pagar.`
    });
  };

  const addToCart = (product: any, qty = 1) => {
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > product.stock) {
          Toast.fire({ icon: "error", title: "Stock insuficiente", text: `Solo quedan ${product.stock} unidades` });
          return prev;
        }
        return prev.map(i => i.productId === product.id ? { ...i, quantity: newQty } : i);
      }
      if (cartMode === "reserva") {
        return [...prev, {
          productId: product.id,
          productName: productLabel(product),
          quantity: qty,
          unitPrice: product.salePrice,
          discount: 0,
          stock: product.stock,
          imageUrl: product.imageUrl,
          specifications: [product.color && `Color: ${product.color}`, product.size && `Talla: ${product.size}`].filter(Boolean).join(" · "),
        }];
      }
      if (product.stock <= 0) {
        Toast.fire({ icon: "error", title: "Sin stock disponible" });
        return prev;
      }
      if (qty > product.stock) {
        Toast.fire({ icon: "error", title: "Stock insuficiente", text: `Solo quedan ${product.stock} unidades` });
        return prev;
      }
      return [...prev, {
        productId: product.id,
        productName: productLabel(product),
        quantity: qty,
        unitPrice: product.salePrice,
        discount: 0,
        stock: product.stock,
        imageUrl: product.imageUrl,
        specifications: "",
      }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId) {
        const newQty = item.quantity + delta;
        if (newQty > item.stock) {
          Toast.fire({ icon: "error", title: "Stock insuficiente" });
          return item;
        }
        return newQty > 0 ? { ...item, quantity: newQty } : item;
      }
      return item;
    }).filter(i => i.quantity > 0));
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(i => i.productId !== productId));
  };

  const applyDiscount = async (productId: number, productName: string, unitPrice: number) => {
    const { isConfirmed, value } = await Swal.fire({
      title: "Descuento rápido",
      html: `
        <p class="text-sm text-gray-500 mb-4">${productName}</p>
        <div class="flex gap-2 mb-4" id="disc-type-btns">
          <button type="button" id="btn-pct"
            class="flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-indigo-600 bg-indigo-600 text-white transition-all"
            onclick="window._dtype='pct';
              document.getElementById('btn-pct').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-indigo-600 bg-indigo-600 text-white transition-all';
              document.getElementById('btn-fixed').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-gray-200 text-gray-500 transition-all';
              document.getElementById('disc-label').textContent='Porcentaje (0–100)'">
            % Porcentaje
          </button>
          <button type="button" id="btn-fixed"
            class="flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-gray-200 text-gray-500 transition-all"
            onclick="window._dtype='fixed';
              document.getElementById('btn-fixed').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-indigo-600 bg-indigo-600 text-white transition-all';
              document.getElementById('btn-pct').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-gray-200 text-gray-500 transition-all';
              document.getElementById('disc-label').textContent='Monto fijo (${currencySymbol})'">
            $ Monto fijo
          </button>
        </div>
        <label id="disc-label" class="block text-xs text-gray-400 mb-1 text-left">Porcentaje (0–100)</label>
        <input id="disc-val" type="number" min="0" step="0.01"
          class="swal2-input !mt-0"
          placeholder="Ej: 10">
      `,
      confirmButtonText: "Aplicar",
      confirmButtonColor: "#4F46E5",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      focusConfirm: false,
      didOpen: () => { (window as any)._dtype = "pct"; },
      preConfirm: () => {
        const val = parseFloat((document.getElementById("disc-val") as HTMLInputElement).value);
        const dtype = (window as any)._dtype || "pct";
        if (isNaN(val) || val < 0) { Swal.showValidationMessage("Ingresa un valor válido mayor a 0"); return false; }
        if (dtype === "pct" && val > 100) { Swal.showValidationMessage("El porcentaje no puede superar 100%"); return false; }
        if (dtype === "fixed" && val > unitPrice) { Swal.showValidationMessage(`El descuento no puede superar el precio (${formatCurrency(unitPrice, currencySymbol)})`); return false; }
        return { dtype, val };
      },
    });
    if (!isConfirmed || !value) return;
    const discountPct = value.dtype === "pct" ? value.val : (value.val / unitPrice) * 100;
    setCart(prev => prev.map(item =>
      item.productId === productId ? { ...item, discount: Math.min(discountPct, 100) } : item
    ));
    Toast.fire({ icon: "success", title: `Descuento ${value.dtype === "pct" ? `${value.val}%` : formatCurrency(value.val, currencySymbol)} aplicado` });
  };

  const handleApplyGeneralDiscount = async () => {
    if (cart.length === 0) {
      Toast.fire({ icon: "warning", title: "Carrito vacío", text: "Agrega productos a la venta antes de aplicar un descuento." });
      return;
    }
    const currentSubtotal = subtotal;
    const { isConfirmed, value } = await Swal.fire({
      title: "Descuento a la venta",
      html: `
        <div style="text-align: left; font-size: 13px; line-height: 1.4;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #64748b; font-weight: 500;">Subtotal de la venta:</span>
            <span style="font-size: 15px; font-weight: 700; color: #0f172a;">${formatCurrency(currentSubtotal, currencySymbol)}</span>
          </div>

          <p style="font-weight: 600; color: #334155; margin-bottom: 6px;">Tipo de descuento:</p>
          <div style="display: flex; gap: 8px; margin-bottom: 12px;" id="disc-general-btns">
            <button type="button" id="btn-g-pct"
              style="flex: 1; padding: 8px 12px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 2px solid #4f46e5; background: #4f46e5; color: white; cursor: pointer; transition: all 0.2s;"
              onclick="window._gdtype='pct';
                document.getElementById('btn-g-pct').style.borderColor='#4f46e5';
                document.getElementById('btn-g-pct').style.background='#4f46e5';
                document.getElementById('btn-g-pct').style.color='white';
                document.getElementById('btn-g-fixed').style.borderColor='#e2e8f0';
                document.getElementById('btn-g-fixed').style.background='white';
                document.getElementById('btn-g-fixed').style.color='#64748b';
                document.getElementById('disc-g-label').textContent='Porcentaje de descuento (%):';
                document.getElementById('disc-g-preset-container').style.display='flex';
                document.getElementById('disc-g-val').placeholder='Ej: 10';
                window._recalcDisc();">
              % Porcentaje
            </button>
            <button type="button" id="btn-g-fixed"
              style="flex: 1; padding: 8px 12px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 2px solid #e2e8f0; background: white; color: #64748b; cursor: pointer; transition: all 0.2s;"
              onclick="window._gdtype='fixed';
                document.getElementById('btn-g-fixed').style.borderColor='#4f46e5';
                document.getElementById('btn-g-fixed').style.background='#4f46e5';
                document.getElementById('btn-g-fixed').style.color='white';
                document.getElementById('btn-g-pct').style.borderColor='#e2e8f0';
                document.getElementById('btn-g-pct').style.background='white';
                document.getElementById('btn-g-pct').style.color='#64748b';
                document.getElementById('disc-g-label').textContent='Monto fijo a descontar (${currencySymbol}):';
                document.getElementById('disc-g-preset-container').style.display='none';
                document.getElementById('disc-g-val').placeholder='Ej: 20';
                window._recalcDisc();">
              $ Monto fijo (${currencySymbol})
            </button>
          </div>

          <div id="disc-g-preset-container" style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
            <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">Accesos rápidos:</span>
            <button type="button" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #f1f5f9; cursor: pointer;" onclick="document.getElementById('disc-g-val').value='5'; window._recalcDisc();">5%</button>
            <button type="button" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #f1f5f9; cursor: pointer;" onclick="document.getElementById('disc-g-val').value='10'; window._recalcDisc();">10%</button>
            <button type="button" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #f1f5f9; cursor: pointer;" onclick="document.getElementById('disc-g-val').value='15'; window._recalcDisc();">15%</button>
            <button type="button" style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #f1f5f9; cursor: pointer;" onclick="document.getElementById('disc-g-val').value='20'; window._recalcDisc();">20%</button>
          </div>

          <label id="disc-g-label" style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Porcentaje de descuento (%):</label>
          <input id="disc-g-val" type="number" min="0" step="0.01"
            class="swal2-input" style="margin: 0 0 10px 0; width: 100%; box-sizing: border-box; font-size: 15px; font-weight: 700;"
            placeholder="Ej: 10"
            value="${generalDiscount?.value ?? ""}"
            oninput="window._recalcDisc();">

          <div id="disc-preview-box" style="padding: 10px 14px; border-radius: 8px; background: #eef2ff; border: 1px solid #c7d2fe; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; color: #312e81; font-weight: 600;">Total final estimado:</span>
            <strong id="disc-preview-total" style="font-size: 14px; color: #4338ca;">${formatCurrency(Math.max(0, currentSubtotal - generalDiscountAmount), currencySymbol)}</strong>
          </div>
        </div>
      `,
      confirmButtonText: "Aplicar descuento",
      confirmButtonColor: "#4F46E5",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      focusConfirm: false,
      didOpen: () => {
        (window as any)._gdtype = generalDiscount?.type || "pct";
        const sub = currentSubtotal;
        const sym = "${currencySymbol}";
        (window as any)._recalcDisc = () => {
          const dtype = (window as any)._gdtype || "pct";
          const input = document.getElementById("disc-g-val") as HTMLInputElement;
          const preview = document.getElementById("disc-preview-total");
          if (!input || !preview) return;
          const val = parseFloat(input.value) || 0;
          const disc = dtype === "pct" ? (sub * (val / 100)) : val;
          const finalTot = Math.max(0, sub - disc);
          preview.textContent = sym + " " + finalTot.toFixed(2);
        };
        if ((window as any)._gdtype === "fixed") {
          const btnF = document.getElementById("btn-g-fixed");
          if (btnF) btnF.click();
        }
      },
      preConfirm: () => {
        const val = parseFloat((document.getElementById("disc-g-val") as HTMLInputElement).value);
        const dtype = (window as any)._gdtype || "pct";
        if (isNaN(val) || val <= 0) { Swal.showValidationMessage("Ingresa un monto o porcentaje mayor a 0"); return false; }
        if (dtype === "pct" && val > 100) { Swal.showValidationMessage("El porcentaje no puede superar 100%"); return false; }
        if (dtype === "fixed" && val > currentSubtotal) { Swal.showValidationMessage(`El descuento no puede superar el subtotal (${formatCurrency(currentSubtotal, currencySymbol)})`); return false; }
        return { type: dtype as "pct" | "fixed", value: val };
      },
    });
    if (!isConfirmed || !value) return;
    setGeneralDiscount(value);
    const calculated = value.type === "pct" ? (currentSubtotal * value.value / 100) : value.value;
    Toast.fire({
      icon: "success",
      title: "Descuento aplicado",
      text: `-${value.type === "pct" ? `${value.value}%` : formatCurrency(value.value, currencySymbol)} (${formatCurrency(calculated, currencySymbol)})`
    });
  };

  const handleApplyReservationDiscount = async () => {
    if (!linkedReservation) return;
    const currentBal = linkedReservation.balance;
    const { isConfirmed, value } = await Swal.fire({
      title: "Descuento a la entrega",
      html: `
        <p class="text-sm text-gray-500 mb-4">Saldo pendiente: <b>${formatCurrency(currentBal, currencySymbol)}</b></p>
        <div class="flex gap-2 mb-4" id="rdisc-btns">
          <button type="button" id="btn-rd-fixed"
            class="flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-indigo-600 bg-indigo-600 text-white transition-all"
            onclick="window._rdtype='fixed';
              document.getElementById('btn-rd-fixed').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-indigo-600 bg-indigo-600 text-white transition-all';
              document.getElementById('btn-rd-pct').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-gray-200 text-gray-500 transition-all';
              document.getElementById('rdisc-label').textContent='Monto fijo (${currencySymbol})'">
            $ Monto fijo
          </button>
          <button type="button" id="btn-rd-pct"
            class="flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-gray-200 text-gray-500 transition-all"
            onclick="window._rdtype='pct';
              document.getElementById('btn-rd-pct').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-indigo-600 bg-indigo-600 text-white transition-all';
              document.getElementById('btn-rd-fixed').className='flex-1 py-2 text-sm font-semibold rounded-lg border-2 border-gray-200 text-gray-500 transition-all';
              document.getElementById('rdisc-label').textContent='Porcentaje (0–100) %'">
            % Porcentaje
          </button>
        </div>
        <label id="rdisc-label" class="block text-xs text-gray-400 mb-1 text-left">Monto fijo (${currencySymbol})</label>
        <input id="rdisc-val" type="number" min="0" step="0.01"
          class="swal2-input !mt-0"
          placeholder="Ej: 20"
          value="${reservationDiscount > 0 ? reservationDiscount : ""}">
      `,
      confirmButtonText: "Aplicar descuento",
      confirmButtonColor: "#4F46E5",
      cancelButtonText: "Cancelar",
      showCancelButton: true,
      focusConfirm: false,
      didOpen: () => { (window as any)._rdtype = "fixed"; },
      preConfirm: () => {
        const val = parseFloat((document.getElementById("rdisc-val") as HTMLInputElement).value);
        const dtype = (window as any)._rdtype || "fixed";
        if (isNaN(val) || val <= 0) { Swal.showValidationMessage("Ingresa un monto o porcentaje mayor a 0"); return false; }
        if (dtype === "pct" && val > 100) { Swal.showValidationMessage("El porcentaje no puede superar 100%"); return false; }
        const discAmount = dtype === "pct" ? (currentBal * val / 100) : val;
        if (discAmount > currentBal) { Swal.showValidationMessage(`El descuento no puede superar el saldo pendiente (${formatCurrency(currentBal, currencySymbol)})`); return false; }
        return discAmount;
      },
    });
    if (!isConfirmed || typeof value !== "number") return;
    setReservationDiscount(Number(value.toFixed(2)));
    Toast.fire({ icon: "success", title: `Descuento de ${formatCurrency(value, currencySymbol)} aplicado a la entrega` });
  };

  const suspendSale = () => {
    if (cart.length === 0) return;
    const newSuspended: SuspendedSale = {
      id: Date.now().toString(),
      label: `Venta #${suspendedSales.length + 1} — ${cart.length} producto${cart.length !== 1 ? "s" : ""}`,
      cart: [...cart],
      customerId,
      customerSearch,
      paymentMethod,
      notes,
      suspendedAt: new Date(),
    };
    setSuspendedSales(prev => [...prev, newSuspended]);
    setCart([]);
    setCustomerId("none");
    setCustomerSearch("");
    setNotes("");
    setPendingQty(1);
    setBarcodeInput("");
    Toast.fire({ icon: "info", title: "Venta suspendida", text: `${newSuspended.label} guardada` });
  };

  const recoverSale = (id: string) => {
    const suspended = suspendedSales.find(s => s.id === id);
    if (!suspended) return;
    if (cart.length > 0) suspendSale();
    setCart(suspended.cart);
    setCustomerId(suspended.customerId);
    setCustomerSearch(suspended.customerSearch);
    setPaymentMethod(suspended.paymentMethod);
    setNotes(suspended.notes);
    setSuspendedSales(prev => prev.filter(s => s.id !== id));
    setShowSuspended(false);
    Toast.fire({ icon: "success", title: "Venta recuperada", text: suspended.label });
  };

  const discardSuspended = async (id: string) => {
    const result = await Swal.fire({
      title: "¿Descartar esta venta?",
      text: "Se eliminarán los productos del carrito en espera.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonText: "Cancelar",
      confirmButtonText: "Sí, descartar",
    });
    if (!result.isConfirmed) return;
    setSuspendedSales(prev => prev.filter(s => s.id !== id));
    Toast.fire({ icon: "info", title: "Venta descartada" });
  };

  // Kiosk mode: auto-focus barcode input when cart is empty
  useEffect(() => {
    if (cart.length === 0) {
      const t = setTimeout(() => barcodeRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [cart.length]);

  // Escape key: clear search, pending qty and return focus to barcode scanner
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearch("");
        setBarcodeInput("");
        setPendingQty(1);
        barcodeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, []);

  const handleBarcodeScan = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed || !products) return;
    const product = products.find(
      p => p.barcode && p.barcode.toLowerCase() === trimmed.toLowerCase()
    );
    if (!product) {
      Toast.fire({ icon: "error", title: "Código no encontrado", text: `Barcode: ${trimmed}` });
      return;
    }
    const qty = pendingQty;
    setPendingQty(1);
    addToCart(product, qty);
    Toast.fire({ icon: "success", title: `✓ ${productLabel(product)}`, text: qty > 1 ? `${qty} unidades añadidas` : "Añadido al carrito" });
  }, [products, pendingQty]);

  const processSale = async () => {
    if (cart.length === 0) return;
    if (!cashRegister || cashRegister.status !== "open") {
      Swal.fire({ icon: "warning", title: "Caja no abierta", text: "Abre tu caja en el módulo Cierre de Caja antes de registrar ventas." });
      return;
    }
    if (!isSplitPaymentValid) {
      Swal.fire({ icon: "warning", title: "Pagos incompletos", text: "Distribuye el total entre al menos dos formas de pago y verifica que la suma coincida con la venta." });
      return;
    }
    const cartSnapshot = [...cart];
    const customerIdSnapshot = customerId;
    const selectedCustomerSnapshot = selectedCustomer;
    const paymentMethodSnapshot = isCombinedPayment
      ? allocatedPayments.map(({ paymentMethod: method }) => method).join(" + ")
      : paymentMethod;
    const paymentBreakdownSnapshot = isCombinedPayment ? allocatedPayments : undefined;
    const loyaltyDiscountSnapshot = loyaltyDiscount;
    const pointsToRedeemSnapshot = pointsToRedeem;
    const cashReceivedSnapshot = cashReceived;

    // If redeeming points, deduct them first
    if (pointsToRedeemSnapshot > 0 && customerIdSnapshot !== "none") {
      setRedeemingPoints(true);
      try {
        await apiFetch("/api/loyalty/redeem", {
          method: "POST",
          body: JSON.stringify({ customerId: parseInt(customerIdSnapshot), pointsToRedeem: pointsToRedeemSnapshot }),
        });
      } catch (err: any) {
        setRedeemingPoints(false);
        Swal.fire({ icon: "error", title: "Error al canjear puntos", text: err.message, confirmButtonColor: "#4F46E5" });
        return;
      }
      setRedeemingPoints(false);
    }

    const couponSnapshot = validatedCoupon;
    const couponDiscountSnapshot = couponDiscount;
    const generalDiscountSnapshot = generalDiscountAmount;

    const notesParts = [
      notes || null,
      generalDiscountSnapshot > 0 ? `Desc. general: -${formatCurrency(generalDiscountSnapshot, currencySymbol)}` : null,
      loyaltyDiscountSnapshot > 0 ? `Desc. puntos: ${formatCurrency(loyaltyDiscountSnapshot, currencySymbol)} (${pointsToRedeemSnapshot} pts)` : null,
      couponSnapshot ? `Cupón ${couponSnapshot.code}: -${couponSnapshot.discountPercent}%` : null,
    ].filter(Boolean);
    const notesWithPoints = notesParts.length > 0 ? notesParts.join(" | ") : null;

    const totalDiscountToApply = +(totalDiscount + generalDiscountSnapshot + loyaltyDiscountSnapshot + couponDiscountSnapshot).toFixed(2);

    const parsedCashReceived = isCombinedPayment
      ? (allocatedPayments.some((payment) => isCash(payment.paymentMethod))
        ? allocatedPayments.filter((payment) => isCash(payment.paymentMethod)).reduce((sum, payment) => sum + payment.amount, 0)
        : null)
      : isCash(paymentMethodSnapshot)
      ? (cashReceivedSnapshot ? parseFloat(cashReceivedSnapshot) : total)
      : null;
    const computedChange = isCombinedPayment
      ? 0
      : parsedCashReceived !== null && parsedCashReceived >= total
      ? +(parsedCashReceived - total).toFixed(2)
      : (isCash(paymentMethodSnapshot) ? 0 : null);

    createSale.mutate({
      data: {
        customerId: customerIdSnapshot === "none" ? null : parseInt(customerIdSnapshot),
        cashRegisterSessionId: cashRegister.id,
        paymentMethod: isCombinedPayment ? "Pago combinado" : paymentMethodSnapshot,
        payments: paymentBreakdownSnapshot,
        amountPaid: parsedCashReceived,
        changeDue: computedChange,
        notes: notesWithPoints,
        discount: totalDiscountToApply,
        items: cartSnapshot.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: +(i.unitPrice * (1 - (i.discount || 0) / 100)).toFixed(2),
        })),
      } as any,
    }, {
      onSuccess: async (sale) => {
        const earned = (sale as any).pointsEarned ?? (
          selectedCustomerSnapshot && (sale as any).pointsEarned !== 0 && settings?.loyaltyEnabled
            ? Math.round(sale.total * Number(settings?.pointsPerUnit ?? 1))
            : 0
        );
        const saleForModal: CompletedSaleForModal = {
          id: sale.id,
          customerName: selectedCustomerSnapshot?.name ?? (sale as any).customerName ?? null,
          customerNitCi: selectedCustomerSnapshot?.nitCi ?? (sale as any).customerNitCi ?? null,
          customerPhone: selectedCustomerSnapshot?.phone ?? (sale as any).customerPhone ?? null,
          userName: (sale as any).userName ?? user?.name ?? null,
          subtotal: sale.subtotal,
          iva: sale.iva,
          total: sale.total,
          paymentMethod: sale.paymentMethod,
          amountPaid: sale.amountPaid !== undefined && sale.amountPaid !== null ? Number(sale.amountPaid) : parsedCashReceived,
          changeDue: sale.changeDue !== undefined && sale.changeDue !== null ? Number(sale.changeDue) : computedChange,
          status: sale.status,
          notes: notesWithPoints,
          createdAt: sale.createdAt || new Date().toISOString(),
          pointsEarned: earned,
          details: cartSnapshot.map((item, idx) => ({
            id: idx + 1,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.quantity * item.unitPrice,
          })),
        };
        setCompletedSale(saleForModal);
        // Abrir el cajón de dinero (conectado a la impresora térmica) al confirmar la venta.
        apiFetch("/api/hardware/open-drawer", {
          method: "POST",
          body: JSON.stringify({ paymentMethod: paymentBreakdownSnapshot?.some((payment) => isCash(payment.paymentMethod)) ? "Efectivo" : paymentMethodSnapshot }),
        }).catch(() => {});
        if (selectedCustomerSnapshot?.email && settings) {
          emailBoleta(saleForModal, settings, API_URL, getToken())
            .then(() => Toast.fire({ icon: "success", title: "Boleta enviada al correo del cliente" }))
            .catch((err: Error) => Toast.fire({ icon: "warning", title: "Venta registrada", text: err.message }));
        }
        // Redeem coupon if one was applied
        if (couponSnapshot) {
          apiFetch("/api/coupons/redeem", {
            method: "POST",
            body: JSON.stringify({ code: couponSnapshot.code, saleId: sale.id }),
          }).catch(() => {});
        }
        setCart([]);
        setCustomerId("none");
        setCustomerSearch("");
        setNotes("");
        setCashReceived("");
        setCombinedPayments({});
        setIsCombinedPayment(false);
        setPointsToRedeem(0);
        setGeneralDiscount(null);
        setValidatedCoupon(null);
        setCouponInput("");
        if (isCash(paymentMethodSnapshot) && cashReceivedSnapshot) {
          const change = parseFloat(cashReceivedSnapshot) - sale.total;
          if (change > 0) {
            Toast.fire({ icon: "success", title: "Cambio a entregar", text: formatCurrency(change, currencySymbol), timer: 4000 });
          }
        }
        // Show loyalty earned notification
        if ((sale as any).pointsEarned > 0) {
          Toast.fire({ icon: "success", title: `+${(sale as any).pointsEarned} puntos acumulados`, timer: 3000 });
        } else if (pointsToRedeemSnapshot > 0 && customerIdSnapshot !== "none") {
          Toast.fire({
            icon: "info",
            title: "Puntos en cero",
            text: "El cliente canjeó todos sus descuentos: nivel reiniciado a Bronce. En su próxima compra sin canje volverá a acumular puntos.",
            timer: 4000,
          });
        }
        if (couponSnapshot) {
          Toast.fire({ icon: "success", title: `Cupón ${couponSnapshot.code} canjeado`, text: `-${couponSnapshot.discountPercent}%`, timer: 3000 });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/products"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/loyalty"] });
        queryClient.invalidateQueries({ queryKey: ["/api/cash-register"] });
      },
      onError: (err: any) => {
        Swal.fire({ icon: "error", title: "Error al procesar venta", text: err.message, confirmButtonColor: "#4F46E5" });
      },
    });
  };

  const processReservationDelivery = async () => {
    if (!linkedReservation || linkedReservation.status === "entregada") return;
    if (!cashRegister || cashRegister.status !== "open") {
      Swal.fire({ icon: "warning", title: "Caja no abierta", text: "Abre tu caja antes de cobrar la entrega." });
      return;
    }
    const discountToApply = Math.min(reservationDiscount, linkedReservation.balance);
    const amountDue = Math.max(0, Number((linkedReservation.balance - discountToApply).toFixed(2)));

    if (isCombinedPayment && !isSplitPaymentValid) {
      Swal.fire({
        icon: "warning",
        title: "Pagos divididos incompletos",
        text: `La suma de los métodos divididos (${formatCurrency(allocatedPaymentTotal, currencySymbol)}) debe coincidir con el saldo a cobrar (${formatCurrency(amountDue, currencySymbol)}). Distribuye el monto en al menos dos formas de pago.`
      });
      return;
    }

    const splitPayments = isCombinedPayment ? allocatedPayments : undefined;
    const effectivePaymentMethod = isCombinedPayment
      ? allocatedPayments.map(p => p.paymentMethod).join(" + ")
      : paymentMethod;

    const cashPart = isCombinedPayment
      ? (allocatedPayments.find(p => isCash(p.paymentMethod))?.amount ?? 0)
      : (isCash(paymentMethod) ? amountDue : 0);

    const tendered = cashPart > 0
      ? (reservationCashReceived.trim() ? Number(reservationCashReceived) : cashPart)
      : undefined;

    if (cashPart > 0 && tendered !== undefined && tendered < cashPart) {
      Swal.fire({
        icon: "warning",
        title: "Pago insuficiente",
        text: `El efectivo recibido (${formatCurrency(tendered, currencySymbol)}) debe ser al menos ${formatCurrency(cashPart, currencySymbol)}.`
      });
      return;
    }

    try {
      const sale = await apiFetch(`/api/reservations/${linkedReservation.id}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          cashRegisterSessionId: cashRegister.id,
          paymentMethod: effectivePaymentMethod,
          payments: splitPayments,
          ...(tendered !== undefined ? { cashReceived: tendered } : {}),
          discount: discountToApply,
        }),
      });
      setCompletedSale({
        id: sale.id,
        customerName: linkedReservation.customerName,
        customerNitCi: null,
        customerPhone: linkedReservation.customerPhone ?? null,
        userName: sale.userName ?? user?.name ?? null,
        subtotal: sale.subtotal,
        iva: sale.iva,
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        amountPaid: sale.amountPaid,
        changeDue: sale.changeDue,
        status: sale.status,
        notes: sale.notes,
        createdAt: sale.createdAt || new Date().toISOString(),
        pointsEarned: 0,
        details: sale.details.map((detail: { id: number; productName: string; quantity: number; unitPrice: number; subtotal: number }) => ({
          id: detail.id,
          productName: detail.productName,
          quantity: detail.quantity,
          unitPrice: detail.unitPrice,
          subtotal: detail.subtotal,
        })),
      });

      // Abrir cajón de dinero si hubo pago en efectivo
      if (cashPart > 0) {
        apiFetch("/api/hardware/open-drawer", {
          method: "POST",
          body: JSON.stringify({ paymentMethod: "Efectivo" }),
        }).catch(() => {});
      }

      setReservationCashReceived("");
      setReservationDiscount(0);
      setIsCombinedPayment(false);
      setCombinedPayments({});
      setActiveReservationId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/reservations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/reservations", linkedReservation.id] }),
        queryClient.invalidateQueries({ queryKey: ["/api/sales"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/cash-register"] }),
      ]);
      refetchReadyReservations();
      if (window.location.search.includes("reserva")) {
        window.history.replaceState({}, "", "/pos");
      }
      Toast.fire({ icon: "success", title: `Entrega de la reserva #${linkedReservation.id} registrada exitosamente` });
    } catch (error) {
      Swal.fire({
        icon: "error",
        title: "No se pudo completar la entrega",
        text: error instanceof Error ? error.message : "Error inesperado",
      });
    }
  };

  const processCreateReservation = async () => {
    if (cart.length === 0) {
      Toast.fire({ icon: "warning", title: "Carrito vacío", text: "Agrega productos a la reserva antes de guardar." });
      return;
    }
    if (customerId === "none" || !selectedCustomer) {
      Swal.fire({
        icon: "warning",
        title: "Cliente requerido",
        text: "Para registrar una reserva debes seleccionar un cliente existente o registrar uno nuevo.",
        confirmButtonColor: "#4F46E5"
      });
      return;
    }

    const reservationTotal = cart.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
    const mixedDepositTotal = (Number(mixedDepositCash) || 0) + (Number(mixedDepositTransfer) || 0);
    const depositNum = isMixedDeposit ? mixedDepositTotal : (Number(deposit) || 0);

    if (depositNum < 0) {
      Swal.fire({ icon: "warning", title: "Adelanto inválido", text: "El adelanto no puede ser negativo." });
      return;
    }

    if (depositNum > reservationTotal) {
      Swal.fire({
        icon: "warning",
        title: "Adelanto excesivo",
        text: `El adelanto (${formatCurrency(depositNum, currencySymbol)}) no puede ser mayor al total de la reserva (${formatCurrency(reservationTotal, currencySymbol)}).`
      });
      return;
    }

    let finalDepositMethod: string | null = null;
    let finalPayments: Array<{ paymentMethod: string; amount: number }> | undefined = undefined;

    if (depositNum > 0) {
      if (isMixedDeposit) {
        const cashAmt = Number(mixedDepositCash) || 0;
        const transAmt = Number(mixedDepositTransfer) || 0;
        const paymentsList: Array<{ paymentMethod: string; amount: number }> = [];
        if (cashAmt > 0) paymentsList.push({ paymentMethod: "Efectivo", amount: Number(cashAmt.toFixed(2)) });
        if (transAmt > 0) paymentsList.push({ paymentMethod: "Transferencia", amount: Number(transAmt.toFixed(2)) });
        if (paymentsList.length === 0) {
          Swal.fire({ icon: "warning", title: "Monto requerido", text: "Ingresa el monto del adelanto en efectivo y/o transferencia." });
          return;
        }
        finalPayments = paymentsList;
        finalDepositMethod = paymentsList.map(p => `${p.paymentMethod}: ${p.amount.toFixed(2)}`).join(" / ");
      } else {
        finalDepositMethod = depositMethod.trim() || "Efectivo";
        finalPayments = [{ paymentMethod: finalDepositMethod, amount: depositNum }];
      }
    }

    setIsSavingReservation(true);
    try {
      const payload = {
        customerId: parseInt(customerId),
        deposit: depositNum,
        depositMethod: finalDepositMethod,
        payments: finalPayments,
        cashRegisterSessionId: cashRegister?.status === "open" ? cashRegister.id : undefined,
        reservationDate: reservationDate || localBusinessDate(),
        expectedAt: expectedAt || null,
        notes: notes.trim() || null,
        details: cart.map(item => ({
          productId: item.productId,
          specifications: (item.specifications && item.specifications.trim()) ? item.specifications.trim() : item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      };

      const res = await apiFetch("/api/reservations", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setIsSavingReservation(false);

      await Swal.fire({
        icon: "success",
        title: `¡Reserva #${res.id} guardada con éxito!`,
        html: `
          <div style="text-align: left; font-size: 13px; line-height: 1.6;">
            <p><b>Cliente:</b> ${selectedCustomer.name}</p>
            <p><b>Fecha de reserva:</b> ${res.reservationDate || reservationDate}</p>
            ${expectedAt ? `<p><b>Fecha estimada de entrega:</b> ${expectedAt}</p>` : ""}
            <p><b>Total de prendas / productos:</b> ${cart.reduce((s, i) => s + i.quantity, 0)} unid.</p>
            <p><b>Total reserva:</b> ${formatCurrency(res.total, currencySymbol)}</p>
            <p><b>Adelanto pagado:</b> ${formatCurrency(res.deposit, currencySymbol)} ${depositNum > 0 && finalDepositMethod ? `(${finalDepositMethod})` : ""}</p>
            <p style="color: #047857; font-weight: bold; font-size: 14px;"><b>Saldo pendiente a la entrega:</b> ${formatCurrency(res.balance, currencySymbol)}</p>
          </div>
        `,
        confirmButtonColor: "#047857",
        confirmButtonText: "Entendido",
      });

      setCart([]);
      setCustomerId("none");
      setCustomerSearch("");
      setDeposit("0");
      setDepositMethod("Efectivo");
      setIsMixedDeposit(false);
      setMixedDepositCash("");
      setMixedDepositTransfer("");
      setExpectedAt("");
      setNotes("");
      setCartMode("sale");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/reservations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/cash-register"] }),
      ]);
      refetchReadyReservations();
    } catch (err: any) {
      setIsSavingReservation(false);
      Swal.fire({
        icon: "error",
        title: "Error al guardar reserva",
        text: err.message || "No se pudo registrar la reserva",
        confirmButtonColor: "#4F46E5"
      });
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-5.5rem)] gap-4">
      {/* ===== LEFT: Product Catalog ===== */}
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {!cashRegisterLoading && (!cashRegister || cashRegister.status !== "open") && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Abre tu caja en el módulo <strong>Cierre de Caja</strong> antes de registrar ventas.
          </div>
        )}
        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Buscar producto por nombre o código..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 h-11 bg-white border-border shadow-sm rounded-xl"
            />
          </div>
          {/* Barcode scanner input */}
          <div className="relative w-52 shrink-0">
            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/70 pointer-events-none z-10" />
            {pendingQty > 1 && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-white text-xs font-bold px-1.5 py-0.5 rounded-md z-10 pointer-events-none">
                ×{pendingQty}
              </span>
            )}
            <Input
              ref={barcodeRef}
              value={barcodeInput}
              onChange={e => {
                const val = e.target.value;
                // Detect quantity shortcut: e.g. "3*" or "5×"
                const match = val.match(/^(\d+)[*×]$/);
                if (match) {
                  const qty = Math.min(parseInt(match[1], 10), 999);
                  if (qty >= 1) {
                    setPendingQty(qty);
                    setBarcodeInput("");
                    Toast.fire({ icon: "info", title: `Cantidad: ×${qty}`, text: "Escanea el producto ahora" });
                    return;
                  }
                }
                setBarcodeInput(val);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  handleBarcodeScan(barcodeInput);
                  setBarcodeInput("");
                } else if (e.key.length === 1 && /[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s]/u.test(e.key) && !barcodeInput) {
                  // Letter key with empty scanner → redirect to search box
                  e.preventDefault();
                  setSearch(e.key);
                  searchRef.current?.focus();
                }
              }}
              placeholder={pendingQty > 1 ? `×${pendingQty} — Escanear...` : "Escanear código..."}
              className={`pl-9 h-11 bg-white shadow-sm rounded-xl text-sm ${pendingQty > 1 ? "border-primary border-2 pr-10" : "border-primary/30 focus:border-primary"}`}
              autoComplete="off"
            />
          </div>
          {/* Ready reservations quick access button */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowReadyReservationsModal(true)}
            className={`h-11 px-3 text-xs rounded-xl font-bold gap-1.5 shadow-sm transition-all shrink-0 ${
              readyReservations && readyReservations.length > 0
                ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300"
                : "text-muted-foreground border-border hover:bg-muted"
            }`}
            title="Ver pedidos personalizados listos para entregar"
          >
            <Package className="w-4 h-4 text-emerald-600" />
            <span>Reservas listas</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
              readyReservations && readyReservations.length > 0 ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
            }`}>
              {readyReservations?.length || 0}
            </span>
          </Button>
        </div>

        {/* Banner de reservas listas para entrega */}
        {readyReservations && readyReservations.length > 0 && !activeReservationId && (
          <div className="bg-emerald-50/90 border border-emerald-300 rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2.5 text-xs text-emerald-950 font-semibold min-w-0">
              <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Package className="w-4 h-4" />
              </div>
              <p className="truncate">
                Hay <strong className="text-emerald-800 font-extrabold">{readyReservations.length} reserva(s) lista(s)</strong> para entrega inmediata.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowReadyReservationsModal(true)}
              className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 rounded-xl shrink-0 gap-1.5 shadow-xs"
            >
              <span>Ver reservas</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* Category chips — Perfisoft style */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setCategoryId(null)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${
              categoryId === null
                ? "bg-primary text-white border-primary shadow-sm"
                : "bg-white text-muted-foreground border-border hover:border-primary/50 hover:text-primary"
            }`}
          >
            Todos {products && categoryId === null ? `(${products.length})` : ""}
          </button>
          {categories?.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategoryId(cat.id === categoryId ? null : cat.id)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all border flex items-center gap-1.5 ${
                categoryId === cat.id
                  ? "bg-primary text-white border-primary shadow-sm"
                  : "bg-white text-muted-foreground border-border hover:border-primary/50 hover:text-primary"
              }`}
            >
              {(cat as any).color && (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: (cat as any).color }} />
              )}
              {cat.name}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <ScrollArea className="flex-1">
          {productsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl h-48 animate-pulse" />
              ))}
            </div>
          ) : products?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-medium">No se encontraron productos</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
              {products?.map(product => {
                const inCart = cart.find(i => i.productId === product.id);
                const outOfStock = product.stock <= 0;
                return (
                  <Card
                    key={product.id}
                    className={`cursor-pointer transition-all border-0 shadow-sm overflow-hidden group ${
                      outOfStock ? "opacity-50 cursor-not-allowed" : "hover:shadow-md hover:-translate-y-0.5"
                    } ${inCart ? "ring-2 ring-primary" : ""}`}
                    onClick={() => !outOfStock && addToCart(product)}
                  >
                    {/* Image */}
                    <div className="h-28 bg-muted/50 flex items-center justify-center overflow-hidden border-b border-border/50">
                      <ProductThumbnail src={product.imageUrl} alt={product.name} />
                    </div>
                    <CardContent className="p-3">
                      <p className="font-semibold text-sm leading-tight line-clamp-1">{product.name}</p>
                      {(product.size || product.color) && (
                        <p className="text-[10px] text-muted-foreground line-clamp-1">
                          {[product.size && `Talla ${product.size}`, product.color && `Color ${product.color}`].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-0.5">{product.barcode || "Sin código"}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-bold text-primary text-sm">{formatCurrency(product.salePrice, currencySymbol)}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          product.stock === 0 ? "stock-zero" : product.stock <= product.minStock ? "stock-low" : "stock-ok"
                        }`}>
                          {product.stock}
                        </span>
                      </div>
                      {inCart && (
                        <div className="mt-2 flex items-center justify-center gap-1 text-[10px] font-medium text-primary bg-primary/10 rounded-full py-0.5">
                          <CheckCircle2 className="w-3 h-3" /> En carrito ({inCart.quantity})
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ===== RIGHT: Cart + Sale Panel ===== */}
      <div className="w-full lg:w-[360px] flex flex-col bg-white rounded-2xl border border-border shadow-sm overflow-hidden shrink-0">
        {/* Cart header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <ShoppingCart className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">Carrito</h2>
          {cart.length > 0 && (
            <span className="bg-primary text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {cart.reduce((s, i) => s + i.quantity, 0)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {/* Suspended sales toggle */}
            {suspendedSales.length > 0 && (
              <button
                onClick={() => setShowSuspended(v => !v)}
                className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-all ${
                  showSuspended
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-amber-50 text-amber-600 border-amber-300 hover:bg-amber-100"
                }`}
                title="Ver ventas suspendidas"
              >
                <Clock className="w-3 h-3" />
                {suspendedSales.length}
              </button>
            )}
            {/* Suspend current cart */}
            {cart.length > 0 && (
              <button
                onClick={suspendSale}
                className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-all"
                title="Suspender venta"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                Pausar
              </button>
            )}
          </div>
        </div>

        {/* Selector de modo: Venta directa vs Registrar reserva */}
        {!activeReservationId && (
          <div className="flex p-1 bg-muted/60 rounded-xl mx-4 mt-3 border border-border/60">
            <button
              type="button"
              onClick={() => setCartMode("sale")}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                cartMode === "sale"
                  ? "bg-white text-primary shadow-xs border border-border/40"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Venta directa</span>
            </button>
            <button
              type="button"
              onClick={() => setCartMode("reserva")}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                cartMode === "reserva"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Registrar reserva</span>
            </button>
          </div>
        )}

        {Number.isSafeInteger(activeReservationId) && (activeReservationId ?? 0) > 0 && (
          <div className="border-b border-emerald-300 bg-emerald-50/80 p-4">
            {reservationLoading ? (
              <p className="text-sm text-muted-foreground">Cargando detalles de la reserva...</p>
            ) : reservationError ? (
              <p role="alert" className="text-sm text-destructive">
                {reservationError instanceof Error ? reservationError.message : "No se pudo cargar la reserva."}
              </p>
            ) : linkedReservation ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-bold text-foreground">Entrega · Reserva #{linkedReservation.id}</p>
                      <Badge className="bg-emerald-600 text-white text-[10px]">Listo</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{linkedReservation.customerName || "Sin cliente"}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setActiveReservationId(null);
                      if (window.location.search.includes("reserva")) {
                        window.history.replaceState({}, "", "/pos");
                      }
                    }}
                    title="Cerrar entrega de reserva"
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Cancelar
                  </Button>
                </div>
                <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg border bg-white p-2.5">
                  {linkedReservation.details.map((detail) => (
                    <div key={detail.id} className="border-b pb-2 last:border-0 last:pb-0">
                      <p className="text-xs font-semibold">{detail.quantity} × {detail.productName}</p>
                      <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">{detail.specifications}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 text-xs">
                  <p className="flex justify-between"><span>Total del pedido</span><strong>{formatCurrency(linkedReservation.total, currencySymbol)}</strong></p>
                  <p className="flex justify-between"><span>Adelanto registrado</span><span>{formatCurrency(linkedReservation.deposit, currencySymbol)}</span></p>
                  {reservationDiscount > 0 && (
                    <p className="flex justify-between text-emerald-700 font-semibold">
                      <span>Descuento aplicado</span>
                      <span>-{formatCurrency(reservationDiscount, currencySymbol)}</span>
                    </p>
                  )}
                  <p className="flex justify-between border-t pt-1 font-bold">
                    <span>Saldo a cobrar</span>
                    <span className="text-emerald-700 font-bold">{formatCurrency(Math.max(0, linkedReservation.balance - reservationDiscount), currencySymbol)}</span>
                  </p>
                </div>

                {/* Descuento al saldo de la reserva */}
                {linkedReservation.balance > 0 && linkedReservation.status !== "entregada" && (
                  <div>
                    {reservationDiscount > 0 ? (
                      <div className="flex items-center justify-between bg-white border border-emerald-300 px-2.5 py-1.5 rounded-lg text-xs">
                        <span className="text-emerald-800 font-medium flex items-center gap-1">
                          <Tag className="w-3 h-3 text-emerald-600" />
                          Descuento: <b>-{formatCurrency(reservationDiscount, currencySymbol)}</b>
                        </span>
                        <button
                          type="button"
                          onClick={() => setReservationDiscount(0)}
                          className="text-destructive hover:underline text-[10px] font-bold"
                        >
                          Quitar
                        </button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleApplyReservationDiscount}
                        className="w-full text-xs h-7 border-dashed border-emerald-500/60 text-emerald-700 hover:bg-emerald-100/60"
                      >
                        <Tag className="w-3 h-3 mr-1" />
                        Aplicar descuento al saldo
                      </Button>
                    )}
                  </div>
                )}

               
              </div>
            ) : null}
          </div>
        )}

        {/* Suspended sales panel */}
        {showSuspended && suspendedSales.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Ventas en espera
            </p>
            {suspendedSales.map(s => (
              <div key={s.id} className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-amber-200 shadow-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.suspendedAt.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                    {s.customerId !== "none" ? " · con cliente" : ""}
                  </p>
                </div>
                <button
                  onClick={() => recoverSale(s.id)}
                  className="flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-lg transition-colors shrink-0"
                >
                  <PlayCircle className="w-3.5 h-3.5" /> Recuperar
                </button>
                <button
                  onClick={() => discardSuspended(s.id)}
                  className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive rounded-lg transition-colors shrink-0"
                  title="Descartar"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Cart items */}
        <ScrollArea className="flex-1 px-4 py-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">Carrito vacío</p>
              <p className="text-xs mt-1">Haz clic en un producto para agregar</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map(item => {
                const lineBase = item.quantity * item.unitPrice;
                const lineFinal = lineBase * (1 - item.discount / 100);
                return (
                <div key={item.productId} className={`p-2.5 rounded-xl border transition-all ${item.discount > 0 ? "bg-green-50 border-green-200" : "bg-muted/30 border-border/50"}`}>
                  <div className="flex items-center gap-2">
                    {/* Thumbnail */}
                    <div className="w-8 h-8 rounded-lg bg-muted overflow-hidden shrink-0">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-4 h-4 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold leading-tight line-clamp-1">{item.productName}</p>
                        {item.discount > 0 && (
                          <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-600 text-white">
                            -{Math.round(item.discount)}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {item.discount > 0 ? (
                          <>
                            <span className="text-[10px] text-muted-foreground line-through">{formatCurrency(item.unitPrice, currencySymbol)}</span>
                            <span className="text-[10px] font-semibold text-green-700">{formatCurrency(item.unitPrice * (1 - item.discount / 100), currencySymbol)} c/u</span>
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">{formatCurrency(item.unitPrice, currencySymbol)} c/u</span>
                        )}
                      </div>
                    </div>
                    {/* Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Discount button */}
                      <button
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors border ${item.discount > 0 ? "bg-green-600 border-green-600 text-white" : "border-border hover:bg-green-50 hover:border-green-400 hover:text-green-700 text-muted-foreground"}`}
                        onClick={() => applyDiscount(item.productId, item.productName, item.unitPrice)}
                        title="Aplicar descuento"
                      >
                        <Tag className="w-3 h-3" />
                      </button>
                      <button
                        className="w-6 h-6 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
                        onClick={() => updateQuantity(item.productId, -1)}
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-5 text-center text-xs font-bold">{item.quantity}</span>
                      <button
                        className="w-6 h-6 rounded-full border border-border flex items-center justify-center hover:bg-muted transition-colors"
                        onClick={() => updateQuantity(item.productId, 1)}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        className="w-6 h-6 ml-0.5 rounded-full flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={() => removeFromCart(item.productId)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {/* Reservation details per product */}
                  {cartMode === "reserva" && (
                    <div className="mt-2 pt-2 border-t border-amber-200/80 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-bold text-amber-950">
                        <span>Detalles del diseño / producto:</span>
                        <span className="text-[9px] text-muted-foreground font-normal">Talla, color, personalización</span>
                      </div>
                      <Input
                        value={item.specifications ?? ""}
                        onChange={(e) => updateItemSpecifications(item.productId, e.target.value)}
                        placeholder="Ej. Talla M, color azul marino, bordado logo pecho..."
                        className="h-7 text-xs bg-white rounded-lg border-amber-300 focus:border-amber-500"
                      />
                    </div>
                  )}

                  {/* Line total */}
                  <div className="flex justify-end mt-1.5">
                    <span className="text-[11px] font-bold text-foreground">{formatCurrency(lineFinal, currencySymbol)}</span>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Sale info + totals */}
        <div className="border-t border-border p-4 space-y-3">
          {/* Customer selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Cliente
              </label>
              {!selectedCustomer && (
                <button
                  type="button"
                  onClick={() => openRegisterCustomerModal(customerSearch)}
                  className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                >
                  <UserPlus className="w-3 h-3" /> Registrar cliente
                </button>
              )}
            </div>
            {selectedCustomer ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                    {selectedCustomer.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate text-foreground">{selectedCustomer.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                      {selectedCustomer.nitCi ? (
                        <span className="font-mono bg-primary/10 text-primary px-1.5 py-0.2 rounded font-semibold">
                          CI/NIT: {selectedCustomer.nitCi}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/70">Sin CI/NIT</span>
                      )}
                      {selectedCustomer.phone && <span>· Tel: {selectedCustomer.phone}</span>}
                    </div>
                    {isLoyaltyActive && loyaltyBalance ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <TierBadge tier={loyaltyBalance.tier} size="xs" />
                        <p className="text-[10px] text-amber-600 font-semibold flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5" /> {availableLoyaltyPoints.toLocaleString("es")} pts
                          {pointsToRedeem > 0 && (
                            <span className="text-[9px] text-emerald-700 font-medium ml-1">({pointsToRedeem.toLocaleString("es")} canjeados)</span>
                          )}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    title="Quitar cliente / Seleccionar otro"
                    className="text-muted-foreground hover:text-destructive p-1 rounded-lg hover:bg-destructive/10 transition-colors"
                    onClick={() => { setCustomerId("none"); setCustomerSearch(""); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>


                {/* Loyalty & Discount Panel — only if loyalty is enabled */}
                {isLoyaltyActive && (
                  loyaltyLoading ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-muted-foreground flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>Consultando puntos del cliente...</span>
                    </div>
                  ) : loyaltyBalance ? (
                    <div className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-50/90 via-amber-50/40 to-yellow-50/60 p-3 space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-700 shrink-0">
                          <Star className="w-3 h-3 fill-amber-500 text-amber-600" />
                        </div>
                        <span className="text-xs font-bold text-amber-950">Puntos y Descuento del Cliente</span>
                      </div>
                      <TierBadge tier={loyaltyBalance.tier} size="xs" />
                    </div>

                    {/* Available Points and Available Discount Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`rounded-lg p-2 border shadow-2xs text-center transition-all ${
                        pointsToRedeem > 0 && availableLoyaltyPoints === 0
                          ? "bg-amber-50/70 border-amber-300"
                          : "bg-white/95 border-amber-200/80"
                      }`}>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block">
                          Puntos Disponibles
                        </span>
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <Star className={`w-3.5 h-3.5 shrink-0 ${availableLoyaltyPoints > 0 ? "text-amber-500 fill-amber-400" : "text-slate-400"}`} />
                          <span className={`text-sm font-bold ${availableLoyaltyPoints > 0 ? "text-amber-800" : "text-slate-600"}`}>
                            {availableLoyaltyPoints.toLocaleString("es")}
                          </span>
                          <span className="text-[10px] text-amber-700 font-medium">pts</span>
                        </div>
                        {pointsToRedeem > 0 ? (
                          <span className="text-[9px] text-emerald-700 font-medium block mt-0.5">
                            (-{pointsToRedeem.toLocaleString("es")} canjeados)
                          </span>
                        ) : null}
                      </div>

                      <div className={`rounded-lg p-2 border shadow-2xs text-center transition-all ${
                        pointsToRedeem > 0 && availableLoyaltyDiscount === 0
                          ? "bg-emerald-50/70 border-emerald-300"
                          : "bg-white/95 border-emerald-200/80"
                      }`}>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block">
                          Desc. Disponible
                        </span>
                        <div className="flex items-center justify-center gap-1 mt-0.5">
                          <Gift className={`w-3.5 h-3.5 shrink-0 ${availableLoyaltyDiscount > 0 ? "text-emerald-600" : "text-slate-400"}`} />
                          <span className={`text-sm font-bold ${availableLoyaltyDiscount > 0 ? "text-emerald-700" : "text-slate-600"}`}>
                            {formatCurrency(availableLoyaltyDiscount, currencySymbol)}
                          </span>
                        </div>
                        {pointsToRedeem > 0 ? (
                          <span className="text-[9px] text-emerald-700 font-medium block mt-0.5">
                            (-{formatCurrency(loyaltyDiscount, currencySymbol)} canjeado)
                          </span>
                        ) : (
                          <span className="text-[9px] text-emerald-600 block mt-0.5">
                            Tasa: {formatCurrency(loyaltyBalance.redemptionRate, currencySymbol)} / pt
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Botón Principal: Canjear Descuento del Total a Pagar */}
                    {pointsToRedeem > 0 ? (
                      <div className="rounded-lg bg-emerald-100/90 border border-emerald-300 p-2 flex items-center justify-between gap-2 shadow-2xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-emerald-900 leading-tight">
                              Descuento canjeado: -{formatCurrency(loyaltyDiscount, currencySymbol)}
                            </p>
                            <p className="text-[10px] text-emerald-700">
                              Se descontaron {pointsToRedeem.toLocaleString("es")} puntos del total a pagar · Disponibles: {availableLoyaltyPoints.toLocaleString("es")} pts
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPointsToRedeem(0);
                            Toast.fire({ icon: "info", title: "Descuento cancelado", text: "Se restauró el total a pagar sin descuento." });
                          }}
                          className="px-2 py-1 rounded bg-white hover:bg-destructive/10 text-destructive text-[10px] font-bold border border-destructive/20 transition-colors shrink-0"
                        >
                          Quitar canje
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={loyaltyBalance.points <= 0 || cart.length === 0}
                        onClick={handleRedeemCustomerDiscount}
                        className="w-full h-9 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        {loyaltyBalance.points <= 0
                          ? "Sin puntos disponibles para canjear"
                          : cart.length === 0
                          ? `Canjear Descuento (${formatCurrency(loyaltyBalance.discountValue, currencySymbol)}) - Agrega productos`
                          : `Canjear Descuento (${formatCurrency(Math.min(loyaltyBalance.discountValue, subtotal), currencySymbol)}) del Total a Pagar`}
                      </button>
                    )}

                    {/* Quick partial redemption options */}
                    {loyaltyBalance.points > 0 && cart.length > 0 && (
                      <div className="pt-1 border-t border-amber-200/60 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-amber-900 font-medium">
                          <span>Opciones de canje parcial:</span>
                          {pointsToRedeem > 0 && (
                            <button
                              type="button"
                              onClick={() => setPointsToRedeem(0)}
                              className="text-amber-700 hover:underline"
                            >
                              Restablecer
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {[100, 200, 500].filter(v => v <= loyaltyBalance.points).map(pts => {
                            const disc = +(pts * loyaltyBalance.redemptionRate).toFixed(2);
                            const isSelected = pointsToRedeem === pts;
                            return (
                              <button
                                key={pts}
                                type="button"
                                onClick={() => setPointsToRedeem(isSelected ? 0 : pts)}
                                className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all flex-1 ${
                                  isSelected
                                    ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                                    : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100/70"
                                }`}
                              >
                                {pts} pts<br /><span className={`text-[9px] font-normal ${isSelected ? "text-white/90" : "text-amber-700"}`}>-{formatCurrency(disc, currencySymbol)}</span>
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => {
                              const rate = Number(loyaltyBalance.redemptionRate || 0.01);
                              const maxPointsNeeded = Math.ceil(subtotal / rate);
                              const ptsToUse = Math.min(loyaltyBalance.points, maxPointsNeeded);
                              setPointsToRedeem(pointsToRedeem === ptsToUse ? 0 : ptsToUse);
                            }}
                            className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all flex-1 ${
                              pointsToRedeem > 0 && pointsToRedeem === Math.min(loyaltyBalance.points, Math.ceil(subtotal / (Number(loyaltyBalance.redemptionRate) || 0.01)))
                                ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                                : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100/70"
                            }`}
                          >
                            Todo<br />
                            <span className="text-[9px] font-normal">
                              -{formatCurrency(Math.min(loyaltyBalance.discountValue, subtotal), currencySymbol)}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null)}

              </div>
            ) : (
              <div className="space-y-1.5 relative" ref={customerDropdownRef}>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setShowCustomerDropdown(true);
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      placeholder="Buscar cliente por CI/NIT, teléfono o nombre..."
                      className="pl-8 pr-7 h-9 text-xs rounded-xl"
                    />
                    {customerSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerSearch("");
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openRegisterCustomerModal(customerSearch)}
                    className="h-9 px-2.5 text-xs rounded-xl gap-1 shrink-0 border-primary/30 text-primary hover:bg-primary/10 font-medium"
                    title="Registrar nuevo cliente"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Nuevo</span>
                  </Button>
                </div>

                {/* Dropdown panel */}
                {showCustomerDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-popover text-popover-foreground rounded-xl border border-border shadow-2xl z-50 overflow-hidden divide-y divide-border">
                    {/* Matching ready reservations block if search term matches */}
                    {matchingReadyReservations.length > 0 && customerSearch.trim() && (
                      <div className="bg-emerald-50/95 border-b border-emerald-300 p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-extrabold text-emerald-950">
                          <span className="flex items-center gap-1.5">
                            <Package className="w-4 h-4 text-emerald-700" />
                            Reservas listas coincidentes ({matchingReadyReservations.length})
                          </span>
                        </div>
                        {matchingReadyReservations.slice(0, 3).map((res) => (
                          <div key={res.id} className="p-2 bg-white rounded-lg border border-emerald-300 flex items-center justify-between gap-2 shadow-2xs">
                            <div className="min-w-0 flex-1 text-xs">
                              <p className="font-bold text-foreground">Reserva #{res.id} · {res.customerName || "Sin cliente"}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {res.details?.map(d => `${d.quantity}× ${d.productName}`).join(", ") || "Pedido personalizado"}
                              </p>
                              <p className="text-[11px] text-emerald-800 font-extrabold mt-0.5">
                                Saldo a cobrar: {formatCurrency(res.balance, currencySymbol)}
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2.5 rounded-lg shrink-0 gap-1 shadow-xs"
                              onClick={() => {
                                setActiveReservationId(res.id);
                                if (res.customerId) setCustomerId(String(res.customerId));
                                setShowCustomerDropdown(false);
                                setCustomerSearch("");
                                Toast.fire({
                                  icon: "success",
                                  title: `Reserva #${res.id} cargada para cobrar y entregar`,
                                  text: `Cliente: ${res.customerName || "Sin cliente"} · Saldo: ${formatCurrency(res.balance, currencySymbol)}`
                                });
                              }}
                            >
                              Cobrar y Entregar
                              <ArrowRight className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="max-h-56 overflow-y-auto p-1 space-y-0.5">
                      {/* Option: Consumidor Final */}
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerId("none");
                          setShowCustomerDropdown(false);
                          setCustomerSearch("");
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between hover:bg-accent transition-colors ${
                          customerId === "none" ? "bg-accent/60 font-semibold" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground font-bold">
                            CF
                          </div>
                          <span>Consumidor Final</span>
                        </div>
                        {customerId === "none" && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                      </button>

                      {/* Filtered customer list */}
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map((c) => {
                          const custReady = (readyReservations || []).filter(r => r.customerId === c.id && r.status === "listo_entrega");
                          return (
                            <div
                              key={c.id}
                              onClick={() => {
                                setCustomerId(c.id.toString());
                                setShowCustomerDropdown(false);
                                setCustomerSearch("");
                              }}
                              className="w-full text-left px-2.5 py-2 rounded-lg text-xs hover:bg-accent transition-colors group flex items-start justify-between gap-2 cursor-pointer"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-semibold truncate text-foreground group-hover:text-primary">
                                    {c.name}
                                  </p>
                                  {custReady.length > 0 && (
                                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[10px] px-1.5 py-0.2 rounded-full inline-flex items-center gap-1 shadow-2xs">
                                      <Package className="w-2.5 h-2.5 text-emerald-700" />
                                      {custReady.length} reserva{custReady.length > 1 ? "s" : ""} lista{custReady.length > 1 ? "s" : ""}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                                  {c.nitCi ? (
                                    <span className="font-mono bg-muted px-1.5 py-0.2 rounded font-medium text-foreground">
                                      CI/NIT: {c.nitCi}
                                    </span>
                                  ) : (
                                    <span>Sin CI/NIT</span>
                                  )}
                                  {c.phone && <span>· Tel: {c.phone}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                                {custReady.length > 0 && (
                                  <button
                                    type="button"
                                    className="text-[10px] font-bold bg-emerald-700 hover:bg-emerald-800 text-white px-2 py-1 rounded-md shadow-2xs flex items-center gap-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveReservationId(custReady[0].id);
                                      setCustomerId(c.id.toString());
                                      setShowCustomerDropdown(false);
                                      setCustomerSearch("");
                                      Toast.fire({
                                        icon: "success",
                                        title: `Reserva #${custReady[0].id} cargada`,
                                        text: `${c.name} · Saldo: ${formatCurrency(custReady[0].balance, currencySymbol)}`
                                      });
                                    }}
                                  >
                                    <Package className="w-3 h-3" />
                                    Cobrar Reserva
                                  </button>
                                )}
                                <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 font-medium">
                                  Seleccionar
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-3 text-center space-y-2">
                          <p className="text-xs text-muted-foreground">
                            No se encontró cliente con CI/NIT o nombre: <strong className="text-foreground">"{customerSearch}"</strong>
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => openRegisterCustomerModal(customerSearch)}
                            className="w-full text-xs rounded-lg gap-1.5 h-8 font-semibold shadow-sm"
                          >
                            <UserPlus className="w-3.5 h-3.5" /> Registrar "{customerSearch}" como cliente
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Footer: always offer Registrar cliente if results exist */}
                    {filteredCustomers.length > 0 && (
                      <div className="p-1 bg-muted/20">
                        <button
                          type="button"
                          onClick={() => openRegisterCustomerModal(customerSearch)}
                          className="w-full py-1.5 px-2.5 text-xs text-primary font-semibold hover:bg-primary/10 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> + Registrar cliente nuevo
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reservation specific inputs (visible when cartMode === "reserva" and no active reservation is loaded) */}
          {cartMode === "reserva" && !linkedReservation && (
            <div className="space-y-2.5 p-3 rounded-2xl bg-amber-50/80 border border-amber-300">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-950 uppercase tracking-wide flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 text-amber-700" /> Datos de la Reserva
                </span>
                <Badge className="bg-amber-600 text-white text-[10px] font-semibold">Reserva / Encargo</Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-amber-900 block">Fecha de reserva</span>
                  <Input
                    type="date"
                    value={reservationDate}
                    onChange={(e) => setReservationDate(e.target.value)}
                    className="h-8 text-xs bg-white rounded-xl border-amber-300 shadow-2xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold text-amber-900 block">Fecha estimada entrega</span>
                  <Input
                    type="date"
                    value={expectedAt}
                    onChange={(e) => setExpectedAt(e.target.value)}
                    className="h-8 text-xs bg-white rounded-xl border-amber-300 shadow-2xs"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-bold text-amber-950">Adelanto / Anticipo</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isMixedDeposit;
                    setIsMixedDeposit(next);
                    if (next) {
                      const cur = Number(deposit) || 0;
                      if (cur > 0) {
                        setMixedDepositCash((cur / 2).toFixed(2));
                        setMixedDepositTransfer((cur / 2).toFixed(2));
                      }
                    } else {
                      const mTotal = (Number(mixedDepositCash) || 0) + (Number(mixedDepositTransfer) || 0);
                      setDeposit(String(mTotal > 0 ? mTotal : "0"));
                    }
                  }}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-all ${
                    isMixedDeposit
                      ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                      : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100"
                  }`}
                >
                  {isMixedDeposit ? "✓ Pago mixto (Efec. + Transf.)" : "+ Dividir (pago mixto)"}
                </button>
              </div>

              {!isMixedDeposit ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold text-amber-900 block">Adelanto ({currencySymbol})</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value)}
                      placeholder="0.00"
                      className="h-8 text-xs bg-white rounded-xl font-bold border-amber-300 shadow-2xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold text-amber-900 block">Método adelanto</span>
                    <Select value={depositMethod} onValueChange={setDepositMethod}>
                      <SelectTrigger className="h-8 text-xs bg-white rounded-xl border-amber-300 shadow-2xs">
                        <SelectValue placeholder="Método..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activePaymentMethods.map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ) : (
                <div className="space-y-2 p-2 rounded-xl bg-amber-100/70 border border-amber-300 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-semibold text-amber-900 block">Efectivo ({currencySymbol})</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={mixedDepositCash}
                        onChange={(e) => setMixedDepositCash(e.target.value)}
                        placeholder="0.00"
                        className="h-8 text-xs bg-white rounded-xl font-bold border-amber-300 shadow-2xs"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-semibold text-amber-900 block">Transferencia ({currencySymbol})</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={mixedDepositTransfer}
                        onChange={(e) => setMixedDepositTransfer(e.target.value)}
                        placeholder="0.00"
                        className="h-8 text-xs bg-white rounded-xl font-bold border-amber-300 shadow-2xs"
                      />
                    </label>
                  </div>
                  <div className="flex justify-between items-center text-[11px] font-bold text-amber-950 px-1 pt-0.5 border-t border-amber-200">
                    <span>Total adelanto mixto:</span>
                    <span className="text-emerald-800 font-extrabold text-xs">
                      {formatCurrency((Number(mixedDepositCash) || 0) + (Number(mixedDepositTransfer) || 0), currencySymbol)}
                    </span>
                  </div>
                </div>
              )}

              <label className="space-y-1 block text-xs">
                <span className="text-[10px] font-semibold text-amber-900 block">Notas de la reserva</span>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Indicaciones adicionales de confección o entrega..."
                  className="text-xs bg-white rounded-xl border-amber-300 resize-none shadow-2xs"
                />
              </label>
            </div>
          )}

          {/* Payment method & split payments (visible for direct sale or reservation delivery) */}
          {(cartMode === "sale" || linkedReservation) && (
            <div className="space-y-2 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" /> Método de Pago
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isCombinedPayment;
                    setIsCombinedPayment(next);
                    if (next) {
                      const first = activePaymentMethods[0] || "Efectivo";
                      setCombinedPayments({ [first]: String(targetPayableAmount) });
                    } else {
                      setCombinedPayments({});
                    }
                  }}
                  className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border transition-all ${
                    isCombinedPayment
                      ? "bg-primary text-white border-primary shadow-2xs"
                      : "bg-muted/70 text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {isCombinedPayment ? "Pago dividido activo" : "Dividir pago"}
                </button>
              </div>

              {!isCombinedPayment ? (
                <>
                  {/* Simple method selector */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {activePaymentMethods.map((m) => {
                      const isSelected = paymentMethod === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPaymentMethod(m)}
                          className={`py-1.5 px-2 rounded-xl text-xs font-semibold border transition-all text-center truncate ${
                            isSelected
                              ? "bg-primary text-white border-primary shadow-xs"
                              : "bg-white text-foreground border-border hover:border-primary/50"
                          }`}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>

                  {/* Cash received calculator when Efectivo */}
                  {isCash(paymentMethod) && targetPayableAmount > 0 && (
                    <div className="space-y-2 p-2.5 bg-primary/5 rounded-xl border border-primary/20">
                      <div className="flex items-center justify-between text-[11px] font-bold text-primary">
                        <span className="flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> Efectivo recibido</span>
                        <span className="text-[10px] font-normal text-muted-foreground">Mínimo: {formatCurrency(targetPayableAmount, currencySymbol)}</span>
                      </div>
                      <Input
                        type="number"
                        min={targetPayableAmount}
                        step="0.01"
                        value={linkedReservation ? reservationCashReceived : cashReceived}
                        onChange={(e) => {
                          if (linkedReservation) setReservationCashReceived(e.target.value);
                          else setCashReceived(e.target.value);
                        }}
                        placeholder={`Ej: ${targetPayableAmount}`}
                        className="h-8 text-xs bg-white rounded-lg font-bold"
                      />
                      {/* Presets */}
                      <div className="flex gap-1">
                    
                        {[10, 20, 50, 100].map((add) => {
                          const rounded = Math.ceil(targetPayableAmount / add) * add;
                          if (rounded <= targetPayableAmount && targetPayableAmount % add === 0) return null;
                          const val = rounded > targetPayableAmount ? rounded : targetPayableAmount + add;
                          return (
                            <button
                              key={add}
                              type="button"
                              onClick={() => {
                                if (linkedReservation) setReservationCashReceived(String(val));
                                else setCashReceived(String(val));
                              }}
                              className="flex-1 py-1 text-[10px] font-bold rounded-md bg-white border border-border hover:bg-muted text-muted-foreground"
                            >
                              {val}
                            </button>
                          );
                        })}
                      </div>
                      {/* Calculated change */}
                      {(() => {
                        const currentInput = linkedReservation ? reservationCashReceived : cashReceived;
                        const val = parseFloat(currentInput) || 0;
                        if (val > targetPayableAmount) {
                          return (
                            <div className="flex justify-between items-center text-xs font-bold text-emerald-800 bg-emerald-100/70 p-1.5 rounded-lg border border-emerald-300">
                              <span>Cambio a devolver:</span>
                              <span className="text-sm">{formatCurrency(val - targetPayableAmount, currencySymbol)}</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </>
              ) : (
                /* Split payments inputs */
                <div className="space-y-2 p-2.5 bg-muted/40 rounded-xl border border-border">
                  <p className="text-[10px] text-muted-foreground">
                    Ingresa el monto que se pagará con cada método:
                  </p>
                  <div className="space-y-1.5">
                    {activePaymentMethods.map((method) => {
                      const currentAmount = combinedPayments[method] || "";
                      return (
                        <div key={method} className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold w-24 truncate">{method}:</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={currentAmount}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCombinedPayments(prev => ({ ...prev, [method]: val }));
                            }}
                            placeholder="0.00"
                            className="h-8 text-xs bg-white rounded-lg flex-1 font-semibold"
                          />
                          <button
                            type="button"
                            title="Asignar el saldo restante a este método"
                            onClick={() => {
                              const otherTotal = activePaymentMethods
                                .filter(m => m !== method)
                                .reduce((sum, m) => sum + (Number(combinedPayments[m]) || 0), 0);
                              const remainder = Math.max(0, +(targetPayableAmount - otherTotal).toFixed(2));
                              setCombinedPayments(prev => ({ ...prev, [method]: String(remainder) }));
                            }}
                            className="px-2 py-1 text-[10px] font-bold rounded-lg border bg-white hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
                          >
                            Resto
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Allocation balance summary */}
                  <div className="pt-1.5 border-t border-border/60 flex items-center justify-between text-xs font-semibold">
                    <span>Asignado: {formatCurrency(allocatedPaymentTotal, currencySymbol)} / {formatCurrency(targetPayableAmount, currencySymbol)}</span>
                    {Math.abs(allocatedPaymentTotal - targetPayableAmount) <= 0.05 ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Completo
                      </span>
                    ) : allocatedPaymentTotal < targetPayableAmount ? (
                      <span className="text-amber-700 font-bold">
                        Faltan {formatCurrency(targetPayableAmount - allocatedPaymentTotal, currencySymbol)}
                      </span>
                    ) : (
                      <span className="text-destructive font-bold">
                        Excede {formatCurrency(allocatedPaymentTotal - targetPayableAmount, currencySymbol)}
                      </span>
                    )}
                  </div>

                  {/* If cash is part of split payment, show cash change calculator */}
                  
                </div>
              )}
            </div>
          )}

          {/* Totals */}
          {linkedReservation ? (
            <div className="space-y-1.5 pt-1 border-t border-border/60">
              
              <div className="flex justify-between items-center pt-1.5 border-t border-border/60">
              </div>
            </div>
          ) : cartMode === "reserva" ? (
            <div className="space-y-1.5 pt-1 border-t border-border/60">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total de la reserva</span>
                <span className="font-medium text-foreground">{formatCurrency(subtotal, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-800 font-medium">
                <span>Adelanto a registrar hoy</span>
                <span className="font-bold">{formatCurrency(Number(deposit) || 0, currencySymbol)}</span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-border/60">
                <span className="font-bold text-sm text-amber-950">SALDO PENDIENTE AL ENTREGAR</span>
                <span className="font-extrabold text-xl text-amber-700">{formatCurrency(Math.max(0, subtotal - (Number(deposit) || 0)), currencySymbol)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal bruto</span>
                <span className="font-medium text-foreground">{formatCurrency(subtotal + totalDiscount, currencySymbol)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-xs text-green-700 font-medium">
                  <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> Descuentos por producto</span>
                  <span className="font-semibold">-{formatCurrency(totalDiscount, currencySymbol)}</span>
                </div>
              )}
              {generalDiscountAmount > 0 && (
                <div className="flex justify-between text-xs text-emerald-700 font-medium bg-emerald-50/60 px-2 py-0.5 rounded-md border border-emerald-200">
                  <span className="flex items-center gap-1 font-semibold">
                    <Percent className="w-3 h-3" />
                    Desc. a la venta ({generalDiscount?.type === "pct" ? `${generalDiscount.value}%` : "Fijo"})
                  </span>
                  <span className="font-bold">-{formatCurrency(generalDiscountAmount, currencySymbol)}</span>
                </div>
              )}
              {couponDiscount > 0 && validatedCoupon && (
                <div className="flex justify-between text-xs text-violet-700">
                  <span className="flex items-center gap-1"><Ticket className="w-3 h-3" /> Cupón {validatedCoupon.code} (-{validatedCoupon.discountPercent}%)</span>
                  <span className="font-semibold">-{formatCurrency(couponDiscount, currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal neto</span>
                <span className="font-medium text-foreground">{formatCurrency(subtotal - generalDiscountAmount - couponDiscount, currencySymbol)}</span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-border/60">
                <span className="font-bold text-sm">TOTAL A PAGAR</span>
                <span className="font-extrabold text-xl text-primary">{formatCurrency(total, currencySymbol)}</span>
              </div>
            </div>
          )}

          {/* Un solo botón principal para Cobrar y Entregar / Guardar Reserva */}
          {linkedReservation ? (
            <button
              onClick={() => void processReservationDelivery()}
              disabled={
                reservationLoading ||
                !cashRegister ||
                cashRegister.status !== "open" ||
                (isCombinedPayment && !isSplitPaymentValid) ||
                (!isCombinedPayment && isCash(paymentMethod) && reservationCashReceived !== "" && parseFloat(reservationCashReceived) < targetPayableAmount)
              }
              className="w-full h-12 bg-emerald-700 text-white font-bold text-sm rounded-full hover:bg-emerald-800 active:scale-[0.98] transition-all shadow-md shadow-emerald-700/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {reservationLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Procesando entrega...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Cobrar y Entregar {formatCurrency(targetPayableAmount, currencySymbol)}
                </>
              )}
            </button>
          ) : cartMode === "reserva" ? (
            <button
              onClick={processCreateReservation}
              disabled={cart.length === 0 || isSavingReservation}
              className="w-full h-12 bg-amber-600 text-white font-bold text-sm rounded-full hover:bg-amber-700 active:scale-[0.98] transition-all shadow-md shadow-amber-600/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSavingReservation ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Guardando reserva...
                </>
              ) : (
                <>
                  <CalendarDays className="w-4 h-4" />
                  Guardar Reserva {Number(deposit) > 0 ? `(Adelanto: ${formatCurrency(Number(deposit), currencySymbol)})` : ""}
                </>
              )}
            </button>
          ) : (
            <button
              onClick={processSale}
              disabled={
                cart.length === 0 ||
                createSale.isPending ||
                cashRegisterLoading ||
                !cashRegister ||
                cashRegister.status !== "open" ||
                (isCombinedPayment && !isSplitPaymentValid) ||
                (!isCombinedPayment && isCash(paymentMethod) && cashReceived !== "" && parseFloat(cashReceived) < total)
              }
              className="w-full h-12 bg-primary text-white font-bold text-sm rounded-full hover:bg-primary/90 active:scale-[0.98] transition-all shadow-md shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {createSale.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Procesando venta...
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4" />
                  Cobrar y Entregar {cart.length > 0 ? formatCurrency(total, currencySymbol) : ""}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Boleta Modal — appears after successful sale */}
      <BoletaModal
        sale={completedSale}
        onClose={() => setCompletedSale(null)}
      />

      {/* Modal Registrar Nuevo Cliente */}
      <Dialog open={registerCustomerOpen} onOpenChange={setRegisterCustomerOpen}>
        <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden border-0 shadow-2xl">
          <div className="bg-primary px-6 pt-6 pb-4 text-primary-foreground">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                <UserPlus className="w-5 h-5 text-white" />
                Registrar Nuevo Cliente
              </DialogTitle>
              <DialogDescription className="text-white/80 text-xs">
                Ingresa los datos del cliente para registrarlo y seleccionarlo automáticamente en la venta actual.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleRegisterCustomer} className="p-6 space-y-4 bg-background">
            
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Teléfono / Celular
              </label>
              <Input
                value={newClientPhone}
                onChange={(e) => setNewClientPhone(e.target.value)}
                placeholder="Ej. 70123456"
                className="h-9 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Apellido(s) <span className="text-destructive">*</span>
                </label>
                <Input
                  value={newClientApellidos}
                  onChange={(e) => setNewClientApellidos(e.target.value)}
                  placeholder="Ej. Pérez Flores"
                  className="h-9 text-xs rounded-xl"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Nombre(s) <span className="text-destructive">*</span>
                </label>
                <Input
                  value={newClientNombres}
                  onChange={(e) => setNewClientNombres(e.target.value)}
                  placeholder="Ej. Juan Carlos"
                  className="h-9 text-xs rounded-xl"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                CI o NIT <span className="text-primary text-[11px] font-normal">(Identificación tributaria o cédula)</span>
              </label>
              <Input
                value={newClientCiNit}
                onChange={(e) => setNewClientCiNit(e.target.value)}
                placeholder="Ej. 8492019"
                className="h-9 text-xs rounded-xl"
                autoFocus
              />
            </div>

            

            <DialogFooter className="pt-2 flex gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRegisterCustomerOpen(false)}
                className="rounded-full text-xs h-9 px-4"
                disabled={isRegisteringCustomer}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isRegisteringCustomer}
                className="rounded-full text-xs h-9 px-5 gap-1.5 font-semibold"
              >
                {isRegisteringCustomer ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Registrando...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    Registrar y Seleccionar
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Reservas Listas para Entregar */}
      <Dialog open={showReadyReservationsModal} onOpenChange={setShowReadyReservationsModal}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden border-0 shadow-2xl">
          <div className="bg-gradient-to-r from-emerald-700 to-teal-800 px-6 py-4 text-white flex items-center justify-between">
            <div className="space-y-0.5">
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-white">
                <Package className="w-5 h-5 text-white" />
                Reservas Listas para Entrega
              </DialogTitle>
              <DialogDescription className="text-emerald-100 text-xs">
                Pedidos personalizados y prendas reservadas listas para cobrar el saldo y entregar al cliente.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-white/20 text-white font-extrabold text-xs px-2.5 py-1 rounded-full border border-white/30">
                {readyReservations?.length || 0} disponibles
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => refetchReadyReservations()}
                className="h-8 w-8 p-0 text-white hover:bg-white/20 rounded-full"
                title="Actualizar lista"
              >
                <Zap className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="p-4 border-b bg-muted/20">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={reservationSearchQuery}
                onChange={(e) => setReservationSearchQuery(e.target.value)}
                placeholder="Buscar por cliente, teléfono, # de reserva, notas o prenda..."
                className="pl-9 pr-8 h-10 text-xs rounded-xl bg-white"
                autoFocus
              />
              {reservationSearchQuery && (
                <button
                  type="button"
                  onClick={() => setReservationSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 p-4 max-h-[55vh] overflow-y-auto">
            {filteredReadyReservations.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredReadyReservations.map((res) => (
                  <div
                    key={res.id}
                    className="p-3.5 rounded-2xl border border-emerald-200/80 bg-white hover:border-emerald-400 hover:shadow-md transition-all flex flex-col justify-between gap-3 shadow-2xs"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm text-foreground">
                              Reserva #{res.id}
                            </span>
                            <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0 font-bold">
                              Listo para entrega
                            </Badge>
                          </div>
                          <p className="text-xs font-semibold text-emerald-950 mt-0.5 flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            {res.customerName || "Cliente sin registrar"}
                          </p>
                        </div>
                      </div>

                      {/* Items details */}
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-2 space-y-1 max-h-24 overflow-y-auto">
                        {res.details && res.details.length > 0 ? (
                          res.details.map((item) => (
                            <div key={item.id} className="text-[11px] leading-tight">
                              <span className="font-bold text-foreground">{item.quantity}× {item.productName}</span>
                              {item.specifications && (
                                <span className="text-muted-foreground block text-[10px] truncate">
                                  {item.specifications}
                                </span>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="text-[10px] text-muted-foreground">Prenda / Pedido personalizado</p>
                        )}
                      </div>

                      {/* Financial info */}
                      <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-xs">
                        <div className="text-muted-foreground text-[11px]">
                          <span>Total: <strong>{formatCurrency(res.total, currencySymbol)}</strong></span>
                          <span className="mx-1">·</span>
                          <span>Adelanto: {formatCurrency(res.deposit, currencySymbol)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-emerald-700 uppercase tracking-wide block font-semibold">
                            Saldo a cobrar
                          </span>
                          <span className="text-sm font-extrabold text-emerald-800">
                            {formatCurrency(res.balance, currencySymbol)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      className="w-full h-9 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl gap-1.5 shadow-sm active:scale-[0.98] transition-all"
                      onClick={() => {
                        setActiveReservationId(res.id);
                        if (res.customerId) setCustomerId(String(res.customerId));
                        setShowReadyReservationsModal(false);
                        Toast.fire({
                          icon: "success",
                          title: `Reserva #${res.id} cargada`,
                          text: `Cliente: ${res.customerName || "Sin cliente"} · Saldo a cobrar: ${formatCurrency(res.balance, currencySymbol)}`
                        });
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Cobrar y Entregar al Cliente
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    {reservationSearchQuery ? "No se encontraron reservas con esa búsqueda" : "No hay reservas listas para entrega"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {reservationSearchQuery
                      ? "Intenta buscando por otro nombre, teléfono o número de reserva."
                      : "Cuando una reserva pase a estado 'Listo para entrega', aparecerá aquí automáticamente."}
                  </p>
                </div>
                {reservationSearchQuery && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReservationSearchQuery("")}
                    className="text-xs rounded-xl"
                  >
                    Limpiar búsqueda
                  </Button>
                )}
              </div>
            )}
          </ScrollArea>

          <DialogFooter className="p-3 border-t bg-muted/10 sm:justify-between flex items-center">
            <span className="text-xs text-muted-foreground">
              Mostrando {filteredReadyReservations.length} de {readyReservations?.length || 0} reserva(s) lista(s)
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowReadyReservationsModal(false)}
              className="rounded-xl text-xs h-8 px-4"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
