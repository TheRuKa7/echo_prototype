import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from '../services/api.service';
import { AuthService } from '../services/auth.service';

/** ECH-26: agent setup, settings, telephony and the team belong to admins. */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const api = inject(ApiService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
  if (!auth.me()) {
    try {
      const me = await api.me();
      auth.setMe(me);
    } catch {
      return router.parseUrl('/login');
    }
  }
  const orgOnly = state.url.startsWith('/team') || state.url.startsWith('/settings');
  const allowed = orgOnly ? auth.canAdmin() : (auth.canAdmin() || !!auth.me()?.agent_admin);
  return allowed ? true : router.parseUrl('/overview');
};
