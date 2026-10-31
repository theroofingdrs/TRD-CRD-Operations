import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function readKey(singleName: string, mapName: string): string {\n  const direct = Deno.env.get(singleName);\n  if (direct) return direct;\n  try {\n    const values = JSON.parse(Deno.env.get(mapName) ?? "{}") as Record<string, string>;\n    return values.default ?? Object.values(values)[0] ?? "";\n  } catch {\n    return "";\n  }\n}\n\nfunction json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);

  const requestUrl = new URL(req.url);
  const division = requestUrl.searchParams.get("division");
  const slug = requestUrl.searchParams.get("slug");
  if (division !== "TRD" && division !== "CRD") return json({ error: "A valid division is required." }, 400);
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "Invalid article slug." }, 400);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
  if (!url || !secret) return json({ error: "Blog service is not configured." }, 500);

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date().toISOString();
  let query = admin.from("crm_blog_posts")
    .select("id,division_id,title,slug,excerpt,body_markdown,category,featured_image_path,featured_image_alt,seo_title,seo_description,status,published_at,scheduled_at,created_at,updated_at")
    .eq("division_id", division)
    .in("status", ["published", "scheduled"]);

  if (slug) query = query.eq("slug", slug);
  const { data, error } = await query.order("published_at", { ascending: false, nullsFirst: false }).order("scheduled_at", { ascending: false, nullsFirst: false });

  if (error) return json({ error: "Unable to load blog articles." }, 500);

  const visible = (data ?? []).filter((post) => {
    if (post.status === "published") return !!post.published_at && post.published_at <= now;
    return !!post.scheduled_at && post.scheduled_at <= now;
  }).map((post) => ({
    id: post.id,
    division_id: post.division_id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body_markdown: post.body_markdown,
    category: post.category,
    featured_image_url: post.featured_image_path
      ? admin.storage.from("roof-doctors-blog-media").getPublicUrl(post.featured_image_path).data.publicUrl
      : null,
    featured_image_alt: post.featured_image_alt,
    seo_title: post.seo_title,
    seo_description: post.seo_description,
    published_at: post.published_at ?? post.scheduled_at,
    created_at: post.created_at,
    updated_at: post.updated_at,
  }));

  return json({ posts: visible });
});
