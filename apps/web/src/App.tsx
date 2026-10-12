import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { DemoStore } from './pages/DemoStore';
import { Login, Signup, Invite } from './pages/Auth';
import { Try, Preview } from './pages/Try';
import { Visit, Checkin } from './pages/Visit';
import { Visits } from './app/Visits';
import { Clients, ClientDetail } from './app/Clients';
import { Approvals } from './app/Approvals';
import { Calls } from './app/Calls';
import { Admin } from './admin/Admin';
import { Layout } from './app/Layout';
import { Home } from './app/Home';
import { Inbox } from './app/Inbox';
import { Knowledge } from './app/Knowledge';
import { Simulations, SimulationDetail } from './app/Simulations';
import { Actions } from './app/Actions';
import { Analytics } from './app/Analytics';
import { Settings } from './app/Settings';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<DemoStore />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/try" element={<Try />} />
      <Route path="/preview" element={<Preview />} />
      <Route path="/v/:code" element={<Visit />} />
      <Route path="/checkin/:siteKey" element={<Checkin />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/admin/:page" element={<Admin />} />
      <Route path="/app" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="visits" element={<Visits />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="calls" element={<Calls />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="inbox/:id" element={<Inbox />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="simulations" element={<Simulations />} />
        <Route path="simulations/:id" element={<SimulationDetail />} />
        <Route path="actions" element={<Actions />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/:tab" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
