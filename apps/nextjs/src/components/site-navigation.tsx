'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Menu, UserRound } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { copy } from '@/lib/copy';
import styles from './site-navigation.module.css';

/**
 * Three destinations only: the map, the contribution flow, and the visitor's own account.
 * Record pages count as part of the map; receipt and sign-in pages count as the account.
 */
export function SiteNavigation({
  overlay = false,
  embed = false,
  personId,
  standaloneHref = '/explore',
  children,
  workspace = false,
}: {
  overlay?: boolean;
  embed?: boolean;
  personId?: string;
  standaloneHref?: string;
  children?: ReactNode;
  workspace?: boolean;
}) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  useEffect(closeMenu, [pathname]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) closeMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menu.current?.open) return;
      event.stopPropagation();
      closeMenu();
      menu.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const active =
    pathname.startsWith('/people/') || pathname.startsWith('/contributions/')
      ? '/explore'
      : pathname.startsWith('/submissions/') || pathname === '/sign-in'
        ? '/my-contributions'
        : pathname;
  const links = workspace
    ? [
        { href: '/explore', label: 'Back to archive' },
        { href: '/my-contributions', label: copy.account, account: true },
      ]
    : [
        { href: '/explore', label: copy.explore },
        { href: '/contribute', label: copy.share },
        { href: '/my-contributions', label: copy.account, account: true },
      ];
  const navigationLinks = links.map(({ href, label, account }) => (
    <Link
      key={href}
      className={account ? styles.account : undefined}
      href={
        href === '/contribute' && personId ? `/people/${encodeURIComponent(personId)}?edit=1` : href
      }
      aria-current={active === href ? 'page' : undefined}
      target={embed ? '_blank' : undefined}
      rel={embed ? 'noopener noreferrer' : undefined}
      onClick={closeMenu}
    >
      {account && <UserRound size={18} aria-hidden="true" />}
      <span>{label}</span>
    </Link>
  ));

  return (
    <>
      <header className={styles.header} aria-label="South-View navigation">
        <Link
          className={styles.brand}
          href="/explore"
          aria-label="South-View, explore the archive"
          target={embed ? '_blank' : undefined}
          rel={embed ? 'noopener noreferrer' : undefined}
        >
          <img src="/icon.svg" width={34} height={34} alt="" />
          <span>
            <strong>South-View</strong>
            <small>A LIVING ARCHIVE</small>
          </span>
        </Link>
        <div className={styles.actions}>
          <nav className={styles.desktop} aria-label="Main navigation">
            {navigationLinks}
          </nav>
          <div className={styles.utility}>{children}</div>
          {embed && (
            <a
              className={styles.standalone}
              href={standaloneHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open full map"
            >
              <span>Open full map</span>
              <ExternalLink size={18} aria-hidden="true" />
            </a>
          )}
          <details className={styles.menu} ref={menu}>
            <summary aria-label="Open navigation menu">
              <Menu size={22} aria-hidden="true" />
            </summary>
            <nav aria-label="Main navigation">{navigationLinks}</nav>
          </details>
        </div>
      </header>
      {!overlay && <div className={styles.spacer} aria-hidden="true" />}
    </>
  );
}
