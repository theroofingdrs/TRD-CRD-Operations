import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Status = "draft" | "scheduled" | "published" | "archived";
type BlogPost = {
  id: string;
  division_id: DivisionId;
  title: string;
  slug: string;
  excerpt: string;
  body_markdown: string;
  category: string;
  featured_image_path: string | null;
  featured_image_alt: string;
  seo_title: string | null;
  seo_description: string | null;
  status: Status;
  published_at: string | null;
  scheduled_at: string | null;
  archived_at: string | null;
  updated_at: string;
  created_at: string;
};
type Draft = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body_markdown: string;
  category: string;
  featured_image_path: string;
  featured_image_alt: string;
  seo_title: string;
  seo_description: string;
  scheduled_at: string;
};
const BUCKET = "roof-doctors-blog-media";
const blankDraft = (): Draft => ({ id: "", title: "", slug: "", excerpt: "", body_markdown: "", category: "Roofing Tips", featured_image_path: "", featured_image_alt: "", seo_title: "", seo_description: "", scheduled_at: "" });
const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const imageUrl = (path: string | null) => path && supabase ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : "";
const divisionName = (division: DivisionId) => division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";

export default function BlogManager({ division, userId }: { division: DivisionId; userId: string }) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("crm_blog_posts").select("*").eq("division_id", division).order("updated_at", { ascending: false });
    if (error) { setMessage(error.message); setMessageError(true); }
    else setPosts((data ?? []) as BlogPost[]);
    setLoading(false);
  }, [division]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDraft(blankDraft()); setEditing(false); setPreview(false); setMessage(""); }, [division]);

  const visiblePosts = useMemo(() => posts.filter((post) =>
    (statusFilter === "all" || post.status === statusFilter)
    && (post.title + " " + post.slug + " " + post.category).toLowerCase().includes(query.toLowerCase())
  ), [posts, query, statusFilter]);

  function startNew() {
    setDraft(blankDraft());
    setEditing(true);
    setPreview(false);
    setMessage("");
  }
  function editPost(post: BlogPost) {
    setDraft({
      id: post.id, title: post.title, slug: post.slug, excerpt: post.excerpt,
      body_markdown: post.body_markdown, category: post.category,
      featured_image_path: post.featured_image_path ?? "", featured_image_alt: post.featured_image_alt,
      seo_title: post.seo_title ?? "", seo_description: post.seo_description ?? "",
      scheduled_at: post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : ""
    });
    setEditing(true);
    setPreview(false);
    setMessage("");
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !supabase) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Use a JPG, PNG, or WebP image.");
      setMessageError(true);
      event.target.value = "";
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setMessage("Images must be 15 MB or smaller.");
      setMessageError(true);
      event.target.value = "";
      return;
    }
    const baseSlug = slugify(draft.slug || draft.title || "article") || "article";
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "");
    const path = `${division.toLowerCase()}/${baseSlug}/${crypto.randomUUID()}-${safeName}`;
    setUploading(true);
    setMessage("");
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
    if (error) {
      setMessage("Image upload failed: " + error.message);
      setMessageError(true);
    } else {
      update("featured_image_path", path);
      setMessage("Featured image uploaded.");
      setMessageError(false);
    }
    setUploading(false);
    event.target.value = "";
  }

  async function save(target: Status) {
    if (!supabase) return;
    const title = draft.title.trim();
    const slug = slugify(draft.slug || title);
    if (!title || !slug || !draft.body_markdown.trim()) {
      setMessage("Add an article title, URL slug, and article content before saving.");
      setMessageError(true);
      return;
    }
    if (target === "scheduled" && (!draft.scheduled_at || new Date(draft.scheduled_at).getTime() <= Date.now())) {
      setMessage("Choose a future publication date and time to schedule this article.");
      setMessageError(true);
      return;
    }
    setSaving(true);
    setMessage("");
    setMessageError(false);
    const now = new Date().toISOString();
    const payload = {
      division_id: division, title, slug, excerpt: draft.excerpt.trim(),
      body_markdown: draft.body_markdown.trim(), category: draft.category.trim() || "General",
      featured_image_path: draft.featured_image_path || null,
      featured_image_alt: draft.featured_image_alt.trim(),
      seo_title: draft.seo_title.trim() || null,
      seo_description: draft.seo_description.trim() || null,
      status: target,
      published_at: target === "published" ? now : null,
      scheduled_at: target === "scheduled" ? new Date(draft.scheduled_at).toISOString() : null,
      archived_at: target === "archived" ? now : null,
      author_id: userId
    };
    const result = draft.id
      ? await supabase.from("crm_blog_posts").update(payload).eq("id", draft.id).eq("division_id", division).select("id").single()
      : await supabase.from("crm_blog_posts").insert(payload).select("id").single();
    if (result.error) {
      setMessage(result.error.code === "23505" ? "That URL slug is already used in this division. Choose another." : result.error.message);
      setMessageError(true);
    } else {
      setMessage(target === "published" ? "Article published." : target === "scheduled" ? "Article scheduled." : target === "archived" ? "Article archived." : "Draft saved.");
      setMessageError(false);
      setEditing(false);
      setPreview(false);
      setDraft(blankDraft());
      await load();
    }
    setSaving(false);
  }

  async function changeStatus(post: BlogPost, status: Status) {
    if (!supabase) return;
    if (status === "archived" && !window.confirm("Archive this article? It will no longer appear publicly.")) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from("crm_blog_posts").update({
      status,
      published_at: status === "published" ? (post.published_at || now) : null,
      scheduled_at: status === "scheduled" ? post.scheduled_at : null,
      archived_at: status === "archived" ? now : null
    }).eq("id", post.id).eq("division_id", division);
    if (error) { setMessage(error.message); setMessageError(true); }
    else { setMessage(status === "published" ? "Article published." : "Article archived."); setMessageError(false); await load(); }
  }

  const previewUrl = imageUrl(draft.featured_image_path || null);
  const publicPath = `/${division === "TRD" ? "residential" : "commercial"}/blog/${slugify(draft.slug || draft.title)}`;

  return <div className="content-stack blog-manager">
    <section className="blog-manager-hero">
      <div><p className="eyebrow">WEBSITE CONTENT / {division}</p><h2>{divisionName(division)} Blog</h2><p>Write, review, schedule, and publish articles for this division. Content and media stay separated by brand.</p></div>
      <div className="blog-manager-actions"><button className="secondary-button" onClick={() => void load()} disabled={loading}>Refresh</button><button className="primary-button" onClick={startNew}>+ New article</button></div>
    </section>
    {message && <div className={messageError ? "error-banner" : "blog-success"}>{message}</div>}
    {editing && <section className="panel blog-editor">
      <div className="panel-heading"><div><p className="eyebrow">ARTICLE EDITOR</p><h2>{draft.id ? "Edit article" : "Create article"}</h2><p className="muted">Public URL: {publicPath}</p></div><div className="panel-actions"><button className="secondary-button" onClick={() => setPreview(!preview)}>{preview ? "Edit content" : "Preview"}</button><button className="text-button" onClick={() => { setEditing(false); setPreview(false); }}>Close</button></div></div>
      {preview ? <div className="blog-preview">
        {previewUrl && <img src={previewUrl} alt={draft.featured_image_alt || "Article featured image"} />}
        <span>{division} / {draft.category}</span><h1>{draft.title || "Article title"}</h1><p className="blog-preview-excerpt">{draft.excerpt}</p><div className="blog-preview-body">{draft.body_markdown || "Your article content preview will appear here."}</div>
      </div> : <div className="blog-editor-grid">
        <div className="blog-editor-main">
          <label>Article title<input value={draft.title} onChange={(event) => { update("title", event.target.value); if (!draft.slug) update("slug", slugify(event.target.value)); }} placeholder="Write a useful, specific headline" maxLength={160} /></label>
          <label>URL slug<input value={draft.slug} onChange={(event) => update("slug", slugify(event.target.value))} placeholder="article-url-slug" maxLength={180} /><small>Lowercase words separated by hyphens.</small></label>
          <label>Short introduction<textarea rows={3} value={draft.excerpt} onChange={(event) => update("excerpt", event.target.value)} placeholder="Summarize what the reader will learn." maxLength={320} /></label>
          <label>Article content (Markdown supported)<textarea className="blog-body-input" rows={18} value={draft.body_markdown} onChange={(event) => update("body_markdown", event.target.value)} placeholder={"## Start with the roof condition\n\nExplain the issue clearly, then give the reader practical next steps."} /></label>
          <div className="blog-editor-two">
            <label>Category<input value={draft.category} onChange={(event) => update("category", event.target.value)} placeholder="Roof repair, coatings, maintenance..." /></label>
            <label>Featured image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadImage(event)} disabled={uploading} /><small>{uploading ? "Uploading image..." : "JPG, PNG, or WebP. Maximum 15 MB."}</small></label>
          </div>
          {previewUrl && <div className="blog-image-preview"><img src={previewUrl} alt={draft.featured_image_alt || "Selected featured image"} /><button className="text-button" onClick={() => update("featured_image_path", "")}>Remove image</button></div>}
          <label>Image alt text<input value={draft.featured_image_alt} onChange={(event) => update("featured_image_alt", event.target.value)} placeholder="Describe the actual scene shown in the image" /></label>
        </div>
        <aside className="blog-editor-aside">
          <div className="blog-side-card"><strong>Search appearance</strong><label>SEO title<input value={draft.seo_title} onChange={(event) => update("seo_title", event.target.value)} placeholder={draft.title || "Search result title"} maxLength={70} /></label><label>Meta description<textarea rows={4} value={draft.seo_description} onChange={(event) => update("seo_description", event.target.value)} placeholder={draft.excerpt || "Describe this article for searchers."} maxLength={160} /></label><small>Keep titles specific and descriptions useful. Avoid keyword stuffing.</small></div>
          <div className="blog-side-card"><strong>Publishing</strong><label>Schedule date and time<input type="datetime-local" value={draft.scheduled_at} onChange={(event) => update("scheduled_at", event.target.value)} /></label><small>Scheduled articles become publicly available at the selected time.</small></div>
        </aside>
      </div>}
      <div className="blog-editor-footer"><button className="secondary-button" onClick={() => void save("draft")} disabled={saving || uploading}>{saving ? "Saving..." : "Save draft"}</button><button className="secondary-button" onClick={() => void save("scheduled")} disabled={saving || uploading}>Schedule</button><button className="primary-button" onClick={() => void save("published")} disabled={saving || uploading}>{saving ? "Saving..." : "Publish now"}</button></div>
    </section>}
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">CONTENT LIBRARY</p><h2>Articles</h2><p className="muted">{posts.length} total in {division}</p></div><div className="blog-filters"><input aria-label="Search articles" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" /><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Drafts</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="archived">Archived</option></select></div></div>
      {loading ? <div className="empty-state">Loading articles...</div> : visiblePosts.length ? <div className="table-wrap"><table><thead><tr><th>Article</th><th>Status</th><th>Category</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>{visiblePosts.map((post) => <tr key={post.id}><td><strong>{post.title}</strong><span className="subline">/{division === "TRD" ? "residential" : "commercial"}/blog/{post.slug}</span></td><td><span className={"pill " + post.status}>{post.status}</span></td><td>{post.category}</td><td>{new Date(post.updated_at).toLocaleDateString()}</td><td><div className="blog-row-actions"><button className="text-button" onClick={() => editPost(post)}>Edit</button>{post.status !== "published" && post.status !== "archived" && <button className="text-button" onClick={() => void changeStatus(post, "published")}>Publish</button>}{post.status !== "archived" && <button className="text-button" onClick={() => void changeStatus(post, "archived")}>Archive</button>}{post.status === "published" && <a href={`https://theroofingdrs.com${division === "TRD" ? "/residential" : "/commercial"}/blog/${post.slug}`} target="_blank" rel="noreferrer">View</a>}</div></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>{query || statusFilter !== "all" ? "No matching articles" : "No articles in this library yet"}</strong><span>Create the first {division === "TRD" ? "homeowner resource" : "commercial roofing insight"} to start building search authority.</span><button className="primary-button" onClick={startNew}>Create first article</button></div>}
    </section>
  </div>;
}
