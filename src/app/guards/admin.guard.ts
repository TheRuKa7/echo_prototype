import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/** ECH-26: agent setup, settings, telephony and the team belong to workspace admins. Campaign managers and users go back to Overview. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return !auth.me() || auth.canAdmin() || auth.me()?.agent_admin ? true : inject(Router).parseUrl('/overview');
};
