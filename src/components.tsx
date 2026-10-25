// ---------------------------------------------------------------------------
// Shared, reusable UI primitives used across Wardrobe / Fridge / Planner.
// Keeping these in one file avoids duplicate per-feature implementations of
// the same modal/card/button/etc.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Star, Loader2, Image as ImageIcon, AlertTriangle, CheckCircle2, Info, ChevronRight, Sparkles, Cpu, User as UserIcon } from 'lucide-react';
import { getImageObjectUrl } from './db';
import { useApp, type Toast } from './context';

// ---------- Buttons -------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled,
  className = '',
  type = 'button',
  title,
  ariaLabel
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
  ariaLabel?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-xl transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none select-none';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
    secondary: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    outline: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
  };
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-base' };
  return (
    <button type={type} title={title} aria-label={ariaLabel ?? title} disabled={disabled} onClick={onClick} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
}

export function IconButton({ icon, onClick, label, className = '', variant = 'ghost' }: { icon: React.ReactNode; onClick?: (e: React.MouseEvent) => void; label: string; className?: string; variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    secondary: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
    ghost: 'bg-white/90 text-slate-600 hover:bg-slate-100 border border-slate-200',
    danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
    outline: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
  };
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`inline-flex items-center justify-center h-9 w-9 rounded-full transition active:scale-95 ${variants[variant]} ${className}`}>
      {icon}
    </button>
  );
}

// ---------- Card ----------------------------------------------------------------

export function Card({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${onClick ? 'cursor-pointer active:scale-[0.99] transition' : ''} ${className}`}>
      {children}
    </div>
  );
}

// ---------- Badge ----------------------------------------------------------------

export function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'indigo' | 'amber' | 'rose' | 'green' | 'sky' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-100 text-indigo-700',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-700',
    green: 'bg-emerald-100 text-emerald-700',
    sky: 'bg-sky-100 text-sky-700'
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function AiSourceBadge({ source }: { source: 'user' | 'ai-local' | 'ai-gemini' | 'local' | 'gemini' }) {
  if (source === 'user') return <Badge tone="slate"><UserIcon size={11} /> You</Badge>;
  if (source === 'ai-gemini' || source === 'gemini') return <Badge tone="indigo"><Sparkles size={11} /> Gemini</Badge>;
  return <Badge tone="sky"><Cpu size={11} /> On-device</Badge>;
}

export function DemoBadge() {
  return <Badge tone="amber">Demo data</Badge>;
}

// ---------- Star rating -----------------------------------------------------------

export function StarRating({ value, onChange, size = 18, readOnly = false }: { value?: number; onChange?: (v: number) => void; size?: number; readOnly?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={readOnly}
          className={readOnly ? 'cursor-default' : 'cursor-pointer'}
          onMouseEnter={() => !readOnly && setHover(i)}
          onMouseLeave={() => !readOnly && setHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(i === value ? 0 : i);
          }}
        >
          <Star size={size} className={i <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
        </button>
      ))}
    </div>
  );
}

// ---------- Blob-backed image -------------------------------------------------------

export function BlobImage({ blobKey, url, alt, className = '', fit = 'cover' }: { blobKey: string | undefined; url?: string; alt: string; className?: string; fit?: 'cover' | 'contain' }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!blobKey) {
      setObjectUrl(null);
      return;
    }
    getImageObjectUrl(blobKey).then((u) => {
      if (active) setObjectUrl(u);
    });
    return () => {
      active = false;
    };
  }, [blobKey]);

    if (url) return <img src={url} alt={alt} loading="lazy" className={`object-${fit} ${className}`} />;

  if (!objectUrl) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 ${className}`}>
        <ImageIcon size={28} />
      </div>
    );
  }
  return <img src={objectUrl} alt={alt} className={`object-${fit} ${className}`} />;
}

// ---------- Empty state -----------------------------------------------------------

export function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 text-slate-500">
      <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center mb-4 text-slate-400">{icon}</div>
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="text-sm mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Loading spinner --------------------------------------------------------

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function LoadingScreen({ label = 'Loading your planner…' }: { label?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
      <Spinner size={28} />
      <p className="text-sm">{label}</p>
    </div>
  );
}

