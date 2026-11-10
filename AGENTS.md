<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Map features are a flat node list with parentId folders, cached per user in localStorage and synced (debounced) to one `projects` row per user in Lovable Cloud; KML/KMZ I/O lives in src/lib/geo/kml.ts. Why: fast/offline load plus per-account cloud copy.
- Access control: first signup becomes super_admin (DB trigger); others need the `approved` role in user_roles, granted only by super_admin. Map lives at /mapa under _authenticated; /conta opens in a new tab so the map tab keeps its state. Why: admin-controlled access without disturbing the map.
- Consume drawing drafts synchronously and create features outside React state updaters; Google Maps OverlayView provides temporary vertex feedback. Why: prevent replayed completion from duplicating features and keep feedback aligned during map movement.
