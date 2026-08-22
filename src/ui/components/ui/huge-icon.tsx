import type { LucideProps } from 'lucide-react';

export type HugeIconProps = LucideProps;

export function HugeIcon(props: LucideProps) {
  const { className, ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    />
  );
}
