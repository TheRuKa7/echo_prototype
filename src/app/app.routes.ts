import { DocsComponent } from './pages/docs/docs.component';
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { LoginComponent } from './components/login/login.component';
import { ShellComponent } from './components/shell/shell.component';
import { OverviewComponent } from './pages/overview/overview.component';
import { CallConsoleComponent } from './pages/call-console/call-console.component';
import { AgentsComponent } from './pages/agents/agents.component';
import { AgentDetailComponent } from './pages/agent-detail/agent-detail.component';
import { CampaignsComponent } from './pages/campaigns/campaigns.component';
import { CampaignDetailComponent } from './pages/campaign-detail/campaign-detail.component';
import { CallAnalysisComponent } from './pages/call-analysis/call-analysis.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { TeamComponent } from './pages/team/team.component';
import { FollowUpsComponent } from './pages/follow-ups/follow-ups.component';
import { CallPageRouteComponent } from './pages/call-page/call-page-route.component';
import { EchoCallLogsPage, EchoCampaignPage, EchoCampaignsPage, EchoFollowUpsPage, EchoNewCampaignPage, EchoSupplierPage } from './pages/shared-screens/shared-screen-routes';
import { AgentBuilderComponent } from './pages/agent-builder/agent-builder.component';
import { CreditsComponent } from './pages/credits/credits.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Sign in · Echo' },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'overview', component: OverviewComponent, title: 'Overview · Echo' },
      { path: 'console', component: CallConsoleComponent, title: 'Call console · Echo' },
      // One call page for every call list (same page as Clarix). Old contact links land on it too.
      { path: 'calls', component: EchoCallLogsPage, title: 'Call logs · Echo' },
      { path: 'calls/:id', component: CallPageRouteComponent, title: 'Call · Echo' },
      { path: 'agents', component: AgentsComponent, title: 'Agents · Echo' },
      { path: 'agents/new', component: AgentBuilderComponent, title: 'New agent · Echo' },
      { path: 'agents/:key', component: AgentDetailComponent, title: 'Agent · Echo', canDeactivate: [(c: AgentDetailComponent) => c.canLeave()] },
      // Campaigns, New campaign, Campaign and Follow ups: the same screens as Clarix.
      { path: 'campaigns', component: EchoCampaignsPage, title: 'Campaigns · Echo' },
      { path: 'campaigns/new', component: EchoNewCampaignPage, title: 'New campaign · Echo' },
      { path: 'campaigns/:id', component: EchoCampaignPage, title: 'Campaign · Echo' },
      { path: 'campaigns/:cid/contacts/:pid', redirectTo: ({ params }) => `/calls/${params['cid']}:${params['pid']}` },
      { path: 'follow-ups', component: EchoFollowUpsPage, title: 'Action needed · Echo' },
      { path: 'suppliers/:phone', component: EchoSupplierPage, title: 'Supplier · Echo' },
      { path: 'team', component: TeamComponent, title: 'Team and access · Echo' },
      { path: 'credits', component: CreditsComponent, title: 'Credits · Echo' },
      { path: 'settings', component: SettingsComponent, title: 'Settings · Echo' },
      { path: 'docs', component: DocsComponent, title: 'Documentation · Echo' },
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'overview' },
];
