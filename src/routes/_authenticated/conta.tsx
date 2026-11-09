import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccess, signOutEverywhere } from "@/lib/access";

export const Route = createFileRoute("/_authenticated/conta")({
  head: () => ({
    meta: [
      { title: "Minha conta — Terra Web" },
      { name: "description", content: "Perfil do usuário e controle de acesso ao Terra Web." },
      { property: "og:title", content: "Minha conta — Terra Web" },
      { property: "og:description", content: "Perfil e controle de acesso." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContaPage,
});

function ContaPage() {
  const { user } = Route.useRouteContext();
  const access = useAccess(user.id);
  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-5">
          <div>
            <h1 className="text-xl font-semibold">Minha conta</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {access.data?.isAdmin ? "Super administrador" : access.data?.approved ? "Acesso liberado" : "Aguardando liberação"}
            </p>
          </div>
          <button className="earth-btn" onClick={signOutEverywhere}>Sair</button>
        </div>
        {access.data?.isAdmin && <AdminPanel selfId={user.id} />}
        <p className="text-xs text-muted-foreground">Pode fechar esta aba — o mapa continua aberto na outra aba exatamente como estava.</p>
      </div>
    </div>
  );
}

function AdminPanel({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("id,email,display_name,created_at").order("created_at"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      return (p.data ?? []).map((u) => {
        const roles = (r.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.role);
        return { ...u, isAdmin: roles.includes("super_admin"), approved: roles.includes("approved") };
      });
    },
  });

  async function setApproved(id: string, approve: boolean) {
    const res = approve
      ? await supabase.from("user_roles").insert({ user_id: id, role: "approved" })
      : await supabase.from("user_roles").delete().eq("user_id", id).eq("role", "approved");
    if (res.error) alert(res.error.message);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold">Controle de acesso</h2>
      {users.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="py-2">Usuário</th><th>Status</th><th /></tr></thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="py-2">
                <div>{u.display_name}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td>{u.isAdmin ? "Super admin" : u.approved ? "Liberado" : "Bloqueado / pendente"}</td>
              <td className="text-right">
                {!u.isAdmin && u.id !== selfId && (
                  u.approved
                    ? <button className="earth-btn-danger" onClick={() => setApproved(u.id, false)}>Bloquear</button>
                    : <button className="earth-btn-primary" onClick={() => setApproved(u.id, true)}>Liberar</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
