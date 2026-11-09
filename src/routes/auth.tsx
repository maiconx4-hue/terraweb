import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Terra Web" },
      { name: "description", content: "Acesse o Terra Web com sua conta." },
      { property: "og:title", content: "Entrar — Terra Web" },
      { property: "og:description", content: "Acesse o Terra Web com sua conta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function GoogleLogo() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.170 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.760 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user) navigate({ to: "/mapa", replace: true }); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === "SIGNED_IN" && s) navigate({ to: "/mapa", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "up") {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/mapa" } });
        if (error) throw error;
        setMsg("Conta criada! Confirme pelo link enviado ao seu e-mail. Depois, aguarde a liberação do administrador.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/reset-password" });
        if (error) throw error;
        setMsg("Enviamos um link para redefinir sua senha.");
      }
    } catch (err: any) {
      setMsg(err.message ?? "Erro ao entrar");
    } finally { setBusy(false); }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) setMsg(r.error.message ?? "Erro com o Google");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <h1 className="text-2xl font-semibold text-foreground">Terra Web</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          {mode === "in" ? "Entre na sua conta" : mode === "up" ? "Crie sua conta" : "Recuperar senha"}
        </p>
        {mode !== "forgot" && (
          <>
            <button type="button" onClick={google} className="mb-4 flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-muted">
              <GoogleLogo /> Continuar com Google
            </button>
            <div className="mb-4 text-center text-xs text-muted-foreground">ou com e-mail</div>
          </>
        )}
        <form onSubmit={submit} className="space-y-3">
          <input className="earth-input w-full" type="email" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          {mode !== "forgot" && (
            <input className="earth-input w-full" type="password" required minLength={6} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          <button disabled={busy} className="earth-btn-primary w-full">
            {mode === "in" ? "Entrar" : mode === "up" ? "Criar conta" : "Enviar link"}
          </button>
        </form>
        {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
        <div className="mt-4 flex justify-between text-xs">
          <button className="text-primary hover:underline" onClick={() => { setMode(mode === "up" ? "in" : "up"); setMsg(null); }}>
            {mode === "up" ? "Já tenho conta" : "Criar conta"}
          </button>
          <button className="text-muted-foreground hover:underline" onClick={() => { setMode("forgot"); setMsg(null); }}>Esqueci a senha</button>
        </div>
      </div>
    </div>
  );
}
