/**
 * App-wide router helpers. Keep navigation on React Router's stable path instead of
 * forcing the browser View Transitions API: some Chromium builds can crash their
 * renderer while snapshotting our media-heavy pages (STATUS_BREAKPOINT).
 */
import { forwardRef, useCallback } from 'react'
import {
  Link as RRLink,
  type LinkProps,
  NavLink as RRNavLink,
  type NavigateOptions,
  type NavLinkProps,
  type To,
  useNavigate as useRRNavigate,
} from 'react-router-dom'

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
  return <RRLink ref={ref} {...props} />
})

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(props, ref) {
  return <RRNavLink ref={ref} {...props} />
})

// eslint-disable-next-line react/only-export-components
export function useNavigate() {
  const navigate = useRRNavigate()
  return useCallback((to: To, options?: NavigateOptions) => navigate(to, options), [navigate])
}
