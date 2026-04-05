// invite-barber — Supabase Edge Function
// Called by shop owners to invite a barber to their shop.
// Creates a pending invite record and (future) sends an email/SMS.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the caller is authenticated
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is a shop_owner
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role, shop_id")
      .eq("user_id", user.id)
      .eq("role", "shop_owner");

    if (!roles?.length) {
      return new Response(
        JSON.stringify({ error: "Only shop owners can invite barbers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopId = roles[0].shop_id;

    // Parse request body
    const { name, email, phone } = await req.json();

    if (!name?.trim()) {
      return new Response(
        JSON.stringify({ error: "Barber name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!email?.trim() && !phone?.trim()) {
      return new Response(
        JSON.stringify({ error: "Email or phone is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for duplicate pending invite
    if (email?.trim()) {
      const { data: existing } = await adminClient
        .from("barber_invites")
        .select("id")
        .eq("shop_id", shopId)
        .eq("email", email.trim().toLowerCase())
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "An invite is already pending for this email" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create the invite record
    const { data: invite, error: insertError } = await adminClient
      .from("barber_invites")
      .insert({
        shop_id: shopId,
        invited_by: user.id,
        name: name.trim(),
        email: email?.trim().toLowerCase() || null,
        phone: phone?.trim() || null,
        status: "pending",
      })
      .select("id, name, email, phone, status, created_at")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create invite" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // TODO: Send invite email/SMS via Twilio/SendGrid

    return new Response(
      JSON.stringify({ invite }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
