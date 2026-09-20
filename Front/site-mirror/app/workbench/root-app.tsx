import { useWorkbench } from '../../lib/workbench/use-workbench';
import { CustomerDirectory } from './customer-directory';
import { TakeoffScreen } from '../takeoff/takeoff-screen';
import { RoleEntry } from '../takeoff/role-entry';
import { DesktopFrame } from '../takeoff/desktop-frame';
import '../takeoff/takeoff.css';
import '../takeoff/glass.css';

export function RootApp() {
  const edgeBase = ['3617', '3618'].includes(window.location.port) ? 'http://127.0.0.1:48214' : '';
  const wb = useWorkbench(edgeBase);
  return <DesktopFrame>{!wb.session ? <RoleEntry wb={wb} /> : !wb.customerId ? <CustomerDirectory key={wb.session.principalId} wb={wb} onOpen={(id) => void wb.openCustomer(id)} /> : <TakeoffScreen wb={wb} onBackToDirectory={() => wb.closeCustomer()} onLogout={() => wb.logout()} />}</DesktopFrame>;
}