// ---------- Sheet (bottom sheet on mobile, centred modal on larger screens) -------

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div
        className={`relative bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-xl animate-[slideUp_0.2s_ease-out]`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-semibold text-slate-800 text-base">{title}</h2>
          <IconButton icon={<X size={18} />} label="Close" onClick={onClose} />
        </div>
        <div className="overflow-y-auto px-5 py-4 grow">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-100 shrink-0 flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---------- Confirm dialog ----------------------------------------------------------

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Sheet>
  );
}

/** Small hook to drive a ConfirmDialog imperatively: `const confirm = useConfirm(); if (await confirm('Delete?')) {...}` */
export function useConfirm() {
  const [state, setState] = useState<{ message: string; title: string; resolve: (v: boolean) => void } | null>(null);
  const ask = (message: string, title = 'Are you sure?') =>
    new Promise<boolean>((resolve) => setState({ message, title, resolve }));
  const node = (
    <ConfirmDialog
      open={!!state}
      title={state?.title ?? ''}
      message={state?.message ?? ''}
      onCancel={() => {
        state?.resolve(false);
        setState(null);
      }}
      onConfirm={() => {
        state?.resolve(true);
        setState(null);
      }}
    />
  );
  return { ask, node };
}

// ---------- Form field helpers ----------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-slate-700 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white placeholder:text-slate-400';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      aria-pressed={checked}
      aria-label={label}
    >
      <span className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white transition ${checked ? 'translate-x-[22px]' : 'translate-x-1'}`} />
    </button>
  );
}

export function NumberStepper({ value, onChange, min = 0, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <div className="inline-flex items-center border border-slate-300 rounded-xl overflow-hidden">
      <button type="button" className="px-3 py-2 text-slate-600 hover:bg-slate-50" onClick={() => onChange(Math.max(min, round(value - step)))}>
        −
      </button>
      <span className="px-3 py-2 text-sm min-w-[3rem] text-center tabular-nums">{value}</span>
      <button type="button" className="px-3 py-2 text-slate-600 hover:bg-slate-50" onClick={() => onChange(round(value + step))}>
        +
      </button>
    </div>
  );
}
function round(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- Tab bar (horizontally scrollable sub-tabs) -----------------------------

export function TabBar<T extends string>({ tabs, active, onChange }: { tabs: { key: T; label: string }[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition whitespace-nowrap ${
            active === t.key ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Bottom navigation --------------------------------------------------------

export function BottomNav<T extends string>({
  items,
  active,
  onChange
}: {
  items: { key: T; label: string; icon: React.ReactNode }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)] z-30">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition ${
            active === item.key ? 'text-indigo-600' : 'text-slate-400'
          }`}
        >
          {item.icon}
          <span className="text-[11px] font-medium">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------- Toasts ---------------------------------------------------------------------

export function ToastContainer() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="fixed top-3 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const icons = { info: <Info size={16} />, success: <CheckCircle2 size={16} />, error: <AlertTriangle size={16} /> };
  const tones = { info: 'bg-slate-800', success: 'bg-emerald-700', error: 'bg-rose-700' };
  return (
    <div className={`pointer-events-auto text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 max-w-sm ${tones[toast.kind]}`} onClick={onDismiss}>
      {icons[toast.kind]}
      <span>{toast.message}</span>
    </div>
  );
}

// ---------- Section header with chevron link ------------------------------------------

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 mt-5 mb-2">
      <h3 className="font-semibold text-slate-800">{title}</h3>
      {action && (
        <button onClick={onAction} className="text-sm text-indigo-600 font-medium inline-flex items-center gap-0.5">
          {action} <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

// ---------- File/camera input helper -------------------------------------------------

export function PhotoInput({ onFile, label = 'Add photo', capture = true }: { onFile: (file: File) => void; label?: string; capture?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture={capture ? 'environment' : undefined}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <Button variant="outline" onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  );
}
