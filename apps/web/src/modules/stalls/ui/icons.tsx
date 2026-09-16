import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  BarChart3,
  Bell,
  Calendar,
  CalendarCheck,
  Check,
  CircleCheck,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileText,
  Globe,
  HeartHandshake,
  Home,
  Info,
  IndianRupee,
  Key,
  LayoutGrid,
  Layers,
  List,
  LogIn,
  LogOut,
  SquareCheckBig,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Moon,
  Pencil,
  Package,
  Phone,
  PhoneCall,
  Plus,
  Printer,
  RefreshCw,
  Scroll,
  Send,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Stethoscope,
  Sun,
  Target,
  Ticket,
  Trash2,
  Undo2,
  LockOpen,
  Mail,
  MoreHorizontal,
  User,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * Semantic icon name → lucide component.
 *
 * Nav items and buckets carry a NAME (from @msr/volunteering), not a glyph, so the
 * server never ships presentation and the icon set can change in one place.
 */
/**
 * ── The action convention ───────────────────────────────────────────────────
 *
 * Every control that DOES something carries a glyph, and the same act carries
 * the same glyph everywhere. This list is the whole of it:
 *
 *   check         save, confirm, apply, agree — anything that commits an edit
 *   plus          create, add another one
 *   pencil        open the editor for an existing thing
 *   trash         delete or remove a row
 *   x             clear a mark without deleting the row (un-verify, un-tick)
 *   send          send an email, submit an application, hand off to Finance
 *   refresh       do it again — re-send, re-issue, reload
 *   undo          put it back the way it was
 *   rupee         money changes hands — a credit recorded, cash taken
 *   printer       produce a piece of paper
 *   package       goods move — distributed, collected
 *   circle-check  attendance and activation: checked in, made current
 *   ban           refuse
 *   alert-triangle  flag for a human to look at
 *   key           credentials
 *   user-plus     put a person on something
 *   chevron-down  reveal more of a list
 *
 * ⚠️ **Cancel, Back and Close get NOTHING.** They are the way out of a dialog,
 * not an act performed on the record, and a glyph on the way out competes for
 * the eye with the one action beside it that matters. Every dialog in the
 * module pairs a plain Cancel with a glyphed confirm, and that asymmetry is
 * what makes the confirm findable at a glance.
 *
 * The other half of the rule is `IconBtn`: an action that lives in a table's
 * Actions column is icon-ONLY at 28px, because a column of worded buttons sets
 * the table's width from its least important column.
 */
const REGISTRY: Record<string, LucideIcon> = {
  'alert-triangle': AlertTriangle,
  'arrow-left-right': ArrowLeftRight,
  'arrow-right': ArrowRight,
  ban: Ban,
  'bar-chart': BarChart3,
  bell: Bell,
  calendar: Calendar,
  'calendar-check': CalendarCheck,
  check: Check,
  'check-square': SquareCheckBig,
  info: Info,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevrons-left': ChevronsLeft,
  'chevrons-right': ChevronsRight,
  'circle-dot': CircleDot,
  'clipboard-list': ClipboardList,
  copy: Copy,
  download: Download,
  eye: Eye,
  'file-text': FileText,
  globe: Globe,
  'heart-handshake': HeartHandshake,
  home: Home,
  key: Key,
  'layout-grid': LayoutGrid,
  'list-view': List,
  'lock-open': LockOpen,
  'log-out': LogOut,
  mail: Mail,
  'more-horizontal': MoreHorizontal,
  layers: Layers,
  'map-pin': MapPin,
  megaphone: Megaphone,
  menu: Menu,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  moon: Moon,
  pencil: Pencil,
  phone: Phone,
  'phone-call': PhoneCall,
  package: Package,
  plus: Plus,
  printer: Printer,
  refresh: RefreshCw,
  rupee: IndianRupee,
  scroll: Scroll,
  search: Search,
  send: Send,
  settings: Settings,
  shield: Shield,
  sliders: SlidersHorizontal,
  stethoscope: Stethoscope,
  sun: Sun,
  target: Target,
  ticket: Ticket,
  trash: Trash2,
  undo: Undo2,
  user: User,
  'user-plus': UserPlus,
  users: Users,
  clock: Clock,
  'circle-check': CircleCheck,
  'log-in': LogIn,
  x: X,
};

/** Every name `Icon` knows. Exported so a caller naming a glyph can be
 *  checked against it — an unknown name renders a generic dot in silence. */
export const ICON_NAMES: string[] = Object.keys(REGISTRY);

export function Icon({
  name,
  size = 17,
  color = 'currentColor',
  strokeWidth = 1.9,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const Cmp = REGISTRY[name] ?? CircleDot;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} aria-hidden />;
}
