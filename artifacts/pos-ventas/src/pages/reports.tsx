import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetReportSalesByUser, useGetReportByCategory, useGetReportStockAlerts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, subDays, startOfMonth } from "date-fns";
import * as XLSX from "xlsx";
import {
  Download,
  AlertTriangle,
  Calendar,
  User,
  Package,
  DollarSign,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  FileText,
  BookmarkCheck,
  CreditCard,
  Coins,
  CheckCircle2,
  Clock,
  Wallet,
} from "lucide-react";
import { useCurrency, formatCurrency } from "@/contexts/currency-context";
import { getToken } from "@/lib/auth";
import { exportTablePDF } from "@/lib/export-table-pdf";

interface ProductSaleItem {
  productId: number | null;
  productName: string;
  quantity: number;
  subtotal: number;
}

interface DepositDailyItem {
  reservationId: number;
  customerName: string;
  deposit: number;
  balance?: number;
  total: number;
  depositMethod: string;
  status: string;
  date: string;
}

interface DailySellerSale {
  date: string;
  userId: number;
  userName: string;
  userRole: string;
  salesCount: number;
  totalAmount: number;
  depositsCount?: number;
  depositsAmount?: number;
  balancesAmount?: number;
  grandTotal?: number;
  products: ProductSaleItem[];
  deposits?: DepositDailyItem[];
}

interface SellerInfo {
  id: number;
  name: string;
  role: string;
}

interface DailyReportResponse {
  daily: DailySellerSale[];
  summary: {
    totalRevenue: number;
    totalSales: number;
    totalDepositsAmount?: number;
    totalDepositsCount?: number;
    totalBalancesAmount?: number;
    grandTotalCollected?: number;
    totalProducts: number;
    activeSellersCount: number;
  };
  sellers: SellerInfo[];
}

