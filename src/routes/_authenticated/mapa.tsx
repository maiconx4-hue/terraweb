import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { useAccess, signOutEverywhere } from "@/lib/access";

const EarthApp = lazy(() => import("@/components/earth/EarthApp"));

export const Route = createFileRoute("/_authenticated/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa — Terra Web" },
      { name: "description", content: "Seu projeto de mapa com marcadores, polígonos, caminhos e Street View." },
      { property: "og:title", content: "Mapa — Terra Web" },
      { property: "og:description", content: "Seu projeto de mapa no Terra Web." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MapaPage,
});

function Loading({ text = "Carregando o globo…" }: { text?: string }) {
  return <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">{text}</div>;
}

function MapaPage() {
  const { user } = Route.useRouteContext();
  const access = useAccess(user.id);
  if (access.isLoading) return <Loading text="Verificando acesso…" />;
  if (!access.data?.approved) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold text-foreground">Acesso em análise</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta ({user.email}) foi criada. O administrador precisa liberar seu acesso ao Terra Web.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="earth-btn" onClick={() => access.refetch()}>Verificar novamente</button>
            <button className="earth-btn" onClick={signOutEverywhere}>Sair</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <Suspense fallback={<Loading />}>
        <EarthApp userId={user.id} userEmail={user.email ?? ""} />
      </Suspense>
      <Toaster position="top-right" />
    </>
  );
}
