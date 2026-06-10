import { forwardRef } from 'react';

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'icon';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn('ui-input', className)} {...props} />,
);
Input.displayName = 'Input';

export const Checkbox = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} type="checkbox" className={cn('ui-checkbox', className)} {...props} />,
);
Checkbox.displayName = 'Checkbox';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('ui-card', className)} {...props} />;
}

export function Badge({
  className,
  variant = 'secondary',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'secondary' | 'success' | 'destructive' | 'outline' }) {
  return <span className={cn('ui-badge', `ui-badge-${variant}`, className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('ui-separator', className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('ui-select', props.className)} {...props} />;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ui-switch"
      onClick={() => onCheckedChange(!checked)}
    >
      <span />
    </button>
  );
}