interface ReservationDepositItem {
  id: number;
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  userId: number | null;
  userName: string;
  userRole: string;
  status: string;
  total: number;
  deposit: number;
  balance: number;
  depositMethod: string | null;
  reservationDate: string | null;
  expectedAt: string | null;
  notes: string | null;
  saleId: number | null;
  createdAt: string;
  payments: Array<{ paymentMethod: string; amount: number }>;
  products: Array<{
    id: number;
    productId: number | null;
    productName: string;
    specifications?: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

interface ReservationDepositsResponse {
  deposits: ReservationDepositItem[];
  summary: {
    totalDepositsAmount: number;
    totalReservationsCount: number;
    totalReservationsTotal: number;
    totalRemainingBalance: number;
    averageDeposit: number;
    byPaymentMethod: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

export default function Reports() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const monthStartStr = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(monthStartStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [selectedSeller, setSelectedSeller] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [subView, setSubView] = useState<"daily" | "chart" | "totals">("daily");

  // State for deposits tab
  const [depositsStatusFilter, setDepositsStatusFilter] = useState("all");
  const [depositsSearchTerm, setDepositsSearchTerm] = useState("");
  const [expandedDepositRows, setExpandedDepositRows] = useState<Record<number, boolean>>({});

  const { currencySymbol } = useCurrency();

  // Fetch report daily sales per seller with products and reservation deposits
  const {
    data: dailyData,
    isLoading: isLoadingDaily,
    refetch: refetchDaily,
    isFetching: isFetchingDaily,
  } = useQuery<DailyReportResponse>({
    queryKey: ["report-sales-by-seller-daily", dateFrom, dateTo, selectedSeller],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedSeller && selectedSeller !== "all") params.append("userId", selectedSeller);

      const token = getToken();
      const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/$/, "");
      const res = await fetch(`${apiUrl}/reports/sales-by-seller-daily?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Error al obtener el reporte de ventas");
      return res.json();
    },
  });

  // Fetch report reservation deposits
  const {
    data: depositsData,
    isLoading: isLoadingDeposits,
    refetch: refetchDeposits,
    isFetching: isFetchingDeposits,
  } = useQuery<ReservationDepositsResponse>({
    queryKey: ["report-reservation-deposits", dateFrom, dateTo, selectedSeller, depositsStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedSeller && selectedSeller !== "all") params.append("userId", selectedSeller);
      if (depositsStatusFilter && depositsStatusFilter !== "all") params.append("status", depositsStatusFilter);

      const token = getToken();
      const apiUrl = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/$/, "");
      const res = await fetch(`${apiUrl}/reports/reservation-deposits?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Error al obtener adelantos de reservas");
      return res.json();
    },
  });

  // Queries for standard reports
  const { data: salesByUser } = useGetReportSalesByUser({ dateFrom, dateTo });
  const { data: byCategory } = useGetReportByCategory({ dateFrom, dateTo });
  const { data: stockAlerts } = useGetReportStockAlerts();

  // Quick date filter presets
  const applyPreset = (preset: "today" | "yesterday" | "last7" | "month") => {
    const today = new Date();
    if (preset === "today") {
      const d = format(today, "yyyy-MM-dd");
      setDateFrom(d);
      setDateTo(d);
    } else if (preset === "yesterday") {
      const y = format(subDays(today, 1), "yyyy-MM-dd");
      setDateFrom(y);
      setDateTo(y);
    } else if (preset === "last7") {
      setDateFrom(format(subDays(today, 7), "yyyy-MM-dd"));
      setDateTo(format(today, "yyyy-MM-dd"));
    } else if (preset === "month") {
      setDateFrom(format(startOfMonth(today), "yyyy-MM-dd"));
      setDateTo(format(today, "yyyy-MM-dd"));
    }
  };

  // Toggle row expansion in daily view
  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleExpandAll = () => {
    if (!dailyData?.daily) return;
    const allExpanded = dailyData.daily.every((d) => expandedRows[`${d.date}_${d.userId}`]);
    const newState: Record<string, boolean> = {};
    if (!allExpanded) {
      dailyData.daily.forEach((d) => {
        newState[`${d.date}_${d.userId}`] = true;
      });
    }
    setExpandedRows(newState);
  };

  // Toggle deposit row expansion
  const toggleDepositRow = (id: number) => {
    setExpandedDepositRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpandAllDeposits = () => {
    if (!depositsData?.deposits) return;
    const allExpanded = depositsData.deposits.every((d) => expandedDepositRows[d.id]);
    const newState: Record<number, boolean> = {};
    if (!allExpanded) {
      depositsData.deposits.forEach((d) => {
        newState[d.id] = true;
      });
    }
    setExpandedDepositRows(newState);
  };

  // Filter daily records by search term
  const filteredDaily = useMemo(() => {
    if (!dailyData?.daily) return [];
    if (!searchTerm.trim()) return dailyData.daily;

    const term = searchTerm.toLowerCase();
    return dailyData.daily.filter((item) => {
      const matchSeller = item.userName.toLowerCase().includes(term);
      const matchDate = item.date.includes(term);
      const matchProduct = item.products.some((p) => p.productName.toLowerCase().includes(term));
      const matchDeposit = item.deposits?.some((d) => d.customerName.toLowerCase().includes(term));
      return matchSeller || matchDate || matchProduct || matchDeposit;
    });
  }, [dailyData?.daily, searchTerm]);

  // Filter deposits records by search term
  const filteredDeposits = useMemo(() => {
    if (!depositsData?.deposits) return [];
    if (!depositsSearchTerm.trim()) return depositsData.deposits;

    const term = depositsSearchTerm.toLowerCase();
    return depositsData.deposits.filter((d) => {
      const matchId = `r-${d.id}`.includes(term) || String(d.id).includes(term);
      const matchCustomer = d.customerName.toLowerCase().includes(term);
      const matchPhone = (d.customerPhone || "").includes(term);
      const matchSeller = d.userName.toLowerCase().includes(term);
      const matchMethod = (d.depositMethod || "").toLowerCase().includes(term) ||
        d.payments.some((p) => p.paymentMethod.toLowerCase().includes(term));
      const matchNotes = (d.notes || "").toLowerCase().includes(term);
      const matchProduct = d.products.some((p) => p.productName.toLowerCase().includes(term));
      return matchId || matchCustomer || matchPhone || matchSeller || matchMethod || matchNotes || matchProduct;
    });
  }, [depositsData?.deposits, depositsSearchTerm]);

  // Aggregated data for daily chart (Grand Total Collected = Deposits + Balances = Total Reservas)
  const chartDailyData = useMemo(() => {
    if (!filteredDaily.length) return [];
    const dateMap = new Map<
      string,
      {
        date: string;
        displayDate: string;
        totalRevenue: number;
        depositsAmount: number;
        balancesAmount: number;
        grandTotal: number;
        salesCount: number;
        depositsCount: number;
      }
    >();

    for (const item of filteredDaily) {
      const grandTotal =
        item.grandTotal ??
        ((item.depositsAmount ?? 0) + (item.balancesAmount ?? 0));
      const existing = dateMap.get(item.date);
      if (existing) {
        existing.totalRevenue += item.totalAmount;
        existing.depositsAmount += item.depositsAmount ?? 0;
        existing.balancesAmount += item.balancesAmount ?? 0;
        existing.grandTotal += grandTotal;
        existing.salesCount += item.salesCount;
        existing.depositsCount += item.depositsCount ?? 0;
      } else {
        const parts = item.date.split("-");
        const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : item.date;
        dateMap.set(item.date, {
          date: item.date,
          displayDate,
          totalRevenue: item.totalAmount,
          depositsAmount: item.depositsAmount ?? 0,
          balancesAmount: item.balancesAmount ?? 0,
          grandTotal,
          salesCount: item.salesCount,
          depositsCount: item.depositsCount ?? 0,
        });
      }
    }
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredDaily]);

  const formatDateDisplay = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    const parts = dateStr.slice(0, 10).split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "reserva":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300">
            Reserva
          </Badge>
        );
      case "produccion":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300">
            En Producción
          </Badge>
        );
      case "listo_entrega":
        return (
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300">
            Listo p/ Entrega
          </Badge>
        );
      case "entregada":
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300">
            Entregada
          </Badge>
        );
      case "cancelada":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300">
            Cancelada
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // Export comprehensive Excel report (Sales + Deposits + Balances)
  const exportDailyToExcel = () => {
    if (!dailyData?.daily?.length) return;

    // Sheet 1: Ventas y Adelantos por Vendedor y Día
    const sheet1Data = filteredDaily.map((d) => {
      const parts = d.date.split("-");
      const dateFormatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d.date;
      const productsSummary = d.products.map((p) => `${p.productName} (${p.quantity})`).join(", ");
      const grandTotal =
        d.grandTotal ?? ((d.depositsAmount ?? 0) + (d.balancesAmount ?? 0));

      return {
        Fecha: dateFormatted,
        "ID Vendedor": d.userId || "N/A",
        Vendedor: d.userName,
        Rol: d.userRole,
        "N° Ventas Directas": d.salesCount,
        "Total Ventas Directas": d.totalAmount,
        "N° Adelantos Reservas": d.depositsCount ?? 0,
        "Total Adelantos": d.depositsAmount ?? 0,
        "Total Saldo a Cobrar": d.balancesAmount ?? 0,
        "Total Recaudado": grandTotal,
        "Productos Vendidos": productsSummary,
        "Cant. Productos": d.products.reduce((acc, p) => acc + p.quantity, 0),
      };
    });

    // Sheet 2: Detalle de Productos Vendidos
    const sheet2Data: any[] = [];
    filteredDaily.forEach((d) => {
      const parts = d.date.split("-");
      const dateFormatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d.date;
      d.products.forEach((p) => {
        sheet2Data.push({
          Fecha: dateFormatted,
          Vendedor: d.userName,
          "Código/ID Producto": p.productId || "N/A",
          Producto: p.productName,
          "Cantidad Vendida": p.quantity,
          "Monto Recaudado": p.subtotal,
        });
      });
    });

    // Sheet 3: Detalle de Adelantos de Reservas
    const sheet3Data: any[] = [];
    filteredDaily.forEach((d) => {
      const parts = d.date.split("-");
      const dateFormatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d.date;
      d.deposits?.forEach((dep) => {
        sheet3Data.push({
          Fecha: dateFormatted,
          Vendedor: d.userName,
          "N° Reserva": `#R-${String(dep.reservationId).padStart(6, "0")}`,
          Cliente: dep.customerName,
          "Monto Adelanto": dep.deposit,
          "Saldo a Cobrar": dep.balance ?? Math.max(0, dep.total - dep.deposit),
          "Total Reserva": dep.total,
          "Método de Pago": dep.depositMethod,
          Estado: dep.status,
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(sheet1Data);
    const ws2 = XLSX.utils.json_to_sheet(sheet2Data);
    XLSX.utils.book_append_sheet(wb, ws1, "Ventas_y_Adelantos");
    XLSX.utils.book_append_sheet(wb, ws2, "Productos_Detalle");

    if (sheet3Data.length > 0) {
      const ws3 = XLSX.utils.json_to_sheet(sheet3Data);
      XLSX.utils.book_append_sheet(wb, ws3, "Adelantos_Reservas");
    }

    XLSX.writeFile(wb, `Reporte_Ventas_y_Adelantos_${dateFrom}_al_${dateTo}.xlsx`);
  };

  const exportDailyToPDF = () => {
    if (!filteredDaily.length) return;
    exportTablePDF({
      title: "Reporte de Ventas y Adelantos por Vendedor",
      fileName: `Reporte_Ventas_y_Adelantos_${dateFrom}_al_${dateTo}.pdf`,
      subtitle: `Período: ${dateFrom} al ${dateTo} · Filas: ${filteredDaily.length}`,
      headers: ["Fecha", "Vendedor", "Ventas Directas", "Adelantos", "Saldo a Cobrar", "Total Recaudado"],
      rows: filteredDaily.map((item) => [
        item.date,
        item.userName,
        `${item.salesCount} (${formatCurrency(item.totalAmount, currencySymbol)})`,
        `${item.depositsCount ?? 0} (${formatCurrency(item.depositsAmount ?? 0, currencySymbol)})`,
        formatCurrency(item.balancesAmount ?? 0, currencySymbol),
        formatCurrency(
          item.grandTotal ?? ((item.depositsAmount ?? 0) + (item.balancesAmount ?? 0)),
          currencySymbol
        ),
      ]),
    });
  };

  // Export Adelantos to Excel
  const exportDepositsToExcel = () => {
    if (!filteredDeposits?.length) return;

    const data = filteredDeposits.map((d) => {
      const dateFormatted = formatDateDisplay(d.reservationDate || d.createdAt);
      const paymentMethods = d.payments.map((p) => `${p.paymentMethod} (${p.amount})`).join(", ");
      const productsStr = d.products.map((p) => `${p.productName} (x${p.quantity})`).join("; ");

      return {
        "N° Reserva": `#R-${String(d.id).padStart(6, "0")}`,
        Fecha: dateFormatted,
        Cliente: d.customerName,
        Teléfono: d.customerPhone || "N/A",
        Vendedor: d.userName,
        Rol: d.userRole,
        "Monto Adelanto": d.deposit,
        "Total Reserva": d.total,
        "Saldo Pendiente": d.balance,
        "Métodos de Pago": paymentMethods,
        Estado: d.status,
        Productos: productsStr,
        Notas: d.notes || "",
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Adelantos_Reservas");
    XLSX.writeFile(wb, `Reporte_Adelantos_Reservas_${dateFrom}_al_${dateTo}.xlsx`);
  };

  // Export Adelantos to PDF
  const exportDepositsToPDF = () => {
    if (!filteredDeposits?.length) return;
    exportTablePDF({
      title: "Reporte de Adelantos Recibidos en Reservas",
      fileName: `Adelantos_Reservas_${dateFrom}_al_${dateTo}.pdf`,
      subtitle: `Período: ${dateFrom} al ${dateTo} · Total de registros: ${filteredDeposits.length}`,
      headers: ["Fecha", "N° Reserva", "Cliente", "Vendedor", "Método", "Adelanto", "Total", "Saldo", "Estado"],
      rows: filteredDeposits.map((item) => [
        formatDateDisplay(item.reservationDate || item.createdAt),
        `#R-${String(item.id).padStart(6, "0")}`,
        item.customerName,
        item.userName,
        item.payments.map((p) => p.paymentMethod).join(", ") || item.depositMethod || "Efectivo",
        formatCurrency(item.deposit, currencySymbol),
        formatCurrency(item.total, currencySymbol),
        formatCurrency(item.balance, currencySymbol),
        item.status,
      ]),
    });
  };

  const exportCategoryPDF = () => {
    exportTablePDF({
      title: "Ventas por Categoría",
      fileName: `Ventas_por_Categoria_${dateFrom}_al_${dateTo}.pdf`,
      subtitle: `Período: ${dateFrom} al ${dateTo}`,
      headers: ["Categoría", "Unidades vendidas", "Ingresos"],
      rows: (byCategory ?? []).map((item) => [
        item.categoryName || "Sin Categoría",
        item.totalSold,
        formatCurrency(item.totalRevenue ?? 0, currencySymbol),
      ]),
    });
  };

  const exportStockPDF = () => {
    exportTablePDF({
      title: "Alertas de Stock",
      fileName: `Alertas_Stock_${new Date().toISOString().slice(0, 10)}.pdf`,
      headers: ["Producto", "Categoría", "Stock actual", "Stock mínimo", "Estado"],
      rows: (stockAlerts ?? []).map((item) => [
        item.name,
        item.categoryName || "Sin categoría",
        item.stock,
        item.minStock,
        item.status,
      ]),
    });
  };

  const chartColors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6", "#ef4444", "#f97316"];

  const grandTotalCollected =
    dailyData?.summary?.grandTotalCollected ??
    (dailyData?.summary?.totalDepositsAmount ?? 0) +
      (dailyData?.summary?.totalBalancesAmount ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Reportes Financieros y Ventas</h2>
          <p className="text-sm text-muted-foreground">
            Control de ventas directas, adelantos recibidos en reservas, despachos y estados de inventario
          </p>
        </div>
      </div>

      <Tabs defaultValue="vendedores" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent flex flex-wrap gap-1">
          <TabsTrigger
            value="vendedores"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 font-medium"
          >
            Ventas y Recaudación Diaria
          </TabsTrigger>
          <TabsTrigger
            value="adelantos"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 font-medium flex items-center gap-1.5"
          >
            <BookmarkCheck className="w-4 h-4 text-primary" />
            Adelantos de Reservas
            {depositsData?.summary?.totalReservationsCount ? (
              <Badge variant="secondary" className="ml-1 text-[11px] py-0 px-1.5">
                {depositsData.summary.totalReservationsCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger
            value="categorias"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 font-medium"
          >
            Por Categoría
          </TabsTrigger>
          <TabsTrigger
            value="stock"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 font-medium"
          >
            Alertas de Stock
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: VENTAS Y RECAUDACIÓN POR VENDEDOR */}
        <TabsContent value="vendedores" className="space-y-6 pt-4">
          {/* BARRA DE FILTROS */}
          <Card className="shadow-xs border-muted">
            <CardContent className="p-4 space-y-4">
              {/* Presets rápidos */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Período:
                </span>
                <Button variant="outline" size="sm" onClick={() => applyPreset("today")} className="h-7 text-xs">
                  Hoy
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyPreset("yesterday")} className="h-7 text-xs">
                  Ayer
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyPreset("last7")} className="h-7 text-xs">
                  Últimos 7 días
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyPreset("month")} className="h-7 text-xs">
                  Este Mes
                </Button>
              </div>

              {/* Filtros fecha, vendedor y búsqueda */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Desde</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Hasta</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Vendedor</label>
                  <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos los vendedores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los vendedores</SelectItem>
                      {dailyData?.sellers?.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name} ({s.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Buscar producto / cliente / vendedor</label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Filtrar datos..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      refetchDaily();
                      refetchDeposits();
                    }}
                    disabled={isFetchingDaily || isFetchingDeposits}
                    title="Actualizar datos"
                    className="shrink-0"
                  >
                    <RefreshCw className={`w-4 h-4 ${isFetchingDaily ? "animate-spin text-primary" : ""}`} />
                  </Button>
                  <Button
                    onClick={exportDailyToExcel}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                    disabled={!filteredDaily.length}
                  >
                    <Download className="w-4 h-4" /> Excel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={exportDailyToPDF}
                    disabled={!filteredDaily.length}
                    className="gap-1.5"
                  >
                    <FileText className="w-4 h-4" /> PDF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* TARJETAS KPI DE RESUMEN (INCLUYE ADELANTOS Y SALDO A COBRAR DE RESERVAS) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            {/* KPI 1: INGRESO TOTAL GENERAL */}
            <Card className="bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-background border-emerald-500/40 shadow-xs">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    Total Recaudado
                  </p>
                  <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                    {formatCurrency(grandTotalCollected, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Total Reservas (Adelanto recibido + Saldo a cobrar)</p>
                </div>
                <div className="p-3 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <Coins className="w-6 h-6" />
                </div>
              </CardContent>
            </Card>

            {/* KPI 2: VENTAS DIRECTAS */}
            <Card className="bg-gradient-to-br from-blue-500/10 via-background to-background border-blue-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Ventas Directas</p>
                  <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {formatCurrency(dailyData?.summary?.totalRevenue ?? 0, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {dailyData?.summary?.totalSales ?? 0} {dailyData?.summary?.totalSales === 1 ? "venta" : "ventas"}
                  </p>
                </div>
                <div className="p-3 bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl">
                  <ShoppingCart className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            {/* KPI 3: ADELANTOS DE RESERVAS */}
            <Card className="bg-gradient-to-br from-purple-500/10 via-background to-background border-purple-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Adelantos en Reservas</p>
                  <p className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                    {formatCurrency(dailyData?.summary?.totalDepositsAmount ?? 0, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {dailyData?.summary?.totalDepositsCount ?? 0} {dailyData?.summary?.totalDepositsCount === 1 ? "adelanto" : "adelantos"}
                  </p>
                </div>
                <div className="p-3 bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded-xl">
                  <BookmarkCheck className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            {/* KPI 4: SALDO A COBRAR RESERVAS */}
            <Card className="bg-gradient-to-br from-amber-500/10 via-background to-background border-amber-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Saldo a Cobrar Reservas</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {formatCurrency(dailyData?.summary?.totalBalancesAmount ?? 0, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Pendiente de cobro</p>
                </div>
                <div className="p-3 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl">
                  <Wallet className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            {/* KPI 5: PRODUCTOS DESPACHADOS */}
            <Card className="bg-gradient-to-br from-cyan-500/10 via-background to-background border-cyan-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Productos Despachados</p>
                  <p className="text-xl font-bold text-cyan-600 dark:text-cyan-400 mt-1">
                    {dailyData?.summary?.totalProducts ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Unidades vendidas</p>
                </div>
                <div className="p-3 bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            {/* KPI 6: VENDEDORES ACTIVOS */}
            <Card className="bg-gradient-to-br from-indigo-500/10 via-background to-background border-indigo-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Vendedores Activos</p>
                  <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                    {dailyData?.summary?.activeSellersCount ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Con operaciones registradas</p>
                </div>
                <div className="p-3 bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <User className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* SUB-VISTAS: DETALLADA POR DÍA / GRÁFICO / ACUMULADO */}
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex gap-2">
              <Button
                variant={subView === "daily" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSubView("daily")}
                className="text-xs font-semibold"
              >
                Ventas y Adelantos por Día
              </Button>
              <Button
                variant={subView === "chart" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSubView("chart")}
                className="text-xs font-semibold"
              >
                Gráfico por Día
              </Button>
              <Button
                variant={subView === "totals" ? "default" : "ghost"}
                size="sm"
                onClick={() => setSubView("totals")}
                className="text-xs font-semibold"
              >
                Acumulado General por Vendedor
              </Button>
            </div>

            {subView === "daily" && filteredDaily.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleExpandAll} className="text-xs text-muted-foreground">
                {dailyData?.daily && dailyData.daily.every((d) => expandedRows[`${d.date}_${d.userId}`])
                  ? "Plegar todos los detalles"
                  : "Desplegar todos los detalles"}
              </Button>
            )}
          </div>

          {/* SUBVIEW 1: POR DÍA DETALLADO CON PRODUCTOS Y ADELANTOS */}
          {subView === "daily" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center justify-between">
                  <span>Detalle Diario por Vendedor</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Mostrando {filteredDaily.length} registro(s)
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Haz clic en cualquier fila para ver el desglose de productos vendidos y los adelantos recibidos en reservas ese día.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingDaily ? (
                  <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm">Cargando reporte de ventas y adelantos...</p>
                  </div>
                ) : filteredDaily.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm font-medium">No se encontraron movimientos para los filtros seleccionados</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Intenta ampliar el rango de fechas o cambiar el vendedor.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Vendedor</TableHead>
                        <TableHead className="text-center">Ventas Directas</TableHead>
                        <TableHead className="text-center">Adelantos Reservas</TableHead>
                        <TableHead className="text-center">Saldo a Cobrar</TableHead>
                        <TableHead className="text-right">Total Recaudado</TableHead>
                        <TableHead className="text-right">Productos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDaily.map((row) => {
                        const rowKey = `${row.date}_${row.userId}`;
                        const isExpanded = !!expandedRows[rowKey];
                        const isToday = row.date === todayStr;

                        const parts = row.date.split("-");
                        const dateFormatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : row.date;
                        const totalUnits = row.products.reduce((sum, p) => sum + p.quantity, 0);
                        const grandTotal =
                          row.grandTotal ??
                          ((row.depositsAmount ?? 0) + (row.balancesAmount ?? 0));

                        return (
                          <>
                            <TableRow
                              key={rowKey}
                              onClick={() => toggleRow(rowKey)}
                              className="cursor-pointer hover:bg-muted/30 transition-colors group"
                            >
                              <TableCell className="text-center p-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 p-0 text-muted-foreground group-hover:text-primary"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-primary font-bold" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="font-semibold whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span>{dateFormatted}</span>
                                  {isToday && (
                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px] py-0">
                                      Hoy
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs uppercase">
                                    {row.userName.slice(0, 2)}
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm leading-none">{row.userName}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{row.userRole}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-center whitespace-nowrap">
                                <div className="flex flex-col items-center">
                                  <span className="font-semibold text-xs text-blue-600 dark:text-blue-400">
                                    {formatCurrency(row.totalAmount, currencySymbol)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {row.salesCount} {row.salesCount === 1 ? "venta" : "ventas"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center whitespace-nowrap">
                                <div className="flex flex-col items-center">
                                  {(row.depositsAmount ?? 0) > 0 ? (
                                    <>
                                      <span className="font-semibold text-xs text-purple-600 dark:text-purple-400">
                                        +{formatCurrency(row.depositsAmount ?? 0, currencySymbol)}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground">
                                        {row.depositsCount ?? 0} {row.depositsCount === 1 ? "adelanto" : "adelantos"}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-center whitespace-nowrap">
                                <div className="flex flex-col items-center">
                                  {(row.balancesAmount ?? 0) > 0 ? (
                                    <>
                                      <span className="font-semibold text-xs text-amber-600 dark:text-amber-400">
                                        +{formatCurrency(row.balancesAmount ?? 0, currencySymbol)}
                                      </span>
                                      <span className="text-[11px] text-muted-foreground">
                                        saldo reserva
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(grandTotal, currencySymbol)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="text-xs font-semibold text-foreground">
                                    {row.products.length} {row.products.length === 1 ? "producto" : "productos"}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    ({totalUnits} {totalUnits === 1 ? "unidad" : "unidades"})
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>

                            {/* FILA EXPANDIBLE CON EL DETALLE DE PRODUCTOS Y ADELANTOS */}
                            {isExpanded && (
                              <TableRow className="bg-muted/15 border-t border-b hover:bg-muted/15">
                                <TableCell colSpan={8} className="p-3 sm:p-4 pl-8 sm:pl-12">
                                  <div className="bg-background rounded-lg border shadow-xs p-4 space-y-4">
                                    {/* SECCIÓN 1: PRODUCTOS VENDIDOS */}
                                    <div>
                                      <div className="flex items-center justify-between border-b pb-2 mb-2">
                                        <div className="flex items-center gap-2">
                                          <Package className="w-4 h-4 text-blue-600" />
                                          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                            Productos despachados en ventas directas
                                          </h4>
                                        </div>
                                        <span className="text-xs font-medium text-muted-foreground">
                                          Subtotal ventas:{" "}
                                          <strong className="text-blue-600 dark:text-blue-400 font-bold">
                                            {formatCurrency(row.totalAmount, currencySymbol)}
                                          </strong>
                                        </span>
                                      </div>

                                      {row.products.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic py-1">
                                          No hay ventas directas registradas en este día.
                                        </p>
                                      ) : (
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="border-b text-muted-foreground text-left">
                                                <th className="py-1.5 font-semibold">Producto</th>
                                                <th className="py-1.5 text-center font-semibold">Cantidad</th>
                                                <th className="py-1.5 text-right font-semibold">Subtotal</th>
                                                <th className="py-1.5 text-right font-semibold">% de Ventas</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                              {row.products.map((prod, idx) => {
                                                const percent =
                                                  row.totalAmount > 0
                                                    ? Math.min(100, Math.round((prod.subtotal / row.totalAmount) * 100))
                                                    : 0;

                                                return (
                                                  <tr key={idx} className="hover:bg-muted/30">
                                                    <td className="py-2 font-medium text-foreground pr-4">
                                                      {prod.productName}
                                                    </td>
                                                    <td className="py-2 text-center whitespace-nowrap">
                                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary">
                                                        {prod.quantity}
                                                      </span>
                                                    </td>
                                                    <td className="py-2 text-right font-bold text-foreground whitespace-nowrap">
                                                      {formatCurrency(prod.subtotal, currencySymbol)}
                                                    </td>
                                                    <td className="py-2 text-right text-muted-foreground whitespace-nowrap">
                                                      <span className="text-[11px] font-medium">{percent}%</span>
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>

                                    {/* SECCIÓN 2: ADELANTOS DE RESERVAS RECIBIDOS EN ESTE DÍA */}
                                    {row.deposits && row.deposits.length > 0 && (
                                      <div className="pt-2 border-t">
                                        <div className="flex items-center justify-between border-b pb-2 mb-2">
                                          <div className="flex items-center gap-2">
                                            <BookmarkCheck className="w-4 h-4 text-purple-600" />
                                            <h4 className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                                              Adelantos y saldos en reservas ({row.deposits.length})
                                            </h4>
                                          </div>
                                          <span className="text-xs font-medium text-muted-foreground">
                                            Adelantos:{" "}
                                            <strong className="text-purple-600 dark:text-purple-400 font-bold">
                                              +{formatCurrency(row.depositsAmount ?? 0, currencySymbol)}
                                            </strong>
                                            {" · "}
                                            Saldo a cobrar:{" "}
                                            <strong className="text-amber-600 dark:text-amber-400 font-bold">
                                              +{formatCurrency(row.balancesAmount ?? 0, currencySymbol)}
                                            </strong>
                                          </span>
                                        </div>

                                        <div className="overflow-x-auto">
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="border-b text-muted-foreground text-left">
                                                <th className="py-1.5 font-semibold">N° Reserva</th>
                                                <th className="py-1.5 font-semibold">Cliente</th>
                                                <th className="py-1.5 font-semibold">Método Pago</th>
                                                <th className="py-1.5 text-right font-semibold">Monto Adelanto</th>
                                                <th className="py-1.5 text-right font-semibold">Saldo a Cobrar</th>
                                                <th className="py-1.5 text-right font-semibold">Total Reserva</th>
                                                <th className="py-1.5 text-center font-semibold">Estado Reserva</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                              {row.deposits.map((dep, idx) => (
                                                <tr key={idx} className="hover:bg-muted/30">
                                                  <td className="py-2 font-mono font-semibold text-primary">
                                                    #R-{String(dep.reservationId).padStart(6, "0")}
                                                  </td>
                                                  <td className="py-2 font-medium text-foreground">
                                                    {dep.customerName}
                                                  </td>
                                                  <td className="py-2 text-muted-foreground">
                                                    <Badge variant="outline" className="text-[10px] font-normal">
                                                      {dep.depositMethod}
                                                    </Badge>
                                                  </td>
                                                  <td className="py-2 text-right font-bold text-purple-600 dark:text-purple-400 whitespace-nowrap">
                                                    {formatCurrency(dep.deposit, currencySymbol)}
                                                  </td>
                                                  <td className="py-2 text-right font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                                                    {formatCurrency(dep.balance ?? Math.max(0, dep.total - dep.deposit), currencySymbol)}
                                                  </td>
                                                  <td className="py-2 text-right text-muted-foreground whitespace-nowrap font-medium">
                                                    {formatCurrency(dep.total, currencySymbol)}
                                                  </td>
                                                  <td className="py-2 text-center whitespace-nowrap">
                                                    {getStatusBadge(dep.status)}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}

                                    {/* PIE DE FILA EXPANDIDA CON RECAUDACIÓN TOTAL DEL DÍA */}
                                    <div className="pt-2 border-t flex justify-end items-center gap-3 text-xs">
                                      <span className="text-muted-foreground">
                                        Adelantos recibidos:{" "}
                                        <strong>{formatCurrency(row.depositsAmount ?? 0, currencySymbol)}</strong> + Saldo a cobrar:{" "}
                                        <strong>{formatCurrency(row.balancesAmount ?? 0, currencySymbol)}</strong>
                                      </span>
                                      <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-md">
                                        <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                                          Total Recaudado (Reserva):{" "}
                                        </span>
                                        <strong className="text-emerald-600 dark:text-emerald-400 font-black text-sm">
                                          {formatCurrency(grandTotal, currencySymbol)}
                                        </strong>
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* SUBVIEW 2: GRÁFICO DIARIO DE RECAUDACIÓN */}
          {subView === "chart" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Tendencia Diaria de Recaudación</CardTitle>
                <CardDescription className="text-xs">
                  Recaudación total diaria de reservas (Monto Adelanto + Saldo a cobrar) para el rango seleccionado
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[360px] pt-4">
                {chartDailyData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Sin ingresos registrados en este período
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartDailyData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                      <XAxis dataKey="displayDate" tickLine={false} axisLine={false} />
                      <YAxis
                        tickFormatter={(val) => `${currencySymbol}${val}`}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        formatter={(val: number) => [formatCurrency(val, currencySymbol), "Total Recaudado"]}
                        labelFormatter={(label) => `Fecha: ${label}`}
                      />
                      <Bar dataKey="grandTotal" fill="#10b981" radius={[6, 6, 0, 0]}>
                        {chartDailyData.map((_, index) => (
                          <Cell key={`cell-daily-${index}`} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          )}

          {/* SUBVIEW 3: ACUMULADO GENERAL POR VENDEDOR */}
          {subView === "totals" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Resumen Acumulado por Vendedor</CardTitle>
                  <CardDescription className="text-xs">
                    Totales globales de ventas directas, adelantos y saldos a cobrar en el período ({dateFrom} al {dateTo})
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendedor</TableHead>
                        <TableHead className="text-center">Ventas Directas</TableHead>
                        <TableHead className="text-center">Adelantos</TableHead>
                        <TableHead className="text-center">Saldo a Cobrar</TableHead>
                        <TableHead className="text-right">Total Recaudado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesByUser?.map((s: any) => {
                        const directRev = Number(s.totalRevenue ?? 0);
                        const depRev = Number(s.totalDepositsAmount ?? 0);
                        const balRev = Number(s.totalBalancesAmount ?? 0);
                        const userGrand =
                          s.grandTotal !== undefined
                            ? Number(s.grandTotal)
                            : depRev + balRev;

                        return (
                          <TableRow key={s.userId}>
                            <TableCell className="font-medium">{s.userName}</TableCell>
                            <TableCell className="text-center">
                              <span className="font-semibold text-xs text-blue-600 dark:text-blue-400">
                                {formatCurrency(directRev, currencySymbol)}
                              </span>
                              <span className="text-[11px] text-muted-foreground block">
                                {s.totalSales} {s.totalSales === 1 ? "venta" : "ventas"}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              {depRev > 0 ? (
                                <>
                                  <span className="font-semibold text-xs text-purple-600 dark:text-purple-400">
                                    +{formatCurrency(depRev, currencySymbol)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground block">
                                    {s.totalDepositsCount ?? 0} {s.totalDepositsCount === 1 ? "adelanto" : "adelantos"}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {balRev > 0 ? (
                                <span className="font-semibold text-xs text-amber-600 dark:text-amber-400">
                                  +{formatCurrency(balRev, currencySymbol)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-black text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(userGrand, currencySymbol)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Participación por Vendedor</CardTitle>
                  <CardDescription className="text-xs">Comparativa de recaudación total generada (Monto Adelanto + Saldo a cobrar de reservas)</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={
                        salesByUser?.map((s: any) => ({
                          userName: s.userName,
                          grandTotal:
                            s.grandTotal !== undefined
                              ? Number(s.grandTotal)
                              : Number(s.totalDepositsAmount ?? 0) +
                                Number(s.totalBalancesAmount ?? 0),
                        })) || []
                      }
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                      <XAxis dataKey="userName" tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(val) => `${currencySymbol}${val}`} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(val: number) => [formatCurrency(val, currencySymbol), "Total Recaudado"]} />
                      <Bar dataKey="grandTotal" radius={[4, 4, 0, 0]}>
                        {salesByUser?.map((_, index) => (
                          <Cell key={`cell-user-${index}`} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* TAB 2: ADELANTOS RECIBIDOS EN RESERVAS (NUEVO TAB DEDICADO) */}
        <TabsContent value="adelantos" className="space-y-6 pt-4">
          {/* BARRA DE FILTROS PARA ADELANTOS */}
          <Card className="shadow-xs border-muted">
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Período:
                </span>
                <Button variant="outline" size="sm" onClick={() => applyPreset("today")} className="h-7 text-xs">
                  Hoy
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyPreset("yesterday")} className="h-7 text-xs">
                  Ayer
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyPreset("last7")} className="h-7 text-xs">
                  Últimos 7 días
                </Button>
                <Button variant="outline" size="sm" onClick={() => applyPreset("month")} className="h-7 text-xs">
                  Este Mes
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 lg:grid-cols-6 gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Desde</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Hasta</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Vendedor / Creador</label>
                  <Select value={selectedSeller} onValueChange={setSelectedSeller}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los vendedores</SelectItem>
                      {dailyData?.sellers?.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name} ({s.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Estado Reserva</label>
                  <Select value={depositsStatusFilter} onValueChange={setDepositsStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los estados</SelectItem>
                      <SelectItem value="reserva">Reserva (Inicial)</SelectItem>
                      <SelectItem value="produccion">En Producción</SelectItem>
                      <SelectItem value="listo_entrega">Listo p/ Entrega</SelectItem>
                      <SelectItem value="entregada">Entregada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Buscar reserva / cliente</label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Cliente, #R, notas..."
                      value={depositsSearchTerm}
                      onChange={(e) => setDepositsSearchTerm(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => refetchDeposits()}
                    disabled={isFetchingDeposits}
                    title="Actualizar adelantos"
                    className="shrink-0"
                  >
                    <RefreshCw className={`w-4 h-4 ${isFetchingDeposits ? "animate-spin text-primary" : ""}`} />
                  </Button>
                  <Button
                    onClick={exportDepositsToExcel}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                    disabled={!filteredDeposits.length}
                  >
                    <Download className="w-4 h-4" /> Excel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={exportDepositsToPDF}
                    disabled={!filteredDeposits.length}
                    className="gap-1.5"
                  >
                    <FileText className="w-4 h-4" /> PDF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* TARJETAS KPI DE ADELANTOS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-purple-500/15 via-purple-500/5 to-background border-purple-500/40 shadow-xs">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-purple-800 dark:text-purple-300">
                    Total Adelantos Recibidos
                  </p>
                  <p className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
                    {formatCurrency(depositsData?.summary?.totalDepositsAmount ?? 0, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">En el período seleccionado</p>
                </div>
                <div className="p-3 bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded-xl">
                  <BookmarkCheck className="w-6 h-6" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-500/10 via-background to-background border-blue-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Reservas con Adelanto</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {depositsData?.summary?.totalReservationsCount ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Valor total: {formatCurrency(depositsData?.summary?.totalReservationsTotal ?? 0, currencySymbol)}
                  </p>
                </div>
                <div className="p-3 bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Package className="w-6 h-6" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-emerald-500/10 via-background to-background border-emerald-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Promedio por Adelanto</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {formatCurrency(depositsData?.summary?.averageDeposit ?? 0, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Por reserva registrada</p>
                </div>
                <div className="p-3 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <TrendingUp className="w-6 h-6" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-amber-500/10 via-background to-background border-amber-500/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Saldo Pendiente por Cobrar</p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {formatCurrency(depositsData?.summary?.totalRemainingBalance ?? 0, currencySymbol)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">A cobrar en la entrega</p>
                </div>
                <div className="p-3 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl">
                  <Wallet className="w-6 h-6" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* DESGLOSE POR MÉTODO DE PAGO */}
          {depositsData?.summary?.byPaymentMethod && Object.keys(depositsData.summary.byPaymentMethod).length > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/20 border rounded-lg">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mr-1">
                <CreditCard className="w-4 h-4 text-primary" /> Recaudación de adelantos por método:
              </span>
              {Object.entries(depositsData.summary.byPaymentMethod).map(([method, amount]) => (
                <Badge key={method} variant="secondary" className="text-xs py-1 px-2.5 font-medium gap-1.5">
                  <span className="font-semibold">{method}:</span>
                  <span className="font-bold text-purple-700 dark:text-purple-300">
                    {formatCurrency(amount, currencySymbol)}
                  </span>
                </Badge>
              ))}
            </div>
          )}

          {/* TABLA DE ADELANTOS DE RESERVAS */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Listado de Adelantos Recibidos en Reservas
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Detalle de clientes, fechas de registro, métodos de pago utilizados y saldos pendientes.
                  </CardDescription>
                </div>
                {filteredDeposits.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={toggleExpandAllDeposits} className="text-xs text-muted-foreground">
                    {depositsData?.deposits && depositsData.deposits.every((d) => expandedDepositRows[d.id])
                      ? "Plegar todos los detalles"
                      : "Desplegar todos los productos"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingDeposits ? (
                <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm">Cargando adelantos de reservas...</p>
                </div>
              ) : filteredDeposits.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <BookmarkCheck className="w-8 h-8 mx-auto mb-2 opacity-40 text-purple-500" />
                  <p className="text-sm font-medium">No se encontraron adelantos de reservas para los filtros seleccionados</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Prueba cambiando el rango de fechas o el estado de la reserva.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>N° Reserva</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Método de Pago</TableHead>
                      <TableHead className="text-right">Monto Adelanto</TableHead>
                      <TableHead className="text-right">Total / Saldo</TableHead>
                      <TableHead className="text-center">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDeposits.map((item) => {
                      const isExpanded = !!expandedDepositRows[item.id];
                      const dateFormatted = formatDateDisplay(item.reservationDate || item.createdAt);
                      const paymentMethodText =
                        item.payments.length > 1
                          ? item.payments.map((p) => `${p.paymentMethod} (${formatCurrency(p.amount, currencySymbol)})`).join(" + ")
                          : item.payments[0]?.paymentMethod || item.depositMethod || "Efectivo";

                      return (
                        <>
                          <TableRow
                            key={item.id}
                            onClick={() => toggleDepositRow(item.id)}
                            className="cursor-pointer hover:bg-muted/30 transition-colors group"
                          >
                            <TableCell className="text-center p-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 p-0 text-muted-foreground group-hover:text-primary"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-primary font-bold" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-semibold whitespace-nowrap text-xs">
                              {dateFormatted}
                            </TableCell>
                            <TableCell className="font-mono font-bold text-xs text-primary whitespace-nowrap">
                              #R-{String(item.id).padStart(6, "0")}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-xs text-foreground leading-tight">{item.customerName}</p>
                                {item.customerPhone && (
                                  <p className="text-[11px] text-muted-foreground">{item.customerPhone}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px] uppercase">
                                  {item.userName.slice(0, 2)}
                                </div>
                                <span className="text-xs text-muted-foreground">{item.userName}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[11px] font-normal py-0">
                                {paymentMethodText}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <span className="text-sm font-black text-purple-600 dark:text-purple-400">
                                {formatCurrency(item.deposit, currencySymbol)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-semibold text-foreground">
                                  Total: {formatCurrency(item.total, currencySymbol)}
                                </span>
                                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                  Saldo: {formatCurrency(item.balance, currencySymbol)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center whitespace-nowrap">
                              {getStatusBadge(item.status)}
                            </TableCell>
                          </TableRow>

                          {/* FILA EXPANDIBLE CON EL DETALLE DE LA RESERVA */}
                          {isExpanded && (
                            <TableRow className="bg-muted/15 border-t border-b hover:bg-muted/15">
                              <TableCell colSpan={9} className="p-3 sm:p-4 pl-8 sm:pl-12">
                                <div className="bg-background rounded-lg border shadow-xs p-4 space-y-3">
                                  <div className="flex items-center justify-between border-b pb-2">
                                    <div className="flex items-center gap-2">
                                      <Package className="w-4 h-4 text-purple-600" />
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                        Productos y especificaciones de la Reserva #R-{String(item.id).padStart(6, "0")}
                                      </h4>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                      {item.expectedAt && (
                                        <span className="text-muted-foreground">
                                          Entrega estimada: <strong>{formatDateDisplay(item.expectedAt)}</strong>
                                        </span>
                                      )}
                                      <span className="text-purple-600 dark:text-purple-400 font-semibold">
                                        Adelanto: {formatCurrency(item.deposit, currencySymbol)}
                                      </span>
                                    </div>
                                  </div>

                                  {item.products.length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic py-1">
                                      No hay productos detallados registrados para esta reserva.
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b text-muted-foreground text-left">
                                            <th className="py-1.5 font-semibold">Producto</th>
                                            <th className="py-1.5 font-semibold">Especificaciones de Personalización</th>
                                            <th className="py-1.5 text-center font-semibold">Cantidad</th>
                                            <th className="py-1.5 text-right font-semibold">Precio Unit.</th>
                                            <th className="py-1.5 text-right font-semibold">Subtotal</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                          {item.products.map((p, pIdx) => (
                                            <tr key={pIdx} className="hover:bg-muted/30">
                                              <td className="py-2 font-medium text-foreground pr-4">
                                                {p.productName}
                                              </td>
                                              <td className="py-2 text-muted-foreground pr-4 max-w-xs break-words">
                                                {p.specifications || "—"}
                                              </td>
                                              <td className="py-2 text-center whitespace-nowrap">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary">
                                                  {p.quantity}
                                                </span>
                                              </td>
                                              <td className="py-2 text-right text-muted-foreground whitespace-nowrap">
                                                {formatCurrency(p.unitPrice, currencySymbol)}
                                              </td>
                                              <td className="py-2 text-right font-bold text-foreground whitespace-nowrap">
                                                {formatCurrency(p.subtotal, currencySymbol)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}

                                  {/* PAGOS DESGLOSADOS SI FUERON MÚLTIPLES */}
                                  {item.payments.length > 1 && (
                                    <div className="pt-2 border-t text-xs flex items-center gap-2">
                                      <span className="font-semibold text-muted-foreground">Desglose del adelanto:</span>
                                      {item.payments.map((p, idx) => (
                                        <Badge key={idx} variant="outline" className="text-[11px]">
                                          {p.paymentMethod}: {formatCurrency(p.amount, currencySymbol)}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}

                                  {/* NOTAS DE LA RESERVA */}
                                  {item.notes && (
                                    <div className="pt-2 border-t text-xs">
                                      <span className="font-semibold text-muted-foreground">Notas: </span>
                                      <span className="text-foreground italic">{item.notes}</span>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: POR CATEGORÍA */}
        <TabsContent value="categorias" className="space-y-4 pt-4">
          <div className="flex gap-4 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium">Desde</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Hasta</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Button
              onClick={() => {
                const ws = XLSX.utils.json_to_sheet(byCategory || []);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Reporte");
                XLSX.writeFile(wb, "Ventas_por_Categoria.xlsx");
              }}
            >
              <Download className="w-4 h-4 mr-2" /> Exportar
            </Button>
            <Button variant="outline" onClick={exportCategoryPDF} disabled={!byCategory?.length}>
              <FileText className="w-4 h-4 mr-2" /> PDF
            </Button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Categoría</TableHead>
                      <TableHead className="text-right">Unidades Vendidas</TableHead>
                      <TableHead className="text-right">Ingresos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byCategory?.map((c) => (
                      <TableRow key={c.categoryId}>
                        <TableCell className="font-medium">{c.categoryName || "Sin Categoría"}</TableCell>
                        <TableCell className="text-right">{c.totalSold}</TableCell>
                        <TableCell className="text-right font-bold">
                          {formatCurrency(c.totalRevenue ?? 0, currencySymbol)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Ingresos por Categoría</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCategory || []} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                    <XAxis type="number" tickFormatter={(val) => `${currencySymbol}${val}`} tickLine={false} axisLine={false} />
                    <YAxis dataKey="categoryName" type="category" tickLine={false} axisLine={false} />
                    <Tooltip formatter={(val: number) => formatCurrency(val, currencySymbol)} />
                    <Bar dataKey="totalRevenue" radius={[0, 4, 4, 0]} fill="var(--color-primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 4: ALERTAS DE STOCK */}
        <TabsContent value="stock" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                const ws = XLSX.utils.json_to_sheet(stockAlerts || []);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Reporte");
                XLSX.writeFile(wb, "Alertas_Stock.xlsx");
              }}
            >
              <Download className="w-4 h-4 mr-2" /> Exportar
            </Button>
            <Button variant="outline" onClick={exportStockPDF} disabled={!stockAlerts?.length}>
              <FileText className="w-4 h-4 mr-2" /> PDF
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Stock Actual</TableHead>
                    <TableHead className="text-right">Stock Mínimo</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockAlerts?.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.categoryName || "-"}</TableCell>
                      <TableCell className="text-right font-bold">{a.stock}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{a.minStock}</TableCell>
                      <TableCell className="text-center">
                        {a.stock <= 0 ? (
                          <Badge variant="destructive">Sin Stock</Badge>
                        ) : (
                          <Badge variant="outline" className="border-warning text-warning-foreground bg-warning/10">
                            <AlertTriangle className="w-3 h-3 mr-1" /> Bajo
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
