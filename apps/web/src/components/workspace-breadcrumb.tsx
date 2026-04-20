import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function WorkspaceBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav className="wbeta-breadcrumb" aria-label="Breadcrumb">
      <ol className="wbeta-breadcrumb-list">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className="wbeta-breadcrumb-item">
              {item.href && !isLast ? (
                <Link href={item.href} className="wbeta-breadcrumb-link">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? "wbeta-breadcrumb-current" : "wbeta-breadcrumb-text"}>
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <span className="wbeta-breadcrumb-sep" aria-hidden>
                  <CaretRight size={11} weight="bold" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
