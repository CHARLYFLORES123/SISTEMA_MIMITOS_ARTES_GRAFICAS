import { useState } from "react";
import { useGetUsers, useCreateUser, useUpdateUser, useDeleteUser } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Toast, confirmDelete } from "@/lib/swal";
import { Pencil, Trash2, Plus, FileText } from "lucide-react";
import { format } from "date-fns";
import { exportTablePDF } from "@/lib/export-table-pdf";

const ROLES = [
  { value: "admin",      label: "Admin" },
  { value: "vendedor",   label: "Vendedor" },
  { value: "inventario", label: "Inventario" },
  { value: "compras",    label: "Compras" },
  { value: "diseñador",  label: "Diseñador" },
];

const ROLE_BADGE: Record<string, string> = {
  admin:      "default",
  vendedor:   "secondary",
  inventario: "outline",
  compras:    "outline",
  diseñador:  "secondary",
};

const schema = z.object({
  name: z.string().min(2, "Requerido"),
  email: z.string().email("Email inválido"),
  password: z.string().optional(),
  role: z.enum(["admin", "vendedor", "inventario", "compras", "diseñador"]),
});

const ROLE_PERMISSIONS_SUMMARY: Record<string, string> = {
  admin:      "Acceso completo",
  vendedor:   "Ventas · Cierre de caja · Reservas · Clientes · Reportes · Fidelización",
  inventario: "Productos/Categorías/Marcas: crear, editar",
  compras:    "Proveedores: crear, editar · Cotizaciones: crear",
  diseñador:  "Pedidos activos: cambiar etapa a producción y listo para entrega",
};

export default function Users() {
  const { data: users, isLoading } = useGetUsers();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();
  const queryClient = useQueryClient();
  const exportPDF = () => {
    exportTablePDF({
      title: "Usuarios",
      fileName: `Usuarios_${new Date().toISOString().slice(0, 10)}.pdf`,
      headers: ["Nombre", "Correo", "Rol", "Permisos", "Fecha de registro"],
      rows: (users ?? []).map((user) => {
        const role = user.role?.toLowerCase() ?? "vendedor";
        return [
          user.name,
          user.email,
          ROLES.find((item) => item.value === role)?.label ?? user.role,
          ROLE_PERMISSIONS_SUMMARY[role] ?? "—",
          format(new Date(user.createdAt), "dd/MM/yyyy"),
        ];
      }),
    });
  };

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", role: "vendedor" },
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    form.reset({ name: "", email: "", password: "", role: "vendedor" });
    setIsOpen(true);
  };

  const handleOpenEdit = (user: any) => {
    setEditingId(user.id);
    const role = user.role?.toLowerCase();
    const validRole = ["admin", "vendedor", "inventario", "compras", "diseñador"].includes(role) ? role : "vendedor";
    form.reset({ name: user.name, email: user.email, password: "", role: validRole });
    setIsOpen(true);
  };

  const onSubmit = (values: z.infer<typeof schema>) => {
    if (editingId) {
      const data = { name: values.name, email: values.email, role: values.role, ...(values.password ? { password: values.password } : {}) };
      updateMutation.mutate({ id: editingId, data }, {
        onSuccess: () => {
          Toast.fire({ icon: "success", title: "Usuario actualizado" });
          queryClient.invalidateQueries({ queryKey: ["/api/users"] });
          setIsOpen(false);
        }
      });
    } else {
      if (!values.password) {
        form.setError("password", { message: "Contraseña es requerida para nuevos usuarios" });
        return;
      }
      createMutation.mutate({ data: values as any }, {
        onSuccess: () => {
          Toast.fire({ icon: "success", title: "Usuario creado" });
          queryClient.invalidateQueries({ queryKey: ["/api/users"] });
          setIsOpen(false);
        }
      });
    }
  };

  const handleDelete = async (id: number) => {
    const result = await confirmDelete("este usuario");
    if (!result.isConfirmed) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        Toast.fire({ icon: "success", title: "Usuario eliminado" });
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Usuarios</h2>
        <div className="flex items-center gap-2">
        <Button variant="outline" onClick={exportPDF} disabled={!users?.length || isLoading}>
          <FileText className="h-4 w-4 mr-2" /> PDF
        </Button>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenCreate}><Plus className="h-4 w-4 mr-2" /> Nuevo Usuario</Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader><DialogTitle>{editingId ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Nombre</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem><FormLabel>Contraseña {editingId && "(dejar en blanco para no cambiar)"}</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rol</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {ROLE_PERMISSIONS_SUMMARY[field.value]}
                    </p>
                  </FormItem>
                )} />
                <div className="flex justify-end gap-2 mt-4">
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>Guardar</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Permisos</TableHead>
                <TableHead>Fecha Registro</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-4">Cargando...</TableCell></TableRow>
              ) : users?.map((u) => {
                const role = u.role?.toLowerCase() ?? "vendedor";
                const roleLabel = ROLES.find(r => r.value === role)?.label ?? u.role;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE[role] as any ?? "secondary"}>{roleLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px]">{ROLE_PERMISSIONS_SUMMARY[role] ?? "—"}</TableCell>
                    <TableCell>{format(new Date(u.createdAt), "dd/MM/yyyy")}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(u)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(u.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
