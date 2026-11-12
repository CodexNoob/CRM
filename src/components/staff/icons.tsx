import {
  Activity,
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FileSignature,
  FileText,
  Folder,
  Funnel,
  LayoutDashboard,
  MessagesSquare,
  MonitorSmartphone,
  Plug,
  Receipt,
  Settings,
  ShieldCheck,
  SquareCheckBig,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/** Sidebar icon names → Lucide icons. Names are plain strings so server code can reference them. */
const ICONS = {
  dashboard: LayoutDashboard,
  clients: Users,
  leads: Funnel,
  engagements: Briefcase,
  tasks: SquareCheckBig,
  returns: FileText,
  preparation: ClipboardCheck,
  bookkeeping: BookOpen,
  calendar: CalendarDays,
  documents: Folder,
  messages: MessagesSquare,
  esign: FileSignature,
  portal: MonitorSmartphone,
  invoices: Receipt,
  payments: CreditCard,
  reports: BarChart3,
  integrations: Plug,
  team: ShieldCheck,
  automation: Workflow,
  activity: Activity,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof ICONS;

export function NavIcon({ name, className = "size-4" }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
