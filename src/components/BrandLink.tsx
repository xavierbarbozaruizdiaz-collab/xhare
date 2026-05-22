import Link from 'next/link';
import { APP_NAME, BRAND_PRIMARY_CLASS } from '@/lib/brand';

type BrandLinkProps = {
  href?: string;
  className?: string;
  children?: React.ReactNode;
};

export default function BrandLink({
  href = '/',
  className,
  children = APP_NAME,
}: BrandLinkProps) {
  const base = className ?? `text-lg font-bold ${BRAND_PRIMARY_CLASS} shrink-0`;
  return (
    <Link href={href} className={base}>
      {children}
    </Link>
  );
}
