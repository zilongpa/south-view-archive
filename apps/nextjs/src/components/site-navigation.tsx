'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Menu } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './site-navigation.module.css';

export function SiteNavigation({
  overlay = false,
  embed = false,
  personId,
  standaloneHref = '/explore',
  children,
}: {
  overlay?: boolean;
  embed?: boolean;
  personId?: string;
  standaloneHref?: string;
  children?: ReactNode;
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
      ? '/stories'
      : pathname.startsWith('/submissions/') || pathname === '/sign-in'
        ? '/my-contributions'
        : pathname;
  const links = [
    { href: '/explore', label: 'Explore' },
    { href: '/stories', label: 'Stories' },
    { href: '/about', label: 'About' },
    { href: '/contribute', label: 'Contribute' },
    { href: '/my-contributions', label: 'My contributions' },
  ];
  const navigationLinks = links.map(({ href, label }) => (
    <Link
      key={href}
      href={
        href === '/contribute' && personId ? `${href}?person=${encodeURIComponent(personId)}` : href
      }
      aria-current={active === href ? 'page' : undefined}
      target={embed ? '_blank' : undefined}
      rel={embed ? 'noopener noreferrer' : undefined}
      onClick={closeMenu}
    >
      {label}
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
