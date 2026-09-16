import { CaseWorkbench } from './case-workbench';
import type { WorkbenchRouteId } from './workbench-model';

export function WorkbenchAdapter({ initialRoute }: { initialRoute: WorkbenchRouteId }) {
  return <CaseWorkbench initialRoute={initialRoute} />;
}
