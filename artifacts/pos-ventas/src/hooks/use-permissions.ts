import { useGetMe } from "@workspace/api-client-react";

export type Action = "read" | "create" | "update" | "delete" | "cancel";

type PermissionMap = Record<string, Action[]>;

const ROLE_PERMISSIONS: Record<string, PermissionMap> = {
  admin: {
    "*": ["read", "create", "update", "delete", "cancel"],
  },
  vendedor: {
    sales:        ["read", "create"],
    customers:    ["read", "create", "update"],
    reports:      ["read"],
    loyalty:      ["read", "create", "update"],
    reservations: ["read", "create", "update"],
    cashRegister: ["read", "create", "update"],
  },
  inventario: {
    products:   ["read", "create", "update"],
    categories: ["read", "create", "update"],
    brands:     ["read", "create", "update"],
    inventory:  ["read", "create", "update"],
  },
  compras: {
    suppliers: ["read", "create", "update"],
    quotes:    ["read", "create"],
    inventory: ["read", "create"],
  },
  diseñador: {
    reservations: ["read", "update"],
  },
};

export function usePermissions() {
  const { data: user } = useGetMe({ query: { retry: false } as any });
  const role = (user?.role ?? "").toLowerCase();

  function can(module: string, action: Action): boolean {
    if (role === "admin") return true;
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;
    const modulePerms = perms[module] ?? [];
    return modulePerms.includes(action);
  }

  return { can, role, user };
}
