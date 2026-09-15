/**
 * The module's design system, in one import.
 *
 * ⚠️ Everything under `ui/` is the MSR Volunteering module's system, copied so
 * the two modules read as one product — see `frame.tsx` for what changed and
 * why. `components/Table.tsx` and `components/Form.tsx` are the only two files
 * written for this module, and each says at the top why the reference set had
 * no answer for it.
 *
 * Screens import from here rather than reaching into the folder, so a later
 * merge into a shared platform package is one path to change.
 */
export { Frame } from './frame';
export { Icon, ICON_NAMES } from './icons';
export {
  Avatar,
  Btn,
  Card,
  card,
  Chip,
  Empty,
  ErrorBox,
  gridMinWidth,
  H1,
  KV,
  Loading,
  Pill,
  pillStyle,
  type PillSize,
  Search,
  statusTone,
  Tag,
  TONE,
  type Tone,
  Toolbar,
  toolBtnStyle,
} from './ui';
export { useBreakpoint, useIsMobile, useIsNarrow, type BP } from './useBreakpoint';
export { useListView, type ListView } from './useListView';
export { usePageSize } from './usePageSize';
export { useSidebarRail } from './useSidebarRail';
export {
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PAGE_SIZES,
  rangeLabel,
} from './paging';

export { Dialog, Field, inputStyle } from './components/Dialog';
export { Facts, Section } from './components/FactSection';
export {
  Checkbox,
  ChoicePlate,
  controlStyle,
  errorInputStyle,
  FieldError,
  FieldStack,
  FormField,
  Input,
  Radio,
  Select,
  Textarea,
} from './components/Form';
export { IconBtn } from './components/IconBtn';
export { NavTileCard, type NavTileItem } from './components/NavTileCard';
export {
  scrim,
  sheet,
  SheetGrip,
  useEscape,
  useFocusTrap,
  useLockScroll,
} from './components/Overlay';
export { pageSlice, Pager } from './components/Pager';
export { OptionRow, PopHeader, Popover } from './components/Popover';
export { RowCard, RowCardAction } from './components/RowCard';
export { SearchList, matchLabel } from './components/SearchList';
export { SearchSelect } from './components/SearchSelect';
export { MultiSelect } from './components/MultiSelect';
export { DateField } from './components/DatePicker';
export { StatTiles } from './components/StatTiles';
export { TBody, TD, TH, THead, TR, Table } from './components/Table';
export { ViewToggle } from './components/ViewToggle';
export { ToastProvider, useToast } from './components/Toast';
