import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nova senha — Terra Web" },
      { name: "description", content: "Defina uma nova senha para sua conta do Terra Web." },
      { property: "og:title", content: "Nova senha — Terra Web" },
      { property: "og:description", content: "Defina uma nova senha." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setMsg(error.message);
    navigate({ to: "/mapa", replace: true });
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Definir nova senha</h1>
        <input className="earth-input w-full" type="password" required minLength={6} placeholder="Nova senha" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="earth-btn-primary w-full">Salvar</button>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </form>
    </div>
  );
}
