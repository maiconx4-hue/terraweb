import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";

const EarthApp = lazy(() => import("@/components/earth/EarthApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Terra Web — mapas de satélite, Street View e KMZ" },
      { name: "description", content: "Crie marcadores, polígonos e caminhos sobre imagens de satélite do Google, organize em pastas e importe/exporte KML e KMZ." },
      { property: "og:title", content: "Terra Web — mapas de satélite, Street View e KMZ" },
      { property: "og:description", content: "Marcadores, polígonos, caminhos, pastas, Street View e KMZ no navegador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">Carregando o globo…</div>;
}

function Index() {
  return (
    <>
      <ClientOnly fallback={<Loading />}>
        <Suspense fallback={<Loading />}>
          <EarthApp />
        </Suspense>
      </ClientOnly>
      <Toaster position="top-right" />
    </>
  );
}
