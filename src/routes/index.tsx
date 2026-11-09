import { createFileRoute, redirect } from "@tanstack/react-router";

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
  beforeLoad: () => {
    throw redirect({ to: "/mapa" });
  },
  component: () => null,
});
