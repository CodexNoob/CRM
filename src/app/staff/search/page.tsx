import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Briefcase, FileText, Funnel, Search, Users } from "lucide-react";
import { getDb } from "@/db";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { inputClass } from "@/components/form";
import { requireStaffActor } from "@/lib/auth/current";
import { globalSearch } from "@/services/workspace";

export const metadata: Metadata = { title: "Search" };

function Group({ title, icon, children, count }: { title: string; icon: ReactNode; children: ReactNode; count: number }) {
  if (!count) return null;
  return (
    <Panel title={`${title} (${count})`} actions={<span className="text-faint [&_svg]:size-4">{icon}</span>} flush>
      <ul className="divide-y divide-line">{children}</ul>
    </Panel>
  );
}

function Row({ href, title, sub }: { href: string; title: string; sub?: string }) {
  return (
    <li>
      <Link href={href} className="block px-4 py-2.5 hover:bg-hover">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        {sub ? <span className="block truncate text-[12px] text-muted">{sub}</span> : null}
      </Link>
    </li>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireStaffActor();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const r = await globalSearch(getDb(), actor, q);
  const total = r.clients.length + r.engagements.length + r.leads.length + r.documents.length;

  return (
    <>
      <PageHeader title="Search" description="Clients, engagements, leads and documents you have access to." />
      <form action="/staff/search" role="search" className="relative mb-5 max-w-xl">
        <label htmlFor="q" className="sr-only">Search</label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input id="q" name="q" type="search" defaultValue={q} autoFocus maxLength={100} placeholder="Type at least 2 characters and press Enter" className={`${inputClass} pl-8`} />
      </form>
      {q.trim().length < 2 ? (
        <EmptyState icon={<Search />} title="Search the workspace">Find a client by name, email or phone, an engagement by title, a lead, or a document by file name.</EmptyState>
      ) : total === 0 ? (
        <EmptyState icon={<Search />} title={`No results for “${q}”`}>Check the spelling, or try a shorter term.</EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Group title="Clients" icon={<Users />} count={r.clients.length}>
            {r.clients.map((c) => <Row key={c.id} href={`/staff/clients/${c.id}`} title={c.name} sub={c.sub} />)}
          </Group>
          <Group title="Engagements" icon={<Briefcase />} count={r.engagements.length}>
            {r.engagements.map((e) => <Row key={e.id} href={`/staff/engagements/${e.id}`} title={e.title} sub={e.clientName} />)}
          </Group>
          <Group title="Leads" icon={<Funnel />} count={r.leads.length}>
            {r.leads.map((l) => <Row key={l.id} href={`/staff/leads/${l.id}`} title={l.name} sub={l.sub} />)}
          </Group>
          <Group title="Documents" icon={<FileText />} count={r.documents.length}>
            {r.documents.map((d) => <Row key={d.id} href={`/api/documents/${d.id}`} title={d.fileName} sub={d.clientName} />)}
          </Group>
        </div>
      )}
    </>
  );
}
