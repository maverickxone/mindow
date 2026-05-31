/**
 * Centralized icon exports from lucide-react.
 *
 * All icons consumed through this module for consistent sizing and
 * easy future replacement. Standardized props:
 * - Navigation icons: size={20} strokeWidth={1.75}
 * - Inline/action icons: size={16} strokeWidth={1.5}
 * - Window control icons: size={12} strokeWidth={2}
 *
 * The app logo remains a custom SVG (brand identity).
 */

export {
  // ─── Navigation ───────────────────────────────────────────────────
  LayoutList,        // Processes page
  Activity,          // Performance page
  Sparkles,          // AI page
  Settings,          // Settings page

  // ─── Window controls ──────────────────────────────────────────────
  Minus,             // Minimize
  Square,            // Maximize (single window)
  Copy,              // Maximize (restored/overlapping windows)
  X,                 // Close

  // ─── Process table ────────────────────────────────────────────────
  ChevronRight,      // Expand/collapse group
  ArrowUp,           // Sort ascending
  ArrowDown,         // Sort descending
  Search,            // Search bar icon

  // ─── Context menu ─────────────────────────────────────────────────
  XCircle,           // End task (danger)
  FolderOpen,        // Open file location
  ClipboardCopy,     // Copy name
  Hash,              // Copy PID

  // ─── AI / Chat ────────────────────────────────────────────────────
  StopCircle,        // Stop streaming
  Clipboard,         // Copy response
  Check,             // Copied confirmation
  Bot,               // AI assistant avatar/empty state
  Send,              // Send message

  // ─── Settings ─────────────────────────────────────────────────────
  Eye,               // Show API key
  EyeOff,            // Hide API key

  // ─── Side panel ───────────────────────────────────────────────────
  // X already exported above (Window controls)

  // ─── Sidebar toggle ───────────────────────────────────────────────
  PanelLeftClose,    // Collapse sidebar
  Menu,              // Expand sidebar (hamburger)

  // ─── Toast icons ──────────────────────────────────────────────────
  CheckCircle2,      // Success
  AlertCircle,       // Error
  AlertTriangle,     // Warning
  Info,              // Info

  // ─── Battery ──────────────────────────────────────────────────────
  Battery,           // Battery icon base
  BatteryCharging,   // Battery charging

  // ─── Misc ─────────────────────────────────────────────────────────
  Loader2,           // Loading spinner
} from "lucide-react";
