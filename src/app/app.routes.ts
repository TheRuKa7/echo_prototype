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

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'overview', component: OverviewComponent },
      { path: 'console', component: CallConsoleComponent },
      { path: 'calls/:id', component: CallAnalysisComponent },
      { path: 'agents', component: AgentsComponent },
      { path: 'agents/:key', component: AgentDetailComponent },
      { path: 'campaigns', component: CampaignsComponent },
      { path: 'campaigns/:id', component: CampaignDetailComponent },
      { path: 'team', component: TeamComponent },
      { path: 'settings', component: SettingsComponent },
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'overview' },
];
