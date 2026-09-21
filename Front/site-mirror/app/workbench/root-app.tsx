import { DesktopFrame } from '../takeoff/desktop-frame';

import '../takeoff/takeoff.css';
import '../takeoff/glass.css';
import { VirtualWorkbench } from '../takeoff/virtual-workbench';

export function RootApp() {
  return <DesktopFrame><VirtualWorkbench/></DesktopFrame>;
}
