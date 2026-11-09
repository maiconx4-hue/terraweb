import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAccess(userId: string) {
  return useQuery({
    queryKey: ["access", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role);
      const isAdmin = roles.includes("super_admin");
      return { isAdmin, approved: isAdmin || roles.includes("approved") };
    },
  });
}

export async function signOutEverywhere() {
  await supabase.auth.signOut();
  window.location.replace("/auth");
}
