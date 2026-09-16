import { ManagementOverview } from './jw-front';
import { V4SurfaceNav } from './v4-surface-nav';

export default function Page() {
  return (
    <div className="jw-manage-page">
      <V4SurfaceNav active="manage" />
      <ManagementOverview />
    </div>
  );
}
